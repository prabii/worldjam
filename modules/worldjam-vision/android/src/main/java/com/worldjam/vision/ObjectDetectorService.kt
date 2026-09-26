package com.worldjam.vision

import android.content.Context
import android.os.SystemClock
import android.util.Log
import com.mrousavy.camera.frameprocessors.Frame
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The native vision pipeline.
 *
 *   camera frame (plugin thread)
 *     → throttle / drop-if-busy          never queue: a stale frame is worthless
 *     → FrameConverter (copy + letterbox) camera buffer released on return
 *   inference worker (one thread)
 *     → backend.detect → YoloDecoder → DetectionTracker → PrimaryObjectResolver
 *     → ReadoutManager (TTS) → compact event to JS
 *
 * Backend selection: QNN HTP → LiteRT GPU → LiteRT CPU. Each failure is logged
 * with its exact reason and surfaced in diagnostics.
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
    }

    private val tag = "WorldVision"

    @Volatile var config = VisionConfig()
    val diagnostics = VisionDiagnostics()
    private val modelManager = ModelManager(context)
    private val tracker = DetectionTracker()
    private val resolver = PrimaryObjectResolver()
    val tts = TTSManager(context) { diagnostics.ttsLatency(it) }
    val readout = ReadoutManager(DirectReadoutFormatter(), tts, LatestReadoutStore(), { SystemClock.elapsedRealtime() }, this)

    private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "WorldVision-infer").apply { priority = Thread.NORM_PRIORITY } }
    private val timer = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "WorldVision-timer") }
    private val busy = AtomicBoolean(false)
    @Volatile private var running = false
    @Volatile private var lastAccepted = 0L

    @Volatile var backend: ObjectDetectorBackend? = null
        private set
    private var converter: FrameConverter? = null
    private var decoder: YoloDecoder? = null

    @Volatile var status: String = "idle"   // idle | initializing | ready | error
        private set
    @Volatile var statusError: String? = null
        private set

    // Change detection for the throttled JS state event.
    private var lastEmitAt = 0L
    private var lastEmitSignature = ""

    /** Loads a model on the worker thread. Safe to call repeatedly. */
    fun initializeAsync() {
        if (status == "initializing" || status == "ready") return
        setStatus("initializing", null)
        worker.execute { initializeBlocking() }
    }

    private fun initializeBlocking() {
        val reasons = ArrayList<String>()
        val cfg = config
        val attempts = ArrayList<Pair<String, () -> ObjectDetectorBackend>>()
        if (cfg.preferQnn) {
            if (DeviceCapabilityManager.supportsBundledQnn()) {
                attempts.add("qnn-htp" to { QNNObjectDetectorBackend(context, modelManager.resolve("onnx-qnn"), cfg.qnnPerformanceMode) })
            } else {
                reasons.add("qnn-htp: device ${DeviceCapabilityManager.socModel} (HTP ${DeviceCapabilityManager.htpArch}) does not match the bundled v81 model")
            }
        }
        if (cfg.allowGpu) attempts.add("litert-gpu" to { LiteRTObjectDetectorBackend(modelManager.resolve("litert"), useGpu = true) })
        attempts.add("litert-cpu" to { LiteRTObjectDetectorBackend(modelManager.resolve("litert"), useGpu = false) })

        for ((name, make) in attempts) {
            var b: ObjectDetectorBackend? = null
            try {
                val t0 = SystemClock.elapsedRealtime()
                b = make()
                b.initialize()
                val ms = SystemClock.elapsedRealtime() - t0
                backend = b
                converter = FrameConverter(b.getInputSize())
                decoder = YoloDecoder(modelManager.labels)
                diagnostics.backend = b.getBackendName()
                diagnostics.execution = b.getExecutionTarget()
                diagnostics.modelName = b.getModelName()
                diagnostics.inputSize = b.getInputSize()
                diagnostics.fallbackReasons = reasons.toList()
                diagnostics.backendNotes = "init ${ms}ms"
                Log.i(tag, "Backend $name active (init ${ms}ms); skipped: $reasons")
                setStatus("ready", null)
                return
            } catch (t: Throwable) {
                runCatching { b?.close() }
                val reason = "$name: ${t.javaClass.simpleName}: ${t.message?.take(300)}"
                Log.w(tag, "Backend $name failed", t)
                reasons.add(reason)
            }
        }
        diagnostics.fallbackReasons = reasons.toList()
        setStatus("error", "No detector backend could start. ${reasons.joinToString(" | ")}")
    }

    fun start() {
        running = true
        initializeAsync()
    }

    fun stop() {
        running = false
    }

    val isRunning: Boolean get() = running

    /** Called on VisionCamera's frame-processor thread for every camera frame. */
    fun onFrame(frame: Frame) {
        if (!running) return
        val b = backend ?: return
        val conv = converter ?: return
        val now = SystemClock.elapsedRealtime()
        // Camera frames arrive every ~33 ms, so a strict interval rounds up to
        // the next frame and undershoots the target; half a frame of slack
        // lands it on target.
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
        val t0 = System.nanoTime()
        val ok = try {
            val image = frame.image
            val rotation = frame.imageProxy.imageInfo.rotationDegrees
            conv.convert(image, rotation, frame.isMirrored, b.inputLayout)
        } catch (t: Throwable) {
            Log.w(tag, "Frame conversion failed: ${t.message}")
            false
        }
        if (!ok) {
            diagnostics.conversionError()
            busy.set(false)
            return
        }
        val preMs = (System.nanoTime() - t0) / 1e6
        val letterbox = conv.letterbox
        worker.execute {
            try {
                process(b, conv, letterbox, preMs)
            } catch (t: Throwable) {
                Log.w(tag, "Inference failed: ${t.message}", t)
            } finally {
                busy.set(false)
            }
        }
    }

    private fun process(b: ObjectDetectorBackend, conv: FrameConverter, lb: Letterbox, preMs: Double) {
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
        readout.onPrimary(event, cfg)
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

    private var lastDiagLog = 0L

    private companion object {
        const val FRAME_SLACK_MS = 15L
    }

    /** One measured summary line every 10 s — the benchmark record (adb logcat -s WorldVision). */
    private fun maybeLogDiagnostics(now: Long) {
        if (now - lastDiagLog < 10_000L) return
        lastDiagLog = now
        val d = diagnosticsMap()
        Log.i(
            tag,
            "diag backend=${d["backend"]}/${d["execution"]} fps=${"%.1f".format(d["fps"] as Double)} " +
                "infer_p50=${"%.1f".format(d["inferenceMsP50"] as Double)} infer_p95=${"%.1f".format(d["inferenceMsP95"] as Double)} " +
                "pre_p50=${"%.1f".format(d["preprocessMsP50"] as Double)} post_p50=${"%.1f".format(d["postprocessMsP50"] as Double)} " +
                "total_p50=${"%.1f".format(d["totalMsP50"] as Double)} total_p95=${"%.1f".format(d["totalMsP95"] as Double)} " +
                "processed=${d["framesProcessed"]} dropped=${d["framesDropped"]} primary=${d["primary"]} " +
                "count=${d["objectCount"]} tts_p50=${"%.0f".format(d["ttsLatencyMsP50"] as Double)} spoken=${readout.spokenCount}",
        )
    }

    /**
     * Sends a compact state update to JS only when something a user would
     * notice changed, and never more than 5 times a second.
     */
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

    private var lastPrimaryEmitted: String? = null

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
        val timeout = config.externalFormatTimeoutMs
        timer.schedule({ readout.onExternalTimeout(requestId, config) }, timeout, java.util.concurrent.TimeUnit.MILLISECONDS)
    }

    fun completeExternal(requestId: Long, text: String?): Boolean = readout.completeExternal(requestId, text, config)

    // --- status ----------------------------------------------------------------

    private fun setStatus(s: String, err: String?) {
        status = s
        statusError = err
        emitter.onStatus(statusMap())
    }

    fun statusMap(): Map<String, Any?> = mapOf(
        "status" to status,
        "error" to statusError,
        "running" to running,
        "backend" to backend?.getBackendName(),
        "execution" to backend?.getExecutionTarget(),
        "model" to backend?.getModelName(),
        "inputSize" to backend?.getInputSize(),
        "fallbackReasons" to diagnostics.fallbackReasons,
        "device" to DeviceCapabilityManager.describe(),
        "tts" to tts.describe(),
    )

    fun diagnosticsMap(): Map<String, Any?> =
        diagnostics.toMap(SystemClock.elapsedRealtime(), resolver.lastScores, readout.readoutEnabled, config) +
            mapOf("tts" to tts.describe(), "activeTracks" to tracker.activeTrackCount)

    fun shutdown() {
        running = false
        worker.execute {
            runCatching { backend?.close() }
            backend = null
        }
        worker.shutdown()
        timer.shutdownNow()
        tts.shutdown()
    }
}
