package com.worldjam.media.render

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.tanh

fun dbToGain(db: Double): Float = 10.0.pow(db / 20.0).toFloat()
fun gainToDb(g: Double): Double = if (g <= 1e-9) -180.0 else 20.0 * log10(g)

/** A stereo processor that keeps its own state across blocks. */
interface StereoFx {
    fun process(l: FloatArray, r: FloatArray, n: Int)
}

/** RBJ cookbook biquad (lowpass / highpass / peaking EQ), one state per channel. */
class Biquad(type: String, sr: Int, freq: Double, q: Double, gainDb: Double = 0.0) : StereoFx {
    private val b0: Float; private val b1: Float; private val b2: Float; private val a1: Float; private val a2: Float
    private val z = FloatArray(4) // x1, x2 are folded into DF2T state per channel: [l1, l2, r1, r2]

    init {
        val f = freq.coerceIn(20.0, sr * 0.45)
        val w = 2 * PI * f / sr
        val alpha = sin(w) / (2 * q.coerceIn(0.1, 18.0))
        val cw = cos(w)
        val a = 10.0.pow(gainDb / 40.0)
        val c: DoubleArray = when (type) {
            "highpass" -> doubleArrayOf((1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + alpha, -2 * cw, 1 - alpha)
            "peak" -> doubleArrayOf(1 + alpha * a, -2 * cw, 1 - alpha * a, 1 + alpha / a, -2 * cw, 1 - alpha / a)
            else -> doubleArrayOf((1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + alpha, -2 * cw, 1 - alpha)
        }
        b0 = (c[0] / c[3]).toFloat(); b1 = (c[1] / c[3]).toFloat(); b2 = (c[2] / c[3]).toFloat()
        a1 = (c[4] / c[3]).toFloat(); a2 = (c[5] / c[3]).toFloat()
    }

    override fun process(l: FloatArray, r: FloatArray, n: Int) {
        run(l, n, 0); run(r, n, 2)
    }

    private fun run(x: FloatArray, n: Int, o: Int) {
        var s1 = z[o]; var s2 = z[o + 1]
        for (i in 0 until n) {
            val input = x[i]
            val y = b0 * input + s1
            s1 = b1 * input - a1 * y + s2
            s2 = b2 * input - a2 * y
            x[i] = y
        }
        // Flush denormals so a silent tail does not burn CPU.
        z[o] = if (abs(s1) < 1e-20f) 0f else s1
        z[o + 1] = if (abs(s2) < 1e-20f) 0f else s2
    }
}

/** Stereo feedback delay; `mix` is the wet level added over the dry signal. */
class Delay(sr: Int, timeSec: Double, private val feedback: Float, private val mix: Float) : StereoFx {
    private val len = max(1, (timeSec.coerceIn(0.01, 2.0) * sr).toInt())
    private val bl = FloatArray(len); private val br = FloatArray(len)
    private var pos = 0

    override fun process(l: FloatArray, r: FloatArray, n: Int) {
        val fb = feedback.coerceIn(0f, 0.92f)
        for (i in 0 until n) {
            val dl = bl[pos]; val dr = br[pos]
            // Ping-pong: each side feeds the other, so repeats move across the stereo field.
            bl[pos] = l[i] + dr * fb
            br[pos] = r[i] + dl * fb
            l[i] += dl * mix; r[i] += dr * mix
            if (++pos == len) pos = 0
        }
    }
}

/** Freeverb (Jezar): 8 damped combs + 4 allpasses per channel, right channel spread by 23 samples. */
class Reverb(sr: Int, roomSize: Double, damping: Double, private val mix: Float) : StereoFx {
    private val scale = sr / 44100.0
    private val combTuning = intArrayOf(1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617)
    private val allTuning = intArrayOf(556, 441, 341, 225)
    private val spread = 23
    private val feedback = (0.7 + 0.28 * roomSize.coerceIn(0.0, 1.0)).toFloat()
    private val damp = (0.4 * damping.coerceIn(0.0, 1.0)).toFloat()
    private val combL = combTuning.map { Comb((it * scale).toInt()) }
    private val combR = combTuning.map { Comb(((it + spread) * scale).toInt()) }
    private val allL = allTuning.map { AllPass((it * scale).toInt()) }
    private val allR = allTuning.map { AllPass(((it + spread) * scale).toInt()) }

    private inner class Comb(size: Int) {
        val buf = FloatArray(max(1, size)); var idx = 0; var store = 0f
        fun tick(x: Float): Float {
            val out = buf[idx]
            store = out * (1 - damp) + store * damp
            buf[idx] = x + store * feedback
            if (++idx == buf.size) idx = 0
            return out
        }
    }

    private class AllPass(size: Int) {
        val buf = FloatArray(max(1, size)); var idx = 0
        fun tick(x: Float): Float {
            val b = buf[idx]
            buf[idx] = x + b * 0.5f
            if (++idx == buf.size) idx = 0
            return b - x
        }
    }

    override fun process(l: FloatArray, r: FloatArray, n: Int) {
        val wet = mix.coerceIn(0f, 1f)
        for (i in 0 until n) {
            val input = (l[i] + r[i]) * 0.015f
            var ol = 0f; var or = 0f
            for (c in combL) ol += c.tick(input)
            for (c in combR) or += c.tick(input)
            for (a in allL) ol = a.tick(ol)
            for (a in allR) or = a.tick(or)
            l[i] = l[i] * (1 - wet * 0.5f) + ol * wet
            r[i] = r[i] * (1 - wet * 0.5f) + or * wet
        }
    }
}

/** tanh soft clip, normalised so drive changes colour rather than level. */
class Saturation(drive: Double, private val mix: Float) : StereoFx {
    private val d = drive.coerceIn(1.0, 10.0).toFloat()
    private val norm = 1f / tanh(d)
    override fun process(l: FloatArray, r: FloatArray, n: Int) {
        val m = mix.coerceIn(0f, 1f)
        for (i in 0 until n) {
            l[i] = l[i] * (1 - m) + tanh(l[i] * d) * norm * m
            r[i] = r[i] * (1 - m) + tanh(r[i] * d) * norm * m
        }
    }
}

/** Feed-forward, stereo-linked compressor with a peak detector in the dB domain. */
class Compressor(sr: Int, private val thresholdDb: Double, ratio: Double, attackMs: Double, releaseMs: Double, makeupDb: Double) : StereoFx {
    private val slope = 1.0 - 1.0 / ratio.coerceIn(1.0, 30.0)
    private val att = exp(-1.0 / (sr * attackMs.coerceIn(0.1, 200.0) / 1000.0))
    private val rel = exp(-1.0 / (sr * releaseMs.coerceIn(5.0, 2000.0) / 1000.0))
    private val makeup = dbToGain(makeupDb)
    private var env = 0.0
    var lastReductionDb = 0.0
        private set

    override fun process(l: FloatArray, r: FloatArray, n: Int) {
        var maxRed = 0.0
        for (i in 0 until n) {
            val peak = max(abs(l[i]), abs(r[i])).toDouble()
            val c = if (peak > env) att else rel
            env = c * env + (1 - c) * peak
            val over = gainToDb(env) - thresholdDb
            val redDb = if (over > 0) over * slope else 0.0
            maxRed = max(maxRed, redDb)
            val g = dbToGain(-redDb) * makeup
            l[i] *= g; r[i] *= g
        }
        lastReductionDb = maxRed
    }
}

/**
 * Look-ahead brick-wall limiter. The signal is delayed by the look-ahead so the
 * gain can come down BEFORE a peak arrives; a final clamp guarantees no sample
 * ever exceeds the ceiling even in pathological cases.
 */
class Limiter(sr: Int, ceilingDb: Double, lookaheadMs: Double = 5.0, releaseMs: Double = 80.0) : StereoFx {
    private val ceiling = dbToGain(min(-0.1, ceilingDb))
    private val look = max(1, (sr * lookaheadMs / 1000.0).toInt())
    private val dl = FloatArray(look); private val dr = FloatArray(look)
    private var pos = 0
    private var gain = 1f
    private val rel = exp(-1.0 / (sr * releaseMs / 1000.0)).toFloat()
    // Peak-hold envelope: a new peak is held for the full look-ahead, so the
    // delayed sample that caused it always meets a gain low enough for it.
    private var env = 0f
    private var hold = 0

    override fun process(l: FloatArray, r: FloatArray, n: Int) {
        for (i in 0 until n) {
            val peak = max(abs(l[i]), abs(r[i]))
            if (peak >= env) {
                env = peak; hold = look
            } else if (hold > 0) {
                hold--
            } else {
                env = max(peak, env * rel)
            }
            val target = if (env > ceiling) ceiling / env else 1f
            gain = if (target < gain) target else target + (gain - target) * rel
            val outL = dl[pos] * gain; val outR = dr[pos] * gain
            dl[pos] = l[i]; dr[pos] = r[i]
            l[i] = outL.coerceIn(-ceiling, ceiling)
            r[i] = outR.coerceIn(-ceiling, ceiling)
            if (++pos == look) pos = 0
        }
    }

    val latency: Int get() = look
}
