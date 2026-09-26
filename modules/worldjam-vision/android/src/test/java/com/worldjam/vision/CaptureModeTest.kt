package com.worldjam.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CaptureModeTest {

    private val cfg = VisionConfig()

    // --- decoder: seg head + allowlist ---------------------------------------

    @Test
    fun maskCoefficientRowsAreNotReadAsClasses() {
        val classes = 3
        val features = 4 + classes + 32
        val anchors = 10
        val out = FloatArray(features * anchors)
        // Anchor 0: a real "pen" at 0.8.
        out[0] = 320f; out[anchors] = 320f; out[2 * anchors] = 100f; out[3 * anchors] = 100f
        out[(4 + 0) * anchors] = 0.8f
        // Anchor 1: nothing in the class rows, but big values in the mask rows.
        out[1] = 100f; out[anchors + 1] = 100f; out[2 * anchors + 1] = 50f; out[3 * anchors + 1] = 50f
        for (m in 0 until 32) out[(4 + classes + m) * anchors + 1] = 0.99f
        val dec = YoloDecoder(listOf("pen", "watch", "keys"), classCount = classes)
        val dets = dec.decode(out, features, anchors, Letterbox.forSource(640, 640, 640), 0.5f, 0.45f, 20)
        assertEquals(1, dets.size)
        assertEquals("pen", dets[0].label)
    }

    @Test
    fun allowlistDropsPeopleFromTheCocoFallback() {
        val anchors = 4
        val out = FloatArray(84 * anchors)
        fun put(a: Int, cls: Int, cx: Float) {
            out[a] = cx; out[anchors + a] = 300f; out[2 * anchors + a] = 80f; out[3 * anchors + a] = 80f
            out[(4 + cls) * anchors + a] = 0.9f
        }
        put(0, 0, 100f)   // person
        put(1, 41, 400f)  // cup
        val labels = (0 until 80).map { when (it) { 0 -> "person"; 41 -> "cup"; else -> "c$it" } }
        val dec = YoloDecoder(labels, 80, setOf("cup", "laptop"))
        val dets = dec.decode(out, 84, anchors, Letterbox.forSource(640, 640, 640), 0.5f, 0.45f, 20)
        assertEquals(listOf("cup"), dets.map { it.label })
    }

    // --- depth sampling --------------------------------------------------------

    @Test
    fun depthSamplerReadsTheBoxThroughTheLetterbox() {
        // 1280x720 upright letterboxed into 640: scale 0.5, padY 140.
        val lb = Letterbox.forSource(640, 1280, 720)
        val map = FloatArray(640 * 640) { 5f }
        // Near object occupies source x 0..640, y 0..360 → input x 0..320, y 140..320.
        for (y in 140 until 320) for (x in 0 until 320) map[y * 640 + x] = 0.6f
        val near = DepthSampler.sample(map, 640, 640, NormBox(0f, 0f, 0.5f, 0.5f), lb)
        val far = DepthSampler.sample(map, 640, 640, NormBox(0.5f, 0.5f, 0.5f, 0.5f), lb)
        assertEquals(0.6f, near!!, 1e-6f)
        assertEquals(5f, far!!, 1e-6f)
    }

    // --- closest-object resolver -------------------------------------------------

    private fun vd(id: String, label: String, x: Float, w: Float, conf: Float = 0.8f) = VisionDetection(
        id, label, conf, NormBox(x, 0.3f, w, w), x + w / 2, 0.3f + w / 2, w * w,
        PrimaryObjectResolver.centerScore(x + w / 2, 0.3f + w / 2), 0,
    )

    @Test
    fun nearestByDepthWinsEvenWhenSmallerOnScreen() {
        val r = ClosestObjectResolver()
        val laptop = vd("a", "laptop", 0.1f, 0.5f)   // big but far
        val pen = vd("b", "pen", 0.7f, 0.1f)         // small but near
        val depth = mapOf("a" to 1.8f, "b" to 0.4f)
        val t = r.resolve(listOf(laptop, pen), { depth[it] }, cfg)!!
        assertEquals("pen", t.label)
        assertEquals("depth", t.method)
        assertEquals(2, t.objectCount)
        assertEquals(listOf("laptop"), t.others)
    }

    @Test
    fun tapOverridesDepth() {
        val r = ClosestObjectResolver()
        val laptop = vd("a", "laptop", 0.1f, 0.5f)
        val pen = vd("b", "pen", 0.7f, 0.1f)
        r.focus = 0.3f to 0.5f // inside the laptop
        val t = r.resolve(listOf(laptop, pen), { mapOf("a" to 1.8f, "b" to 0.4f)[it] }, cfg)!!
        assertEquals("laptop", t.label)
        assertEquals("tap", t.method)
    }

    @Test
    fun fallsBackToSizeWithoutDepth() {
        val r = ClosestObjectResolver()
        val t = r.resolve(listOf(vd("a", "laptop", 0.25f, 0.5f), vd("b", "pen", 0.8f, 0.1f)), { null }, cfg)!!
        assertEquals("laptop", t.label)
        assertEquals("size", t.method)
    }

    @Test
    fun targetDoesNotFlickerBetweenSimilarDepths() {
        val r = ClosestObjectResolver()
        val a = vd("a", "cup", 0.1f, 0.2f)
        val b = vd("b", "mug", 0.6f, 0.2f)
        assertEquals("cup", r.resolve(listOf(a, b), { mapOf("a" to 1.00f, "b" to 1.05f)[it] }, cfg)!!.label)
        // b now marginally nearer: within the switch margin, keep a.
        assertEquals("cup", r.resolve(listOf(a, b), { mapOf("a" to 1.00f, "b" to 0.95f)[it] }, cfg)!!.label)
        // b clearly nearer, but must hold for closestSwitchFrames.
        assertEquals("cup", r.resolve(listOf(a, b), { mapOf("a" to 1.00f, "b" to 0.5f)[it] }, cfg)!!.label)
        assertEquals("mug", r.resolve(listOf(a, b), { mapOf("a" to 1.00f, "b" to 0.5f)[it] }, cfg)!!.label)
    }

    @Test
    fun nothingVisibleMeansNoTarget() {
        assertNull(ClosestObjectResolver().resolve(emptyList(), { null }, cfg))
    }

    @Test
    fun targetMapCarriesMultipleObjectsFlag() {
        val r = ClosestObjectResolver()
        val t = r.resolve(listOf(vd("a", "cup", 0.1f, 0.2f)), { 1f }, cfg)
        assertNotNull(t)
        assertEquals(false, t!!.toMap()["multipleObjectsDetected"])
        val t2 = r.resolve(listOf(vd("a", "cup", 0.1f, 0.2f), vd("b", "pen", 0.6f, 0.1f)), { 1f }, cfg)!!
        assertTrue(t2.toMap()["multipleObjectsDetected"] as Boolean)
    }
}
