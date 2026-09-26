package com.worldjam.vision

import kotlin.math.sqrt

/** Screen-relative direction from the box centre. Not a physical bearing. */
object DirectionCalculator {
    fun direction(centerX: Float, config: VisionConfig): Direction = when {
        centerX < config.directionLeftMax -> Direction.LEFT
        centerX > config.directionRightMin -> Direction.RIGHT
        else -> Direction.CENTER
    }
}

/**
 * Picks the ONE object worth talking about.
 *
 * A 2D detector has no idea of physical distance, so this never claims
 * "nearest". It ranks by relevance instead:
 *
 *   priority = wC·confidence + wA·areaScore + wX·centerScore
 *
 * - area: a bigger apparent box usually means closer or more prominent;
 * - centre: people point the phone at what they care about.
 *
 * Hysteresis keeps the choice stable: a challenger must beat the current
 * primary by a margin for several consecutive frames before it takes over, so
 * two similar objects do not flip the announcement back and forth.
 */
class PrimaryObjectResolver {

    private var currentId: String? = null
    private var challengerId: String? = null
    private var challengerFrames = 0

    /** Latest per-object scores, keyed by trackId, for diagnostics. */
    var lastScores: Map<String, PriorityScore> = emptyMap()
        private set

    fun reset() {
        currentId = null
        challengerId = null
        challengerFrames = 0
        lastScores = emptyMap()
    }

    fun toDetection(t: DetectionTracker.TrackedObject, now: Long): VisionDetection {
        val cx = t.box.centerX
        val cy = t.box.centerY
        return VisionDetection(
            trackId = t.trackId,
            label = t.label,
            confidence = t.confidence,
            bbox = t.box,
            centerX = cx,
            centerY = cy,
            areaRatio = t.box.area,
            centerScore = centerScore(cx, cy),
            timestamp = now,
        )
    }

    fun score(d: VisionDetection, config: VisionConfig): PriorityScore {
        val conf = d.confidence.coerceIn(0f, 1f)
        val area = (d.areaRatio / config.areaSaturation).coerceIn(0f, 1f)
        val center = d.centerScore
        val wSum = (config.weightConfidence + config.weightArea + config.weightCenter).takeIf { it > 0f } ?: 1f
        val priority = (config.weightConfidence * conf + config.weightArea * area + config.weightCenter * center) / wSum
        return PriorityScore(conf, area, center, priority)
    }

    fun resolve(visible: List<VisionDetection>, now: Long, config: VisionConfig): PrimaryVisionEvent? {
        if (visible.isEmpty()) {
            lastScores = emptyMap()
            // Keep currentId: a brief empty frame inside the tracker's grace
            // window should not reset the choice.
            challengerId = null
            challengerFrames = 0
            return null
        }

        val scored = visible.map { it to score(it, config) }
        lastScores = scored.associate { it.first.trackId to it.second }
        val best = scored.maxByOrNull { it.second.priority }!!
        val current = scored.firstOrNull { it.first.trackId == currentId }

        val chosen = when {
            current == null -> {
                challengerId = null
                challengerFrames = 0
                best
            }
            best.first.trackId == current.first.trackId -> {
                challengerId = null
                challengerFrames = 0
                current
            }
            best.second.priority >= current.second.priority + config.primarySwitchMargin -> {
                if (challengerId == best.first.trackId) challengerFrames++ else {
                    challengerId = best.first.trackId
                    challengerFrames = 1
                }
                if (challengerFrames >= config.primarySwitchFrames) {
                    challengerId = null
                    challengerFrames = 0
                    best
                } else {
                    current
                }
            }
            else -> {
                challengerId = null
                challengerFrames = 0
                current
            }
        }
        currentId = chosen.first.trackId

        val primary = chosen.first
        return PrimaryVisionEvent(
            primaryObject = primary,
            score = chosen.second,
            multipleObjectsDetected = visible.size > 1,
            objectCount = visible.size,
            allVisibleObjects = visible.sortedByDescending { lastScores[it.trackId]?.priority ?: 0f },
            direction = DirectionCalculator.direction(primary.centerX, config),
            timestamp = now,
        )
    }

    companion object {
        private const val MAX_CENTER_DISTANCE = 0.70710677f // corner-to-centre of the unit square

        fun centerScore(cx: Float, cy: Float): Float {
            val dx = cx - 0.5f
            val dy = cy - 0.5f
            val d = sqrt(dx * dx + dy * dy)
            return (1f - d / MAX_CENTER_DISTANCE).coerceIn(0f, 1f)
        }
    }
}
