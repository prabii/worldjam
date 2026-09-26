package com.worldjam.vision

/**
 * Canonical vision types.
 *
 * Everything here is plain Kotlin with no Android imports, so the whole
 * decision pipeline (decode → track → resolve → read-out) is unit-testable on
 * the JVM. Coordinates are normalised 0..1 in the UPRIGHT frame the user sees,
 * origin top-left, so nothing downstream needs to know the sensor rotation.
 */

data class NormBox(val x: Float, val y: Float, val width: Float, val height: Float) {
    val centerX: Float get() = x + width / 2f
    val centerY: Float get() = y + height / 2f
    val area: Float get() = width * height
    val right: Float get() = x + width
    val bottom: Float get() = y + height

    fun contains(px: Float, py: Float): Boolean = px >= x && px <= right && py >= y && py <= bottom

    fun iou(other: NormBox): Float {
        val ix = maxOf(0f, minOf(right, other.right) - maxOf(x, other.x))
        val iy = maxOf(0f, minOf(bottom, other.bottom) - maxOf(y, other.y))
        val inter = ix * iy
        val union = area + other.area - inter
        return if (union <= 0f) 0f else inter / union
    }

    fun toMap(): Map<String, Any> = mapOf("x" to x, "y" to y, "width" to width, "height" to height)
}

/** One detector output after decoding and NMS, before tracking. */
data class RawDetection(
    val classId: Int,
    val label: String,
    val confidence: Float,
    val box: NormBox,
)

enum class Direction(val jsValue: String) {
    LEFT("left"),
    CENTER("center"),
    RIGHT("right"),
}

/** A tracked, temporally stable object — the unit every consumer sees. */
data class VisionDetection(
    val trackId: String,
    val label: String,
    val confidence: Float,
    val bbox: NormBox,
    val centerX: Float,
    val centerY: Float,
    val areaRatio: Float,
    val centerScore: Float,
    val timestamp: Long,
) {
    fun toMap(): Map<String, Any> = mapOf(
        "trackId" to trackId,
        "label" to label,
        "spokenLabel" to LabelNames.spoken(label),
        "confidence" to confidence,
        "bbox" to bbox.toMap(),
        "center" to mapOf("x" to centerX, "y" to centerY),
        "areaRatio" to areaRatio,
        "centerScore" to centerScore,
        "timestamp" to timestamp,
    )
}

/** How a candidate's priority was reached, for diagnostics and tuning. */
data class PriorityScore(
    val confidenceScore: Float,
    val areaScore: Float,
    val centerScore: Float,
    val priority: Float,
)

/** The resolver's output for one processed frame. */
data class PrimaryVisionEvent(
    val primaryObject: VisionDetection,
    val score: PriorityScore,
    val multipleObjectsDetected: Boolean,
    val objectCount: Int,
    val allVisibleObjects: List<VisionDetection>,
    val direction: Direction,
    val timestamp: Long,
) {
    /** The compact shape handed to an optional formatter (e.g. Gemma). */
    fun compact(): Map<String, Any> = mapOf(
        "primary" to LabelNames.spoken(primaryObject.label),
        "direction" to direction.jsValue,
        "additionalObjectCount" to (objectCount - 1),
    )
}

/** What the speaker button repeats. */
data class LatestReadout(
    val objectId: String,
    val label: String,
    val confidence: Float,
    val direction: Direction,
    val multipleObjectsDetected: Boolean,
    val objectCount: Int,
    val text: String,
    val timestamp: Long,
) {
    fun toMap(): Map<String, Any> = mapOf(
        "objectId" to objectId,
        "label" to label,
        "confidence" to confidence,
        "direction" to direction.jsValue,
        "multipleObjectsDetected" to multipleObjectsDetected,
        "objectCount" to objectCount,
        "text" to text,
        "timestamp" to timestamp,
    )
}

enum class InputLayout { NHWC, NCHW }

/** GUIDE: the Object Guide screen, with automatic read-out. CAPTURE: the music capture screen — names the closest object, never speaks by itself. */
enum class VisionMode { GUIDE, CAPTURE }
