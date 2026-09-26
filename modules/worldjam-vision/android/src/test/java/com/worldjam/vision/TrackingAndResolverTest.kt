package com.worldjam.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TrackingAndResolverTest {

    private val cfg = VisionConfig()

    private fun det(label: String, x: Float, y: Float, w: Float, h: Float, conf: Float, cls: Int = 0) =
        RawDetection(cls, label, conf, NormBox(x, y, w, h))

    @Test
    fun objectBecomesVisibleOnlyAfterStableFrames() {
        val t = DetectionTracker()
        val laptop = det("laptop", 0.3f, 0.3f, 0.4f, 0.4f, 0.9f)
        assertTrue(t.update(listOf(laptop), 0, cfg).isEmpty())
        assertTrue(t.update(listOf(laptop), 100, cfg).isEmpty())
        val visible = t.update(listOf(laptop), 200, cfg)
        assertEquals(1, visible.size)
    }

    @Test
    fun sameObjectKeepsItsTrackIdAcrossFramesAndShortOcclusion() {
        val t = DetectionTracker()
        var id: String? = null
        for (i in 0 until 10) {
            val v = t.update(listOf(det("laptop", 0.3f + i * 0.005f, 0.3f, 0.4f, 0.4f, 0.9f)), i * 100L, cfg)
            if (v.isNotEmpty()) {
                if (id == null) id = v[0].trackId else assertEquals(id, v[0].trackId)
            }
        }
        // Missed for less than the grace period: still visible, same id.
        val during = t.update(emptyList(), 1500, cfg)
        assertEquals(id, during.single().trackId)
        val back = t.update(listOf(det("laptop", 0.35f, 0.3f, 0.4f, 0.4f, 0.9f)), 1600, cfg)
        assertEquals(id, back.single().trackId)
        // Gone past the grace period.
        assertTrue(t.update(emptyList(), 1600 + cfg.trackGraceMs + 1, cfg).isEmpty())
    }

    @Test
    fun singleNoisyFrameNeverBecomesAnObject() {
        val t = DetectionTracker()
        t.update(listOf(det("bottle", 0.1f, 0.1f, 0.1f, 0.1f, 0.6f)), 0, cfg)
        assertTrue(t.update(emptyList(), 100, cfg).isEmpty())
        assertTrue(t.update(emptyList(), 200, cfg).isEmpty())
        assertEquals(0, t.activeTrackCount)
    }

    @Test
    fun resolverPicksLaptopFromThePlanExample() {
        val r = PrimaryObjectResolver()
        fun vd(id: String, label: String, conf: Float, area: Float, center: Float, cx: Float) = VisionDetection(
            id, label, conf, NormBox(cx - 0.1f, 0.4f, 0.2f, 0.2f), cx, 0.5f, area, center, 0,
        )
        val laptop = vd("t1", "laptop", 0.94f, 0.42f, 0.90f, 0.5f)
        val bottle = vd("t2", "bottle", 0.86f, 0.17f, 0.42f, 0.2f)
        val chair = vd("t3", "chair", 0.78f, 0.24f, 0.30f, 0.8f)
        val e = r.resolve(listOf(bottle, chair, laptop), 0, cfg)!!
        assertEquals("laptop", e.primaryObject.label)
        assertTrue(e.multipleObjectsDetected)
        assertEquals(3, e.objectCount)
        val scores = r.lastScores
        assertTrue(scores.getValue("t1").priority > scores.getValue("t2").priority)
        assertTrue(scores.getValue("t1").priority > scores.getValue("t3").priority)
    }

    @Test
    fun primaryDoesNotFlipWithoutASustainedMargin() {
        val r = PrimaryObjectResolver()
        fun vd(id: String, conf: Float) = VisionDetection(id, id, conf, NormBox(0.3f, 0.3f, 0.3f, 0.3f), 0.45f, 0.45f, 0.09f, 0.9f, 0)
        assertEquals("a", r.resolve(listOf(vd("a", 0.80f), vd("b", 0.78f)), 0, cfg)!!.primaryObject.trackId)
        // b slightly better: not enough margin, stays a.
        assertEquals("a", r.resolve(listOf(vd("a", 0.80f), vd("b", 0.84f)), 1, cfg)!!.primaryObject.trackId)
        // b clearly better, but must hold for primarySwitchFrames.
        assertEquals("a", r.resolve(listOf(vd("a", 0.60f), vd("b", 0.95f)), 2, cfg)!!.primaryObject.trackId)
        assertEquals("a", r.resolve(listOf(vd("a", 0.60f), vd("b", 0.95f)), 3, cfg)!!.primaryObject.trackId)
        assertEquals("b", r.resolve(listOf(vd("a", 0.60f), vd("b", 0.95f)), 4, cfg)!!.primaryObject.trackId)
    }

    @Test
    fun primarySwitchesImmediatelyWhenCurrentDisappears() {
        val r = PrimaryObjectResolver()
        fun vd(id: String, conf: Float) = VisionDetection(id, id, conf, NormBox(0.3f, 0.3f, 0.3f, 0.3f), 0.45f, 0.45f, 0.09f, 0.9f, 0)
        r.resolve(listOf(vd("a", 0.9f), vd("b", 0.6f)), 0, cfg)
        assertEquals("b", r.resolve(listOf(vd("b", 0.6f)), 1, cfg)!!.primaryObject.trackId)
    }

    @Test
    fun singleObjectIsNotMultiple() {
        val r = PrimaryObjectResolver()
        val e = r.resolve(listOf(VisionDetection("a", "cup", 0.9f, NormBox(0.4f, 0.4f, 0.2f, 0.2f), 0.5f, 0.5f, 0.04f, 1f, 0)), 0, cfg)!!
        assertFalse(e.multipleObjectsDetected)
        assertEquals(1, e.objectCount)
        assertNull(r.resolve(emptyList(), 1, cfg))
    }

    @Test
    fun centerScoreIsHighestInTheMiddle() {
        assertEquals(1f, PrimaryObjectResolver.centerScore(0.5f, 0.5f), 1e-6f)
        assertEquals(0f, PrimaryObjectResolver.centerScore(0f, 0f), 1e-5f)
        assertTrue(PrimaryObjectResolver.centerScore(0.6f, 0.5f) > PrimaryObjectResolver.centerScore(0.9f, 0.5f))
    }

    @Test
    fun directionUsesThirdsOfTheFrame() {
        assertEquals(Direction.LEFT, DirectionCalculator.direction(0.2f, cfg))
        assertEquals(Direction.CENTER, DirectionCalculator.direction(0.33f, cfg))
        assertEquals(Direction.CENTER, DirectionCalculator.direction(0.5f, cfg))
        assertEquals(Direction.CENTER, DirectionCalculator.direction(0.66f, cfg))
        assertEquals(Direction.RIGHT, DirectionCalculator.direction(0.8f, cfg))
    }

    @Test
    fun endToEndTrackerThenResolver() {
        val t = DetectionTracker()
        val r = PrimaryObjectResolver()
        var event: PrimaryVisionEvent? = null
        for (i in 0 until 4) {
            val tracked = t.update(
                listOf(
                    det("laptop", 0.55f, 0.3f, 0.4f, 0.4f, 0.92f, 63),
                    det("cup", 0.05f, 0.6f, 0.1f, 0.15f, 0.8f, 41),
                ),
                i * 100L, cfg,
            )
            event = r.resolve(tracked.map { r.toDetection(it, i * 100L) }, i * 100L, cfg)
        }
        assertNotNull(event)
        assertEquals("laptop", event!!.primaryObject.label)
        assertEquals(Direction.RIGHT, event.direction)
        assertEquals(2, event.objectCount)
    }
}
