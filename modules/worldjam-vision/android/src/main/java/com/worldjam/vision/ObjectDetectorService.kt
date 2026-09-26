package com.worldjam.vision

import android.content.Context
import android.os.SystemClock
import android.util.Log
import com.mrousavy.camera.frameprocessors.Frame
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The native vision pipeline.
 *
 *   camera frame (plugin thread)
 *     → throttle / drop-if-busy          never queue: a stale frame is worthless
 *     → FrameConverter (copy + letterbox) camera buffer released on return
 *   inference worker (one thread)
 *     → detector → YoloDecoder → DetectionTracker
 *     → GUIDE:   PrimaryObjectResolver → ReadoutManager (TTS)
 *     → CAPTURE: depth (≈3 Hz) → ClosestObjectResolver → capture target
 *     → compact, change-only events to JS
 *
 * Detector chain comes from model_manifest.json in priority order (the
 * everyday-objects YOLOE model on QNN, then on CPU, then COCO with people
 * filtered out). Each failure is logged and surfaced in diagnostics.
 */
class ObjectDetectorService(
    private val context: Context,
    private val emitter: Emitter,
) : ReadoutManager.Listener {

    interface Emitter {
        fun onVisionState(state: Map<String, Any?>)
        fun onReadout(readout: Map<String, Any?>)
        fun onFormatRequest(request: Map<String, Any?>)
        fun onStatus(status: Map<String, Any?>)
        fun onCaptureTarget(target: Map<String, Any?>)
    }

    private val tag = "WorldVision"

    @Volatile var config = VisionConfig()
    val diagnostics = VisionDiagnostics()
    private val modelManager = ModelManager(context)
    private val tracker = DetectionTracker()
    private val resolver = PrimaryObjectResolver()
    private val closest = ClosestObjectResolver()
    val tts = TTSManager(context) { diagnostics.ttsLatency(it) }
    val readout = ReadoutManager(DirectReadoutFormatter(), tts, LatestReadoutStore(), { SystemClock.elapsedRealtime() }, this)

    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "WorldVision-infer") }
    private val timer = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "WorldVision-timer") }
    private val busy = AtomicBoolean(false)
    @Volatile private var running = false
    @Volatile private var lastAccepted = 0L

    @Volatile var backend: ObjectDetectorBackend? = null
        private set
    private var converter: FrameConverter? = null
    private var decoder: YoloDecoder? = null

    @Volatile var depth: DepthEstimator? = null
        private set
    @Volatile private var depthState = "idle" // idle | loading | ready | unavailable
    private var depthError: String? = null
    @Volatile private var lastDepthAt = 0L
    /** Latest depth sample per track, refreshed ~3 Hz, reused between depth runs. */
    private val trackDepth = HashMap<String, Float>()
    private var lastDepthMs = 0.0

    @Volatile var mode: VisionMode = VisionMode.GUIDE
        private set

    @Volatile var status: String = "idle"   // idle | initializing | ready | error
        private set
    @Volatile var statusError: String? = null
        private set

    @Volatile var lastTarget: CaptureTarget? = null
        private set

    // --- lifecycle ---------------------------------------------------------------

    fun initializeAsync() {
        if (status == "initializing" || status == "ready") return
        setStatus("initializing", null)
        worker.execute { initializeBlocking() }
    }

    private fun initializeBlocking() {
        val reasons = ArrayList<String>()
        val cfg = config
        val qnnOk = DeviceCapabilityManager.supportsBundledQnn()

        for (info in modelManager.detectors()) {
            val attempts = ArrayList<Pair<String, () -> ModelRunner>>()
            when (info.format) {
                "onnx-qnn" -> if (cfg.preferQnn && qnnOk) {
                    attempts.add("${info.id}/htp" to { OrtModelRunner(context, modelManager.resolve(info).path, true, cfg.qnnPerformanceMode, info.outputName) })
                } else reasons.add("${info.id}: QNN unavailable on ${DeviceCapabilityManager.socModel}")
                "onnx-cpu" -> attempts.add("${info.id}/cpu" to { OrtModelRunner(context, modelManager.resolve(info).path, false, cfg.qnnPerformanceMode, info.outputName) })
                "litert" -> {
                    if (cfg.allowGpu) attempts.add("${info.id}/gpu" to { LiteRtModelRunner(modelManager.resolve(info).path, true) })
                    attempts.add("${info.id}/cpu" to { LiteRtModelRunner(modelManager.resolve(info).path, false) })
                }
            }
            for ((name, make) in attempts) {
                var runner: ModelRunner? = null
                try {
                    val t0 = SystemClock.elapsedRealtime()
                    runner = make()
                    val model = modelManager.resolve(info)
                    val b = ObjectDetectorBackend(runner, model)
                    val ms = SystemClock.elapsedRealtime() - t0
                    backend = b
                    converter = FrameConverter(b.getInputSize())
                    decoder = YoloDecoder(model.labels, model.numClasses, model.allowedLabels)
                    diagnostics.backend = b.getBackendName()
                    diagnostics.execution = b.getExecutionTarget()
                    diagnostics.modelName = b.getModelName()
                    diagnostics.inputSize = b.getInputSize()
                    diagnostics.fallbackReasons = reasons.toList()
                    diagnostics.backendNotes = "${info.id} init ${ms}ms"
                    Log.i(tag, "Detector $name active (${model.labels.size} classes, init ${ms}ms); skipped: $reasons")
                    setStatus("ready", null)
                    if (mode == VisionMode.CAPTURE) ensureDepth()
                    return
                } catch (t: Throwable) {
                    runCatching { runner?.close() }
                    reasons.add("$name: ${t.javaClass.simpleName}: ${t.message?.take(240)}")
                    Log.w(tag, "Detector $name failed", t)
                }
            }
        }
        diagnostics.fallbackReasons = reasons.toList()
        setStatus("error", "No detector could start. ${reasons.joinToString(" | ")}")
    }

    /** Loads the depth model once, on the worker, the first time capture mode needs it. */
    private fun ensureDepth() {
        if (depthState != "idle") return
        depthState = "loading"
        worker.execute {
            val cfg = config
            val qnnOk = DeviceCapabilityManager.supportsBundledQnn()
            for (info in modelManager.depthModels()) {
                val makers = ArrayList<Pair<String, () -> ModelRunner>>()
                when (info.format) {
                    "onnx-qnn" -> if (cfg.preferQnn && qnnOk) makers.add("${info.id}/htp" to { OrtModelRunner(context, modelManager.resolve(info).path, true, cfg.qnnPerformanceMode, info.outputName) })
                    "litert" -> {
                        if (cfg.allowGpu) makers.add("${info.id}/gpu" to { LiteRtModelRunner(modelManager.resolve(info).path, true) })
                        makers.add("${info.id}/cpu" to { LiteRtModelRunner(modelManager.resolve(info).path, false) })
                    }
                }
                for ((name, make) in makers) {
                    var runner: ModelRunner? = null
                    try {
                        val r = make()
                        runner = r
                        val est = DepthEstimator(r, modelManager.resolve(info))
                        require(r.inputSize == converter?.inputSize) {
                            "depth input ${r.inputSize} != detector input ${converter?.inputSize}"
                        }
                        depth = est
                        depthState = "ready"
                        Log.i(tag, "Depth $name active (${est.width}x${est.height}, layout=${est.inputLayout})")
                        return@execute
                    } catch (t: Throwable) {
                        runCatching { runner?.close() }
                        depthError = "$name: ${t.message?.take(200)}"
                        Log.w(tag, "Depth $name failed", t)
                    }
                }
            }
            depthState = "unavailable"
            Log.w(tag, "No depth model available; closest object falls back to size/centre. $depthError")
        }
    }

    fun setMode(m: VisionMode) {
        if (m == mode) return
        mode = m
        closest.focus = null
        // Per-frame state belongs to the worker; reset it there so it never races a frame in flight.
        worker.execute {
            tracker.reset()
            resolver.reset()
            closest.reset()
            trackDepth.clear()
            lastTarget = null
            lastEmitSignature = ""
            lastTargetSignature = ""
            readout.reset()
        }
        if (m == VisionMode.CAPTURE && status == "ready") ensureDepth()
        Log.i(tag, "Mode $m")
    }

    fun setFocusPoint(x: Float, y: Float) {
        closest.focus = x.coerceIn(0f, 1f) to y.coerceIn(0f, 1f)
    }

    fun clearFocusPoint() {
        closest.focus = null
    }

    fun start() {
        running = true
        initializeAsync()
    }

    fun stop() {
        running = false
    }

    val isRunning: Boolean get() = running

    // --- frames ------------------------------------------------------------------

    /** Called on VisionCamera's frame-processor thread for every camera frame. */
    fun onFrame(frame: Frame) {
        if (!running) return
        val b = backend ?: return
        val conv = converter ?: return
        val now = SystemClock.elapsedRealtime()
        val interval = 1000L / config.targetFps.coerceAtLeast(1) - FRAME_SLACK_MS
        if (now - lastAccepted < interval) {
            diagnostics.throttled()
            return
        }
        if (!busy.compareAndSet(false, true)) {
            diagnostics.dropped()
            return
        }
        lastAccepted = now
        val d = depth
        val wantDepth = mode == VisionMode.CAPTURE && d != null && now - lastDepthAt >= config.depthIntervalMs
        val secondary = if (wantDepth && d!!.inputLayout != b.inputLayout) d.inputLayout else null
        val t0 = System.nanoTime()
        val ok = try {
            conv.convert(frame.image, frame.imageProxy.imageInfo.rotationDegrees, frame.isMirrored, b.inputLayout, secondary)
        } catch (t: Throwable) {
            Log.w(tag, "Frame conversion failed: ${t.message}")
            false
        }
        if (!ok) {
            diagnostics.conversionError()
            busy.set(false)
            return
        }
        if (wantDepth) lastDepthAt = now
        val preMs = (System.nanoTime() - t0) / 1e6
        val letterbox = conv.letterbox
        worker.execute {
            try {
                process(b, conv, letterbox, preMs, if (wantDepth) d else null, secondary != null)
            } catch (t: Throwable) {
                Log.w(tag, "Inference failed: ${t.message}", t)
            } finally {
                busy.set(false)
            }
        }
    }

    private fun process(
        b: ObjectDetectorBackend, conv: FrameConverter, lb: Letterbox, preMs: Double,
        d: DepthEstimator?, depthUsesSecondary: Boolean,
    ) {
        val cfg = config
        val dec = decoder ?: return
        val t1 = System.nanoTime()
        val out = b.detect(conv.buffer)
        val t2 = System.nanoTime()
        val raw = dec.decode(out, b.outputFeatures, b.outputAnchors, lb, cfg.minConfidence, cfg.nmsIou, cfg.maxDetections)
        val t3 = System.nanoTime()
        val now = SystemClock.elapsedRealtime()
        val tracked = tracker.update(raw, now, cfg)
        val visible = tracked.map { resolver.toDetection(it, now) }
        val event = resolver.resolve(visible, now, cfg)
        val t4 = System.nanoTime()
        diagnostics.lastEvent = event

        if (mode == VisionMode.GUIDE) {
            readout.onPrimary(event, cfg)
        } else {
            if (d != null && visible.isNotEmpty()) {
                val td = System.nanoTime()
                val map = d.estimate(if (depthUsesSecondary) conv.buffer2 else conv.buffer)
                val live = visible.map { it.trackId }.toSet()
                trackDepth.keys.retainAll(live)
                for (v in visible) DepthSampler.sample(map, d.width, d.height, v.bbox, lb)?.let { trackDepth[v.trackId] = it }
                lastDepthMs = (System.nanoTime() - td) / 1e6
            }
            val target = closest.resolve(visible, { id -> trackDepth[id] }, cfg)
            lastTarget = target
            maybeEmitTarget(target, now)
        }
        val t5 = System.nanoTime()
        diagnostics.record(
            preMs = preMs,
            inferMs = (t2 - t1) / 1e6,
            postMs = (t3 - t2) / 1e6,
            trackMs = (t4 - t3) / 1e6,
            totalMs = preMs + (t5 - t1) / 1e6,
            now = now,
            detections = raw.size,
            visible = visible.size,
        )
        maybeEmitState(event, visible, now)
        maybeLogDiagnostics(now)
    }

    // --- events ------------------------------------------------------------------

    private var lastEmitAt = 0L
    private var lastEmitSignature = ""
    private var lastPrimaryEmitted: String? = null
    private var lastTargetSignature = ""
    private var lastTargetAt = 0L

    /** Compact state for the overlay: only when something visible changed, at most 5 Hz. */
    private fun maybeEmitState(event: PrimaryVisionEvent?, visible: List<VisionDetection>, now: Long) {
        val sig = buildString {
            append(event?.primaryObject?.trackId).append('|').append(event?.direction).append('|')
            visible.sortedBy { it.trackId }.forEach { d ->
                append(d.trackId).append(':')
                append((d.bbox.centerX * 20).toInt()).append(',').append((d.bbox.centerY * 20).toInt()).append(',')
                append((d.bbox.width * 20).toInt()).append(';')
            }
        }
        if (sig == lastEmitSignature) return
        if (now - lastEmitAt < 200L && event?.primaryObject?.trackId == lastPrimaryEmitted) return
        lastEmitSignature = sig
        lastEmitAt = now
        lastPrimaryEmitted = event?.primaryObject?.trackId
        emitter.onVisionState(stateMap(event, visible, now))
    }

    /** The capture target, when its identity, count or position meaningfully changes (≤5 Hz). */
    private fun maybeEmitTarget(target: CaptureTarget?, now: Long) {
        val sig = if (target == null) "none" else
            "${target.trackId}|${target.method}|${target.objectCount}|${(target.bbox.centerX * 20).toInt()},${(target.bbox.centerY * 20).toInt()},${(target.bbox.width * 20).toInt()}"
        if (sig == lastTargetSignature) return
        val identityChanged = sig.substringBefore('|') != lastTargetSignature.substringBefore('|')
        if (!identityChanged && now - lastTargetAt < 200L) return
        lastTargetSignature = sig
        lastTargetAt = now
        emitter.onCaptureTarget(target?.toMap() ?: mapOf("trackId" to null, "objectCount" to 0, "multipleObjectsDetected" to false))
    }

    fun stateMap(event: PrimaryVisionEvent?, visible: List<VisionDetection>, now: Long): Map<String, Any?> = mapOf(
        "primaryObject" to event?.primaryObject?.toMap(),
        "direction" to event?.direction?.jsValue,
        "multipleObjectsDetected" to (event?.multipleObjectsDetected ?: false),
        "objectCount" to (event?.objectCount ?: 0),
        "objects" to visible.take(10).map { d ->
            mapOf(
                "trackId" to d.trackId,
                "label" to d.label,
                "spokenLabel" to LabelNames.spoken(d.label),
                "bbox" to d.bbox.toMap(),
                "isPrimary" to (d.trackId == event?.primaryObject?.trackId),
            )
        },
        "timestamp" to now,
    )

    // --- ReadoutManager.Listener ---------------------------------------------

    override fun onReadout(readout: LatestReadout, spoken: Boolean) {
        emitter.onReadout(readout.toMap() + ("spoken" to spoken))
    }

    override fun onFormatRequest(requestId: Long, event: PrimaryVisionEvent, fallbackText: String) {
        emitter.onFormatRequest(
            mapOf(
                "requestId" to requestId.toDouble(),
                "event" to event.compact(),
                "fallbackText" to fallbackText,
                "timeoutMs" to config.externalFormatTimeoutMs,
            ),
        )
        timer.schedule({ readout.onExternalTimeout(requestId, config) }, config.externalFormatTimeoutMs, TimeUnit.MILLISECONDS)
    }

    fun completeExternal(requestId: Long, text: String?): Boolean = readout.completeExternal(requestId, text, config)

    // --- status / diagnostics ------------------------------------------------------

    private fun setStatus(s: String, err: String?) {
        status = s
        statusError = err
        emitter.onStatus(statusMap())
    }

    fun statusMap(): Map<String, Any?> = mapOf(
        "status" to status,
        "error" to statusError,
        "running" to running,
        "mode" to mode.name.lowercase(),
        "backend" to backend?.getBackendName(),
        "execution" to backend?.getExecutionTarget(),
        "model" to backend?.getModelName(),
        "modelId" to backend?.model?.id,
        "classes" to backend?.model?.labels?.size,
        "inputSize" to backend?.getInputSize(),
        "depth" to depthState,
        "depthExecution" to depth?.target,
        "fallbackReasons" to diagnostics.fallbackReasons,
        "device" to DeviceCapabilityManager.describe(),
        "tts" to tts.describe(),
    )

    fun diagnosticsMap(): Map<String, Any?> =
        diagnostics.toMap(SystemClock.elapsedRealtime(), resolver.lastScores, readout.readoutEnabled, config) +
            mapOf(
                "tts" to tts.describe(),
                "activeTracks" to tracker.activeTrackCount,
                "mode" to mode.name.lowercase(),
                "modelId" to backend?.model?.id,
                "depth" to depthState,
                "depthExecution" to depth?.target,
                "depthMs" to lastDepthMs,
                "captureTarget" to lastTarget?.toMap(),
            )

    private var lastDiagLog = 0L

    /** One measured summary line every 10 s — the benchmark record (adb logcat -s WorldVision). */
    private fun maybeLogDiagnostics(now: Long) {
        if (now - lastDiagLog < 10_000L) return
        lastDiagLog = now
        val d = diagnosticsMap()
        val t = lastTarget
        Log.i(
            tag,
            "diag mode=${mode.name.lowercase()} model=${backend?.model?.id} backend=${d["backend"]}/${d["execution"]} " +
                "fps=${"%.1f".format(d["fps"] as Double)} " +
                "infer_p50=${"%.1f".format(d["inferenceMsP50"] as Double)} infer_p95=${"%.1f".format(d["inferenceMsP95"] as Double)} " +
                "pre_p50=${"%.1f".format(d["preprocessMsP50"] as Double)} post_p50=${"%.1f".format(d["postprocessMsP50"] as Double)} " +
                "total_p50=${"%.1f".format(d["totalMsP50"] as Double)} total_p95=${"%.1f".format(d["totalMsP95"] as Double)} " +
                "depth=${depthState}/${depth?.target} depth_ms=${"%.1f".format(lastDepthMs)} " +
                "processed=${d["framesProcessed"]} dropped=${d["framesDropped"]} primary=${d["primary"]} count=${d["objectCount"]} " +
                "target=${t?.label}/${t?.method}/${t?.depth?.let { "%.2f".format(it) }} " +
                "tts_p50=${"%.0f".format(d["ttsLatencyMsP50"] as Double)} spoken=${readout.spokenCount}",
        )
    }

    fun shutdown() {
        running = false
        worker.execute {
            runCatching { backend?.close() }
            runCatching { depth?.close() }
            backend = null
            depth = null
        }
        worker.shutdown()
        timer.shutdownNow()
        tts.shutdown()
    }

    private companion object {
        /** Camera frames arrive every ~33 ms; half a frame of slack lands the throttle on target. */
        const val FRAME_SLACK_MS = 15L
    }
}
