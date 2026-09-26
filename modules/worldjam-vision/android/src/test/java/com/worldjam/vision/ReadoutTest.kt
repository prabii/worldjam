package com.worldjam.vision

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReadoutTest {

    private class FakeSpeaker : Speaker {
        val spoken = ArrayList<String>()
        var stops = 0
        override fun speak(text: String, utteranceId: String) { spoken.add(text) }
        override fun stop() { stops++ }
    }

    private class Recorder : ReadoutManager.Listener {
        val readouts = ArrayList<Pair<LatestReadout, Boolean>>()
        val requests = ArrayList<Long>()
        override fun onReadout(readout: LatestReadout, spoken: Boolean) { readouts.add(readout to spoken) }
        override fun onFormatRequest(requestId: Long, event: PrimaryVisionEvent, fallbackText: String) { requests.add(requestId) }
    }

    private val cfg = VisionConfig()
    private var now = 10_000L

    private fun event(id: String, label: String, count: Int, cx: Float = 0.5f): PrimaryVisionEvent {
        val d = VisionDetection(id, label, 0.9f, NormBox(cx - 0.1f, 0.4f, 0.2f, 0.2f), cx, 0.5f, 0.04f, 0.9f, now)
        return PrimaryVisionEvent(
            d, PriorityScore(0.9f, 0.1f, 0.9f, 0.6f), count > 1, count, listOf(d),
            DirectionCalculator.direction(cx, cfg), now,
        )
    }

    private fun manager(speaker: Speaker, listener: ReadoutManager.Listener? = null) =
        ReadoutManager(DirectReadoutFormatter(), speaker, LatestReadoutStore(), { now }, listener)

    @Test
    fun formatterMatchesThePlanSentences() {
        val f = DirectReadoutFormatter()
        assertEquals("Laptop detected.", f.format(event("t", "laptop", 1)))
        assertEquals("Laptop detected. Two other objects are visible.", f.format(event("t", "laptop", 3)))
        assertEquals("Laptop on your right. Two other objects are visible.", f.format(event("t", "laptop", 3, cx = 0.8f)))
        assertEquals("Laptop on your left. One other object is visible.", f.format(event("t", "laptop", 2, cx = 0.1f)))
        assertEquals("Phone detected.", f.format(event("t", "cell phone", 1)))
    }

    @Test
    fun stationaryObjectIsAnnouncedExactlyOnce() {
        val s = FakeSpeaker()
        val m = manager(s)
        repeat(200) { // 20 s at 10 fps
            m.onPrimary(event("track_17", "laptop", 1), cfg)
            now += 100
        }
        assertEquals(listOf("Laptop detected."), s.spoken)
    }

    @Test
    fun newPrimaryObjectIsAnnounced() {
        val s = FakeSpeaker()
        val m = manager(s)
        m.onPrimary(event("track_1", "laptop", 1), cfg)
        now += 4000
        m.onPrimary(event("track_2", "bottle", 1), cfg)
        assertEquals(listOf("Laptop detected.", "Bottle detected."), s.spoken)
    }

    @Test
    fun cooldownDefersRatherThanDrops() {
        val s = FakeSpeaker()
        val m = manager(s)
        m.onPrimary(event("track_1", "laptop", 1), cfg)
        now += 500
        m.onPrimary(event("track_2", "bottle", 1), cfg) // inside the 3 s cooldown
        assertEquals(1, s.spoken.size)
        assertEquals("Bottle detected.", m.store.latest!!.text) // stored immediately
        now += 3000
        m.onPrimary(event("track_2", "bottle", 1), cfg)
        assertEquals(listOf("Laptop detected.", "Bottle detected."), s.spoken)
    }

    @Test
    fun toggleOffStoresButDoesNotSpeak_andRepeatStillWorks() {
        val s = FakeSpeaker()
        val m = manager(s)
        m.readoutEnabled = false
        m.onPrimary(event("track_1", "laptop", 3, cx = 0.8f), cfg)
        assertTrue(s.spoken.isEmpty())
        assertEquals("Laptop on your right. Two other objects are visible.", m.store.latest!!.text)
        assertEquals("Laptop on your right. Two other objects are visible.", m.repeatLatest())
        assertEquals(1, s.spoken.size)
    }

    @Test
    fun repeatSpeaksTheSameReadoutEveryTime() {
        val s = FakeSpeaker()
        val m = manager(s)
        m.onPrimary(event("track_1", "laptop", 1), cfg)
        s.spoken.clear()
        repeat(5) { m.repeatLatest() }
        assertEquals(List(5) { "Laptop detected." }, s.spoken)
    }

    @Test
    fun repeatWithNothingDetectedSaysSo() {
        val s = FakeSpeaker()
        val m = manager(s)
        assertEquals(ReadoutManager.NO_OBJECT_TEXT, m.repeatLatest())
        assertEquals(listOf("No object detected yet."), s.spoken)
        assertNull(m.store.latest)
    }

    @Test
    fun sameObjectCountChangeUpdatesStoreSilently() {
        val s = FakeSpeaker()
        val m = manager(s)
        m.onPrimary(event("track_1", "laptop", 1), cfg)
        now += 5000
        m.onPrimary(event("track_1", "laptop", 3), cfg)
        assertEquals(1, s.spoken.size)
        assertEquals("Laptop detected. Two other objects are visible.", m.store.latest!!.text)
    }

    @Test
    fun reappearingSameLabelIsNotReAnnouncedImmediately() {
        val s = FakeSpeaker()
        val m = manager(s)
        m.onPrimary(event("track_1", "laptop", 1), cfg)
        now += 4000
        m.onPrimary(event("track_9", "laptop", 1), cfg) // same laptop re-acquired as a new track
        assertEquals(1, s.spoken.size)
        now += cfg.sameLabelRepeatMs
        m.onPrimary(event("track_12", "laptop", 1), cfg)
        assertEquals(2, s.spoken.size)
    }

    @Test
    fun turningReadoutOffStopsSpeech() {
        val s = FakeSpeaker()
        val m = manager(s)
        m.readoutEnabled = false
        assertEquals(1, s.stops)
    }

    @Test
    fun externalFormatterResultIsSpokenAndStaleResultsIgnored() {
        val s = FakeSpeaker()
        val rec = Recorder()
        val m = manager(s, rec)
        m.externalFormatting = true
        m.onPrimary(event("track_1", "laptop", 2), cfg)
        assertTrue(s.spoken.isEmpty())
        val rid = rec.requests.single()
        assertFalse(m.completeExternal(rid + 99, "wrong", cfg))
        assertTrue(m.completeExternal(rid, "A laptop is in front of you, with one more object nearby.", cfg))
        assertEquals(listOf("A laptop is in front of you, with one more object nearby."), s.spoken)
        assertEquals("A laptop is in front of you, with one more object nearby.", m.store.latest!!.text)
        assertFalse(m.completeExternal(rid, "again", cfg))
    }

    @Test
    fun externalTimeoutFallsBackToDirectText() {
        val s = FakeSpeaker()
        val rec = Recorder()
        val m = manager(s, rec)
        m.externalFormatting = true
        m.onPrimary(event("track_1", "cup", 1), cfg)
        m.onExternalTimeout(rec.requests.single(), cfg)
        assertEquals(listOf("Cup detected."), s.spoken)
    }

    @Test
    fun configMergeClampsAndIgnoresUnknownKeys() {
        val c = VisionConfig().merge(mapOf("minConfidence" to 2.0, "targetFps" to 12, "bogus" to 1))
        assertEquals(0.99f, c.minConfidence, 1e-6f)
        assertEquals(12, c.targetFps)
    }
}
