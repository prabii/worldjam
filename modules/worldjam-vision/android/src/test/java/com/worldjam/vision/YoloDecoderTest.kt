package com.worldjam.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class YoloDecoderTest {

    private val labels = (0 until 80).map { if (it == 63) "laptop" else if (it == 41) "cup" else "class$it" }
    private val decoder = YoloDecoder(labels)
    private val features = 84
    private val anchors = 50

    /** Writes one anchor into a channel-major [84, anchors] tensor. */
    private fun put(out: FloatArray, a: Int, cx: Float, cy: Float, w: Float, h: Float, cls: Int, score: Float) {
        out[a] = cx
        out[anchors + a] = cy
        out[2 * anchors + a] = w
        out[3 * anchors + a] = h
        out[(4 + cls) * anchors + a] = score
    }

    @Test
    fun decodesPixelCoordinatesThroughLetterbox() {
        // 1280x720 upright source letterboxed into 640: scale 0.5, padY 140.
        val lb = Letterbox.forSource(640, 1280, 720)
        assertEquals(0.5f, lb.scale, 1e-6f)
        assertEquals(140f, lb.padY, 1e-4f)
        val out = FloatArray(features * anchors)
        // Box centred in the frame, 320x180 model px = 640x360 source px.
        put(out, 3, 320f, 320f, 320f, 180f, 63, 0.9f)
        val dets = decoder.decode(out, features, anchors, lb, 0.5f, 0.45f, 20)
        assertEquals(1, dets.size)
        val d = dets[0]
        assertEquals("laptop", d.label)
        assertEquals(0.25f, d.box.x, 1e-3f)
        assertEquals(0.25f, d.box.y, 1e-3f)
        assertEquals(0.5f, d.box.width, 1e-3f)
        assertEquals(0.5f, d.box.height, 1e-3f)
    }

    @Test
    fun normalisedCoordinatesDecodeToTheSameBox() {
        val lb = Letterbox.forSource(640, 1280, 720)
        val out = FloatArray(features * anchors)
        put(out, 3, 0.5f, 0.5f, 0.5f, 180f / 640f, 63, 0.9f)
        val d = decoder.decode(out, features, anchors, lb, 0.5f, 0.45f, 20).single()
        assertEquals(0.25f, d.box.x, 1e-3f)
        assertEquals(0.5f, d.box.width, 1e-3f)
        assertEquals(0.5f, d.box.height, 1e-3f)
    }

    @Test
    fun dropsBelowConfidenceAndSuppressesOverlaps() {
        val lb = Letterbox.forSource(640, 640, 640)
        val out = FloatArray(features * anchors)
        put(out, 0, 200f, 200f, 100f, 100f, 63, 0.95f)
        put(out, 1, 205f, 202f, 100f, 100f, 63, 0.80f) // duplicate of anchor 0
        put(out, 2, 205f, 202f, 100f, 100f, 41, 0.70f) // same place, other class: kept
        put(out, 3, 500f, 500f, 80f, 80f, 41, 0.40f)   // below threshold
        val dets = decoder.decode(out, features, anchors, lb, 0.5f, 0.45f, 20)
        assertEquals(2, dets.size)
        assertEquals("laptop", dets[0].label)
        assertEquals(0.95f, dets[0].confidence, 1e-6f)
        assertEquals("cup", dets[1].label)
    }

    @Test
    fun respectsMaxDetections() {
        val lb = Letterbox.forSource(640, 640, 640)
        val out = FloatArray(features * anchors)
        for (a in 0 until 10) put(out, a, 30f + a * 60f, 300f, 40f, 40f, 41, 0.6f + a * 0.01f)
        val dets = decoder.decode(out, features, anchors, lb, 0.5f, 0.45f, 4)
        assertEquals(4, dets.size)
        assertTrue(dets.zipWithNext().all { it.first.confidence >= it.second.confidence })
    }
}
