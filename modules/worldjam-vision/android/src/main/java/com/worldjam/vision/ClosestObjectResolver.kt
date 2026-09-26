package com.worldjam.vision

/** The object the capture screen will name the next recording after. */
data class CaptureTarget(
    val trackId: String,
    val label: String,
    val confidence: Float,
    val bbox: NormBox,
    /** Model depth value (metric metres for yolo26n-depth); null when depth was not used. */
    val depth: Float?,
    /** "tap" | "depth" | "size" — how it was chosen. */
    val method: String,
    val objectCount: Int,
    /** Every other visible object, nearest first when depth is known. */
    val others: List<String>,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "trackId" to trackId,
        "label" to label,
        "spokenLabel" to LabelNames.spoken(label),
        "confidence" to confidence,
        "bbox" to bbox.toMap(),
        "depth" to depth,
        "method" to method,
        "objectCount" to objectCount,
        "multipleObjectsDetected" to (objectCount > 1),
        "others" to others.map { LabelNames.spoken(it) },
    )
}

/** Reads a depth map at a detection's box. */
object DepthSampler {
    /**
     * A low percentile of depth over the inner part of the box. The inner crop
     * avoids background bleeding in at the edges; a low percentile (rather than
     * the median) favours the object's near surface over whatever is behind it.
     */
    fun sample(
        map: FloatArray, mapW: Int, mapH: Int, box: NormBox, lb: Letterbox,
        inner: Float = 0.6f, percentile: Float = 0.3f,
    ): Float? {
        val sx = mapW.toFloat() / lb.inputSize
        val sy = mapH.toFloat() / lb.inputSize
        val shrinkW = box.width * (1f - inner) / 2f
        val shrinkH = box.height * (1f - inner) / 2f
        fun px(nx: Float) = ((nx * lb.srcWidth * lb.scale + lb.padX) * sx).toInt().coerceIn(0, mapW - 1)
        fun py(ny: Float) = ((ny * lb.srcHeight * lb.scale + lb.padY) * sy).toInt().coerceIn(0, mapH - 1)
        val x0 = px(box.x + shrinkW); val x1 = px(box.right - shrinkW)
        val y0 = py(box.y + shrinkH); val y1 = py(box.bottom - shrinkH)
        if (x1 < x0 || y1 < y0) return null
        val step = maxOf(1, maxOf(x1 - x0, y1 - y0) / 24)
        val values = ArrayList<Float>()
        var y = y0
        while (y <= y1) {
            var x = x0
            while (x <= x1) {
                val v = map[y * mapW + x]
                if (v.isFinite()) values.add(v)
                x += step
            }
            y += step
        }
        if (values.isEmpty()) return null
        values.sort()
        return values[((values.size - 1) * percentile).toInt()]
    }
}

/**
 * Picks the object nearest the camera, for naming a captured sound.
 *
 * Priority:
 *  1. a user tap — the smallest stable box containing the tapped point;
 *  2. depth — the smallest depth value (nearest), from the monocular depth map;
 *  3. apparent size and centring, when no depth is available yet.
 *
 * A challenger must be clearly nearer for a couple of evaluations before the
 * target changes, so two objects at similar distance do not flicker.
 */
class ClosestObjectResolver {

    @Volatile var focus: Pair<Float, Float>? = null
    private var currentId: String? = null
    private var challengerId: String? = null
    private var challengerFrames = 0

    fun reset() {
        currentId = null
        challengerId = null
        challengerFrames = 0
    }

    fun resolve(
        visible: List<VisionDetection>,
        depthOf: (String) -> Float?,
        config: VisionConfig,
    ): CaptureTarget? {
        if (visible.isEmpty()) return null

        val f = focus
        if (f != null) {
            val hit = visible.filter { it.bbox.contains(f.first, f.second) }.minByOrNull { it.areaRatio }
            if (hit != null) {
                currentId = hit.trackId
                return target(hit, depthOf(hit.trackId), "tap", visible, depthOf, config)
            }
        }

        val withDepth = visible.mapNotNull { d -> depthOf(d.trackId)?.let { d to nearness(it, config) } }
        if (withDepth.isNotEmpty()) {
            val chosen = hysteresis(withDepth, config.closestSwitchMargin, relative = true, config)
            return target(chosen, depthOf(chosen.trackId), "depth", visible, depthOf, config)
        }

        val bySize = visible.map { d ->
            val area = (d.areaRatio / config.areaSaturation).coerceIn(0f, 1f)
            d to (0.7f * area + 0.3f * d.centerScore)
        }
        val chosen = hysteresis(bySize, config.primarySwitchMargin, relative = false, config)
        return target(chosen, null, "size", visible, depthOf, config)
    }

    /** Higher = nearer, whichever way the depth model encodes distance. */
    private fun nearness(depth: Float, config: VisionConfig): Float = if (config.depthNearIsSmall) -depth else depth

    private fun hysteresis(
        scored: List<Pair<VisionDetection, Float>>,
        margin: Float,
        relative: Boolean,
        config: VisionConfig,
    ): VisionDetection {
        val best = scored.maxByOrNull { it.second }!!
        val current = scored.firstOrNull { it.first.trackId == currentId }
        val chosen = when {
            current == null || best.first.trackId == current.first.trackId -> {
                challengerId = null; challengerFrames = 0
                best.first
            }
            else -> {
                val gap = best.second - current.second
                val needed = if (relative) kotlin.math.abs(current.second) * margin else margin
                if (gap > needed) {
                    if (challengerId == best.first.trackId) challengerFrames++ else {
                        challengerId = best.first.trackId; challengerFrames = 1
                    }
                    if (challengerFrames >= config.closestSwitchFrames) {
                        challengerId = null; challengerFrames = 0
                        best.first
                    } else current.first
                } else {
                    challengerId = null; challengerFrames = 0
                    current.first
                }
            }
        }
        currentId = chosen.trackId
        return chosen
    }

    private fun target(
        d: VisionDetection, depth: Float?, method: String, visible: List<VisionDetection>,
        depthOf: (String) -> Float?, config: VisionConfig,
    ): CaptureTarget {
        val others = visible.filter { it.trackId != d.trackId }
            .sortedByDescending { o -> depthOf(o.trackId)?.let { nearness(it, config) } ?: Float.NEGATIVE_INFINITY }
            .map { it.label }
        return CaptureTarget(d.trackId, d.label, d.confidence, d.bbox, depth, method, visible.size, others)
    }
}
