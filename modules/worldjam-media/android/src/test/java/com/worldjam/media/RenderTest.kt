package com.worldjam.media

import com.worldjam.media.render.Compressor
import com.worldjam.media.render.GraphParser
import com.worldjam.media.render.Limiter
import com.worldjam.media.render.Mixer
import com.worldjam.media.render.RenderRunner
import com.worldjam.media.render.Reverb
import com.worldjam.media.render.dbToGain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.math.abs
import kotlin.math.sin

class RenderTest {

    private val sr = 48000
    private fun tmp(name: String) = File.createTempFile(name, ".wav").apply { deleteOnExit() }

    private fun click(len: Int = 100, amp: Float = 0.5f) = FloatArray(len) { if (it == 0) amp else 0f }

    private fun graph(layers: String, duration: Double = 1.0, master: String = """{"gainDb":0,"limiterCeilingDb":-1}""", buses: String = "[]", sources: String = """{"id":"s","path":"unused"},{"id":"t","path":"unused"}""") =
        """{"version":1,"sampleRate":$sr,"durationSec":$duration,"sources":[${sources}],"layers":[$layers],"buses":$buses,"master":$master}"""

    private fun renderWith(sources: Map<String, FloatArray>, graphJson: String): Pair<FloatArray, FloatArray> {
        val g = GraphParser.parse(graphJson)
        val l = ArrayList<Float>(); val r = ArrayList<Float>()
        Mixer(g, sources).render(10, {}) { a, b, n -> for (i in 0 until n) { l += a[i]; r += b[i] } }
        return l.toFloatArray() to r.toFloatArray()
    }

    private fun firstNonZero(x: FloatArray) = x.indexOfFirst { abs(it) > 1e-4f }

    @Test fun wavRoundTrip16AndFloat() {
        val pcm = Pcm(FloatArray(1000) { sin(it * 0.05).toFloat() * 0.8f }, sr, 1)
        val f16 = tmp("a16"); Wav.write16(f16, pcm)
        val back16 = Wav.read(f16)
        assertEquals(1000, back16.frames)
        assertEquals(0.8f * sin(10 * 0.05).toFloat(), back16.data[10], 1e-3f)
        val f32 = tmp("a32"); Wav.writeFloat(f32, pcm)
        assertEquals(pcm.data[500], Wav.read(f32).data[500], 1e-6f)
    }

    @Test fun resamplerKeepsDuration() {
        val pcm = Pcm(FloatArray(44100), 44100, 1)
        assertEquals(48000, Wav.resample(pcm, 48000).frames)
        assertEquals(1, Wav.toMono(Pcm(FloatArray(20), sr, 2)).channels)
    }

    @Test fun eventsLandSampleAccurately() {
        val g = graph("""{"id":"l","sourceId":"s","bus":"DRUMS","gainDb":0,"pan":0,"effects":[],"events":[{"timeSec":0.25,"rate":1,"gainDb":0,"fadeInSec":0,"fadeOutSec":0}]}""")
        val (l, _) = renderWith(mapOf("s" to click()), g)
        assertEquals(12000, firstNonZero(l))
        assertEquals((sr * 1.0).toInt(), l.size)
    }

    @Test fun rateTwoHalvesTheLength() {
        val src = FloatArray(4801) { 0.3f }
        val one = graph("""{"id":"l","sourceId":"s","bus":"FX","gainDb":0,"pan":0,"effects":[],"events":[{"timeSec":0,"rate":1,"gainDb":0,"fadeInSec":0,"fadeOutSec":0}]}""")
        val two = graph("""{"id":"l","sourceId":"s","bus":"FX","gainDb":0,"pan":0,"effects":[],"events":[{"timeSec":0,"rate":2,"gainDb":0,"fadeInSec":0,"fadeOutSec":0}]}""")
        val lenOne = renderWith(mapOf("s" to src), one).first.count { abs(it) > 1e-4f }
        val lenTwo = renderWith(mapOf("s" to src), two).first.count { abs(it) > 1e-4f }
        assertTrue(lenOne > 4000)
        assertEquals(lenOne / 2.0, lenTwo.toDouble(), 3.0)
    }

    @Test fun loopFillsItsDuration() {
        val src = FloatArray(480) { 0.2f }
        val g = graph("""{"id":"l","sourceId":"s","bus":"FX","gainDb":0,"pan":0,"effects":[],"events":[{"timeSec":0,"durationSec":0.5,"rate":1,"gainDb":0,"loop":true,"fadeInSec":0,"fadeOutSec":0}]}""")
        val (l, _) = renderWith(mapOf("s" to src), g)
        val sounding = l.count { abs(it) > 1e-4f }
        assertEquals(24000.0, sounding.toDouble(), 20.0)
    }

    @Test fun constantPowerPan() {
        val src = FloatArray(200) { 0.5f }
        fun at(pan: Double): Pair<Float, Float> {
            val (l, r) = renderWith(mapOf("s" to src), graph("""{"id":"l","sourceId":"s","bus":"FX","gainDb":0,"pan":$pan,"effects":[],"events":[{"timeSec":0,"rate":1,"gainDb":0,"fadeInSec":0,"fadeOutSec":0}]}"""))
            return l[50] to r[50]
        }
        val (cl, cr) = at(0.0)
        assertEquals(cl, cr, 1e-5f)
        assertEquals(0.5f * 0.5f, cl * cl + cr * cr, 1e-3f)
        val (hl, hr) = at(-1.0)
        assertEquals(0f, hr, 1e-5f)
        assertEquals(0.5f, hl, 1e-3f)
    }

