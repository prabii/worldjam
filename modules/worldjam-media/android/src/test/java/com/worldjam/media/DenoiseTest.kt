package com.worldjam.media

import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Random
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.log10
import kotlin.math.sin
import kotlin.math.sqrt

class DenoiseTest {
    private val sr = 48000

    private fun rms(x: FloatArray, from: Int, to: Int): Double {
        var s = 0.0
        for (i in from until to) s += x[i].toDouble() * x[i]
        return sqrt(s / (to - from))
    }

    /** Four "knocks" (decaying 440 Hz tones) over a steady room hiss. */
    private fun take(): FloatArray {
        val rnd = Random(3)
        val x = FloatArray(sr * 4)
        for (i in x.indices) x[i] = (rnd.nextGaussian() * 0.02).toFloat()
        for (hit in 0 until 4) {
            val start = (0.3 + hit * 0.9) * sr
            for (k in 0 until sr / 3) {
                val t = k.toDouble() / sr
                x[start.toInt() + k] += (0.5 * sin(2 * PI * 440 * t) * exp(-t / 0.08)).toFloat()
            }
        }
        return x
    }

    @Test
    fun removesRoomNoiseAndKeepsTheHits() {
        val x = take()
        val gapBefore = rms(x, (0.9 * sr).toInt(), (1.1 * sr).toInt())
        val hitBefore = rms(x, (0.3 * sr).toInt(), (0.35 * sr).toInt())
        val db = Denoise.clean(x, sr)
        val gapAfter = rms(x, (0.9 * sr).toInt(), (1.1 * sr).toInt())
        val hitAfter = rms(x, (0.3 * sr).toInt(), (0.35 * sr).toInt())
        assertTrue("reported reduction $db dB", db > 10)
        assertTrue("noise between hits drops > 20 dB", 20 * log10(gapBefore / gapAfter) > 20)
        assertTrue("the hit keeps its level (${hitAfter / hitBefore})", hitAfter / hitBefore > 0.8)
    }

    @Test
    fun leavesAudioAloneWhenTheRoomCannotBeMeasured() {
        val x = FloatArray(sr) { (0.5 * sin(2 * PI * 220 * it / sr)).toFloat() } // no quiet part
        val before = x.copyOf()
        Denoise.clean(x, sr)
        var diff = 0.0
        for (i in x.indices) diff += kotlin.math.abs(x[i] - before[i])
        assertTrue(diff / x.size < 1e-3)
    }
}
