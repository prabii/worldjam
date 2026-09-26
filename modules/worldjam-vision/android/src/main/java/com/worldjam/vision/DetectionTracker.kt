package com.worldjam.vision

/**
 * Keeps object identity across frames.
 *
 * A laptop in view for twenty seconds is ONE object with one trackId, not two
 * hundred detections — that identity is what stops the read-out repeating.
 *
 * - Matching is greedy by IoU within the same label, with a centre-distance
 *   fallback so a fast pan does not break the track.
 * - A track becomes visible only after [VisionConfig.minimumStableFrames]
 *   consecutive matches (temporal stability — one noisy frame never speaks).
 * - A confirmed track survives [VisionConfig.trackGraceMs] of misses before it
 *   is declared gone, so a blink of occlusion does not create a "new" object.
 */
class DetectionTracker {

    private class Track(
        val id: Int,
        val label: String,
        var box: NormBox,
        var confidence: Float,
        var consecutiveHits: Int,
        var lastSeen: Long,
        var confirmed: Boolean,
    )

    /** A track as exposed to the resolver. */
    data class TrackedObject(
        val trackId: String,
        val label: String,
        val confidence: Float,
        val box: NormBox,
        val lastSeen: Long,
    )

    private val tracks = ArrayList<Track>()
    private var nextId = 1

    val activeTrackCount: Int get() = tracks.size

    fun reset() {
        tracks.clear()
    }

    /** Feeds one frame of detections; returns the currently visible, stable objects. */
    fun update(detections: List<RawDetection>, now: Long, config: VisionConfig): List<TrackedObject> {
        val matchedTrack = BooleanArray(tracks.size)
        val matchedDet = BooleanArray(detections.size)

        // Score every same-label pair, then take the best pairs greedily.
        data class Pair(val t: Int, val d: Int, val score: Float)
        val pairs = ArrayList<Pair>()
        for (ti in tracks.indices) {
            val t = tracks[ti]
            for (di in detections.indices) {
                val d = detections[di]
                if (d.label != t.label) continue
                val iou = t.box.iou(d.box)
                val dist = distance(t.box, d.box)
                val score = when {
                    iou >= config.trackIouMatch -> 1f + iou
                    dist <= config.trackCenterMatch -> 1f - dist // below any IoU match
                    else -> continue
                }
                pairs.add(Pair(ti, di, score))
            }
        }
        pairs.sortByDescending { it.score }
        for (p in pairs) {
            if (matchedTrack[p.t] || matchedDet[p.d]) continue
            matchedTrack[p.t] = true
            matchedDet[p.d] = true
            val t = tracks[p.t]
            val d = detections[p.d]
            val a = config.trackSmoothing
            t.box = NormBox(
                lerp(t.box.x, d.box.x, a),
                lerp(t.box.y, d.box.y, a),
                lerp(t.box.width, d.box.width, a),
                lerp(t.box.height, d.box.height, a),
            )
            t.confidence = lerp(t.confidence, d.confidence, a)
            t.consecutiveHits++
            t.lastSeen = now
            if (t.consecutiveHits >= config.minimumStableFrames) t.confirmed = true
        }

        // Unmatched tracks: an unconfirmed one must start its streak again.
        for (ti in tracks.indices) {
            if (!matchedTrack[ti]) {
                val t = tracks[ti]
                if (!t.confirmed) t.consecutiveHits = 0
            }
        }

        // Unmatched detections start new tracks.
        for (di in detections.indices) {
            if (matchedDet[di]) continue
            val d = detections[di]
            val t = Track(nextId++, d.label, d.box, d.confidence, 1, now, false)
            if (config.minimumStableFrames <= 1) t.confirmed = true
            tracks.add(t)
        }

        // Expire tracks past the grace period (unconfirmed ones go immediately
        // after a miss streak, confirmed ones get the grace window).
        tracks.removeAll { t ->
            val age = now - t.lastSeen
            if (t.confirmed) age > config.trackGraceMs else age > 0 && t.consecutiveHits == 0
        }

        return tracks
            .filter { it.confirmed && now - it.lastSeen <= config.trackGraceMs }
            .map { TrackedObject("track_${it.id}", it.label, it.confidence, it.box, it.lastSeen) }
    }

    private fun lerp(a: Float, b: Float, t: Float) = a + (b - a) * t

    private fun distance(a: NormBox, b: NormBox): Float {
        val dx = a.centerX - b.centerX
        val dy = a.centerY - b.centerY
        return kotlin.math.sqrt(dx * dx + dy * dy)
    }
}
