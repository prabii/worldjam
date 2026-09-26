package com.worldjam.vision

/**
 * Where the upright camera image sits inside the square model input.
 *
 * The frame is scaled uniformly by [scale] and centred with [padX]/[padY] of
 * grey on the short side, so aspect ratio is preserved. Decoding runs the same
 * mapping backwards.
 */
data class Letterbox(
    val inputSize: Int,
    val scale: Float,
    val padX: Float,
    val padY: Float,
    val srcWidth: Int,
    val srcHeight: Int,
) {
    companion object {
        fun forSource(inputSize: Int, srcWidth: Int, srcHeight: Int): Letterbox {
            val scale = minOf(inputSize.toFloat() / srcWidth, inputSize.toFloat() / srcHeight)
            val padX = (inputSize - srcWidth * scale) / 2f
            val padY = (inputSize - srcHeight * scale) / 2f
            return Letterbox(inputSize, scale, padX, padY, srcWidth, srcHeight)
        }
    }
}

/**
 * Decodes YOLO26n's one-to-many head.
 *
 * Both bundled models (QNN and LiteRT) emit a channel-major [1, 4+C, A] tensor:
 * rows 0..3 are cx, cy, w, h and rows 4.. are per-class scores that are already
 * sigmoid-activated. Neither export includes NMS, so it runs here.
 *
 * Box coordinates are either model pixels or normalised 0..1 depending on the
 * export; this is detected per frame from the magnitude (the same rule
 * Ultralytics' own Android runtime uses), so both backends produce identical
 * [RawDetection]s.
 */
class YoloDecoder(
    private val labels: List<String>,
    /** Class rows in the tensor. Seg-headed models add mask coefficients after them, which are not classes. */
    private val classCount: Int = labels.size,
    /** When set, detections with any other label are discarded (e.g. people from the COCO fallback). */
    private val allowedLabels: Set<String>? = null,
) {

    fun decode(
        output: FloatArray,
        numFeatures: Int,
        numAnchors: Int,
        letterbox: Letterbox,
        minConfidence: Float,
        iouThreshold: Float,
        maxDetections: Int,
    ): List<RawDetection> {
        val numClasses = minOf(classCount, numFeatures - 4)
        require(numClasses > 0) { "Expected at least one class, got $numFeatures features" }
        require(output.size >= numFeatures * numAnchors) {
            "Output has ${output.size} values, expected ${numFeatures * numAnchors}"
        }

        // Pass 1: best class per anchor, keep only those above the floor.
        val keptAnchor = IntArray(numAnchors)
        val keptClass = IntArray(numAnchors)
        val keptScore = FloatArray(numAnchors)
        var kept = 0
        var maxCoord = 0f
        for (a in 0 until numAnchors) {
            var best = -1f
            var bestC = -1
            var idx = 4 * numAnchors + a
            for (c in 0 until numClasses) {
                val s = output[idx]
                if (s > best) {
                    best = s
                    bestC = c
                }
                idx += numAnchors
            }
            if (best >= minConfidence && best <= 1.0001f) {
                keptAnchor[kept] = a
                keptClass[kept] = bestC
                keptScore[kept] = best
                kept++
                val cx = output[a]
                val cy = output[numAnchors + a]
                val w = output[2 * numAnchors + a]
                val h = output[3 * numAnchors + a]
                maxCoord = maxOf(maxCoord, cx + w / 2f, cy + h / 2f)
            }
        }
        if (kept == 0) return emptyList()

        val coordScale = if (maxCoord <= 2f) letterbox.inputSize.toFloat() else 1f

        // Pass 2: into the upright source frame, normalised.
        val candidates = ArrayList<RawDetection>(kept)
        for (k in 0 until kept) {
            val a = keptAnchor[k]
            val cx = output[a] * coordScale
            val cy = output[numAnchors + a] * coordScale
            val w = output[2 * numAnchors + a] * coordScale
            val h = output[3 * numAnchors + a] * coordScale

            val x1 = ((cx - w / 2f) - letterbox.padX) / letterbox.scale
            val y1 = ((cy - h / 2f) - letterbox.padY) / letterbox.scale
            val x2 = ((cx + w / 2f) - letterbox.padX) / letterbox.scale
            val y2 = ((cy + h / 2f) - letterbox.padY) / letterbox.scale

            val nx1 = (x1 / letterbox.srcWidth).coerceIn(0f, 1f)
            val ny1 = (y1 / letterbox.srcHeight).coerceIn(0f, 1f)
            val nx2 = (x2 / letterbox.srcWidth).coerceIn(0f, 1f)
            val ny2 = (y2 / letterbox.srcHeight).coerceIn(0f, 1f)
            val bw = nx2 - nx1
            val bh = ny2 - ny1
            // Slivers left over after clamping to the frame are not objects.
            if (bw < 0.01f || bh < 0.01f) continue

            val cls = keptClass[k]
            val label = labels.getOrElse(cls) { "object" }
            if (allowedLabels != null && label !in allowedLabels) continue
            candidates.add(RawDetection(cls, label, keptScore[k], NormBox(nx1, ny1, bw, bh)))
        }

        return nms(candidates, iouThreshold, maxDetections)
    }

    companion object {
        /** Greedy per-class non-maximum suppression, highest confidence first. */
        fun nms(candidates: List<RawDetection>, iouThreshold: Float, maxDetections: Int): List<RawDetection> {
            val sorted = candidates.sortedByDescending { it.confidence }
            val out = ArrayList<RawDetection>()
            for (c in sorted) {
                if (out.size >= maxDetections) break
                var suppressed = false
                for (o in out) {
                    if (o.classId == c.classId && o.box.iou(c.box) > iouThreshold) {
                        suppressed = true
                        break
                    }
                }
                if (!suppressed) out.add(c)
            }
            return out
        }
    }
}