    @Test fun layersOnOneBusSum() {
        val src = FloatArray(200) { 0.1f }
        val layer = { id: String -> """{"id":"$id","sourceId":"s","bus":"DRUMS","gainDb":0,"pan":-1,"effects":[],"events":[{"timeSec":0,"rate":1,"gainDb":0,"fadeInSec":0,"fadeOutSec":0}]}""" }
        val (one, _) = renderWith(mapOf("s" to src), graph(layer("a")))
        val (twoL, _) = renderWith(mapOf("s" to src), graph(layer("a") + "," + layer("b")))
        assertTrue(one[50] > 0.05f)
        assertEquals(one[50] * 2, twoL[50], 1e-4f)
    }

    @Test fun limiterNeverExceedsCeiling() {
        val hot = FloatArray(sr) { (sin(it * 0.03) * 4.0).toFloat() }
        val g = graph("""{"id":"l","sourceId":"s","bus":"FX","gainDb":12,"pan":0,"effects":[],"events":[{"timeSec":0,"rate":1,"gainDb":0}]}""", master = """{"gainDb":6,"limiterCeilingDb":-1}""")
        val (l, r) = renderWith(mapOf("s" to hot), g)
        val ceiling = dbToGain(-1.0)
        assertTrue(l.all { abs(it) <= ceiling + 1e-6f } && r.all { abs(it) <= ceiling + 1e-6f })
        val lim = Limiter(sr, -3.0)
        val a = FloatArray(4096) { 3f }; val b = FloatArray(4096) { -3f }
        lim.process(a, b, 4096)
        assertTrue(a.all { abs(it) <= dbToGain(-3.0) + 1e-6f })
    }

    @Test fun compressorReducesLoudSignals() {
        val c = Compressor(sr, -20.0, 4.0, 1.0, 50.0, 0.0)
        val l = FloatArray(sr / 10) { 0.9f }; val r = l.copyOf()
        c.process(l, r, l.size)
        assertTrue(l.last() < 0.5f)
        assertTrue(c.lastReductionDb > 6)
    }

    @Test fun reverbLeavesATail() {
        val rv = Reverb(sr, 0.8, 0.3, 0.5f)
        val l = FloatArray(sr); val r = FloatArray(sr)
        l[0] = 1f; r[0] = 1f
        rv.process(l, r, sr)
        assertTrue(l.sliceArray(sr / 4 until sr / 2).any { abs(it) > 1e-4f })
    }

    @Test fun peaksAreNormalised() {
        val p = Wav.peaks(Pcm(FloatArray(1000) { if (it == 900) 0.5f else 0.1f }, sr, 1), 10)
        assertEquals(10, p.size)
        assertEquals(1.0, p[9], 1e-9)
        assertEquals(0.2, p[0], 1e-6)
    }

    @Test fun malformedGraphIsHandled() {
        val g = GraphParser.parse("""{"sampleRate":"x","durationSec":-5,"sources":[{"id":"s"}],"layers":[{"sourceId":"missing","events":[{"timeSec":"NaN"}]},"junk"],"master":{"limiterCeilingDb":3}}""")
        assertEquals(0, g.sources.size)
        assertEquals(0, g.layers.size)
        assertTrue(g.master.limiterCeilingDb <= -1.0)
        assertTrue(g.durationSec > 0)
        val (l, _) = renderWith(emptyMap(), graph("", duration = 0.2))
        assertTrue(l.all { it == 0f })
    }

    @Test fun runnerWritesAStereoWavOfTheRequestedLength() {
        val srcFile = tmp("src")
        Wav.write16(srcFile, Pcm(FloatArray(2400) { sin(it * 0.2).toFloat() * 0.5f }, 44100, 1))
        val out = tmp("mix")
        val json = graph(
            """{"id":"l","sourceId":"s","bus":"DRUMS","gainDb":0,"pan":0.3,"effects":[{"type":"lowpass","cutoffHz":4000,"q":0.7},{"type":"reverb","roomSize":0.5,"damping":0.5,"mix":0.2}],"automation":[{"timeSec":0,"gainDb":-6},{"timeSec":1,"gainDb":0}],"events":[{"timeSec":0,"rate":1,"gainDb":0},{"timeSec":0.5,"rate":1.5,"gainDb":-3}]}""",
            duration = 1.5,
            buses = """[{"name":"DRUMS","gainDb":-2,"effects":[{"type":"compressor","thresholdDb":-18,"ratio":3,"attackMs":5,"releaseMs":100,"makeupDb":2}]}]""",
            sources = """{"id":"s","path":"${srcFile.absolutePath.replace("\\", "\\\\")}"}""",
        )
        val result = RenderRunner.run(json, out.absolutePath, 50) {}
        val pcm = Wav.read(out)
        assertEquals(2, pcm.channels)
        assertEquals(72000, pcm.frames)
        assertEquals(1.5, result.durationSec, 1e-6)
        assertEquals(50, result.peaks.size)
        assertTrue(result.peakDb <= -1.0 + 1e-3)
    }
}
