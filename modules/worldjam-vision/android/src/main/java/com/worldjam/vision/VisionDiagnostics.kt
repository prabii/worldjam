package com.worldjam.vision

/**
 * Measured numbers only. Every value here comes from timers around real work
 * on this device; nothing is estimated or copied from a benchmark.
 */
class VisionDiagnostics {

    private class Window(private val size: Int = 120) {
        private val values = DoubleArray(size)
        private var count = 0
        private var next = 0
        fun add(v: Double) {
            values[next] = v
            next = (next + 1) % size
            if (count < size) count++
        }
        fun percentile(p: Double): Double {
            if (count == 0) return 0.0
            val sorted = values.copyOf(count).also { it.sort() }
            val idx = ((p / 100.0) * (count - 1)).toInt().coerceIn(0, count - 1)
            return sorted[idx]
        }
        fun clear() {
            count = 0
            next = 0
        }
    }

    private val pre = Window()
    private val infer = Window()
    private val post = Window()
    private val track = Window()
    private val total = Window()
    private val tts = Window(40)
    private val frameTimes = ArrayDeque<Long>()

    @Volatile var backend: String = "none"
    @Volatile var execution: String = "none"
    @Volatile var modelName: String = "YOLO26n"
    @Volatile var inputSize: Int = 640
    @Volatile var backendNotes: String = ""
    @Volatile var fallbackReasons: List<String> = emptyList()

    var framesProcessed = 0L
        private set
    var framesDropped = 0L
        private set
    var framesThrottled = 0L
        private set
    var conversionErrors = 0L
        private set
    var lastDetections = 0
        private set
    var lastVisible = 0
        private set

    @Volatile var lastEvent: PrimaryVisionEvent? = null

    @Synchronized fun dropped() { framesDropped++ }
    @Synchronized fun throttled() { framesThrottled++ }
    @Synchronized fun conversionError() { conversionErrors++ }
    @Synchronized fun ttsLatency(ms: Double) { tts.add(ms) }

    @Synchronized
    fun record(preMs: Double, inferMs: Double, postMs: Double, trackMs: Double, totalMs: Double, now: Long, detections: Int, visible: Int) {
        pre.add(preMs)
        infer.add(inferMs)
        post.add(postMs)
        track.add(trackMs)
        total.add(totalMs)
        framesProcessed++
        lastDetections = detections
        lastVisible = visible
        frameTimes.addLast(now)
        while (frameTimes.isNotEmpty() && now - frameTimes.first() > 2000L) frameTimes.removeFirst()
    }

    @Synchronized
    fun reset() {
        pre.clear(); infer.clear(); post.clear(); track.clear(); total.clear(); tts.clear()
        frameTimes.clear()
        framesProcessed = 0; framesDropped = 0; framesThrottled = 0; conversionErrors = 0
    }

    @Synchronized
    fun fps(now: Long): Double {
        while (frameTimes.isNotEmpty() && now - frameTimes.first() > 2000L) frameTimes.removeFirst()
        if (frameTimes.size < 2) return 0.0
        val span = (frameTimes.last() - frameTimes.first()).coerceAtLeast(1L)
        return (frameTimes.size - 1) * 1000.0 / span
    }

    @Synchronized
    fun toMap(now: Long, scores: Map<String, PriorityScore>, readoutEnabled: Boolean, config: VisionConfig): Map<String, Any?> {
        val e = lastEvent
        val primaryScore = e?.let { scores[it.primaryObject.trackId] ?: it.score }
        return mapOf(
            "model" to modelName,
            "backend" to backend,
            "execution" to execution,
            "input" to "${inputSize}x$inputSize",
            "backendNotes" to backendNotes,
            "fallbackReasons" to fallbackReasons,
            "preprocessMsP50" to pre.percentile(50.0),
            "inferenceMsP50" to infer.percentile(50.0),
            "inferenceMsP95" to infer.percentile(95.0),
            "postprocessMsP50" to post.percentile(50.0),
            "trackingMsP50" to track.percentile(50.0),
            "totalMsP50" to total.percentile(50.0),
            "totalMsP95" to total.percentile(95.0),
            "fps" to fps(now),
            "targetFps" to config.targetFps,
            "framesProcessed" to framesProcessed,
            "framesDropped" to framesDropped,
            "framesThrottled" to framesThrottled,
            "conversionErrors" to conversionErrors,
            "rawDetections" to lastDetections,
            "visibleObjects" to lastVisible,
            "primary" to e?.primaryObject?.label,
            "primaryTrackId" to e?.primaryObject?.trackId,
            "confidence" to e?.primaryObject?.confidence,
            "areaScore" to primaryScore?.areaScore,
            "centerScore" to primaryScore?.centerScore,
            "priorityScore" to primaryScore?.priority,
            "objectCount" to (e?.objectCount ?: 0),
            "multiple" to (e?.multipleObjectsDetected ?: false),
            "direction" to e?.direction?.jsValue,
            "readoutEnabled" to readoutEnabled,
            "ttsLatencyMsP50" to tts.percentile(50.0),
            "candidates" to (e?.allVisibleObjects?.take(8)?.map { d ->
                val s = scores[d.trackId]
                mapOf(
                    "trackId" to d.trackId,
                    "label" to d.label,
                    "confidence" to d.confidence,
                    "areaScore" to s?.areaScore,
                    "centerScore" to s?.centerScore,
                    "priority" to s?.priority,
                )
            } ?: emptyList<Map<String, Any?>>()),
        )
    }
}
