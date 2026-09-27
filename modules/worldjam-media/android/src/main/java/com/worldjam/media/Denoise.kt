package com.worldjam.media

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Keeps the captured object's sound and removes the room around it
 * (port of src/dsp/denoise.ts, same parameters):
 *
 *  1. the room's noise floor = 20th percentile of 20 ms frame energies;
 *  2. its spectrum is averaged from the quiet frames (<= 1.6x the floor);
 *  3. spectral subtraction (1024-pt Hann, 75 % overlap-add, strength 1.5,
 *     5 % spectral floor so there is no "musical noise");
 *  4. a soft gate pulls what is left between sounds down to near silence,
 *     with a fast attack and a slow release so attacks and ringing tails stay.
 *
 * Unlike the V1 analysis path it keeps the whole take (a tapped rhythm, a hum
 * or a video's audio), and when the room cannot be characterised (too little
 * quiet material) it leaves the audio alone. Returns the reduction in dB.
 */
object Denoise {
    private const val FRAME = 1024
    private const val HOP = FRAME / 4

    fun clean(x: FloatArray, sampleRate: Int, strength: Float = 1.5f): Double {
        if (x.size < FRAME * 2) return 0.0
        val floorBefore = noiseFloor(x, sampleRate)
        if (floorBefore <= 1e-7) return 0.0
        // Only a take with real quiet parts (room >= 12 dB under the loudest sound)
        // tells us what the room sounds like; otherwise leave it untouched.
        if (floorBefore > loudest(x, sampleRate) * 0.25) return 0.0
        if (!spectralSubtract(x, floorBefore, strength)) return 0.0
        gate(x, sampleRate)
        val floorAfter = noiseFloor(x, sampleRate)
        return if (floorAfter > 1e-9) max(0.0, 20 * log10(floorBefore / floorAfter)) else 40.0
    }

    fun noiseFloor(x: FloatArray, sampleRate: Int): Double {
        val frame = max(64, sampleRate / 50)
        val e = ArrayList<Double>()
        var i = 0
        while (i + frame <= x.size) {
            e.add(rms(x, i, i + frame))
            i += frame
        }
        if (e.isEmpty()) return 0.0
        e.sort()
        return e[(e.size * 0.2).toInt()]
    }

    private fun loudest(x: FloatArray, sampleRate: Int): Double {
        val frame = max(64, sampleRate / 50)
        var best = 0.0
        var i = 0
        while (i + frame <= x.size) {
            best = max(best, rms(x, i, i + frame))
            i += frame
        }
        return best
    }

    private fun rms(x: FloatArray, from: Int, to: Int): Double {
        var s = 0.0
        for (i in from until to) s += x[i].toDouble() * x[i]
        return sqrt(s / max(1, to - from))
    }

    private val window = DoubleArray(FRAME) { 0.5 * (1 - cos(2 * PI * it / (FRAME - 1))) }

    private fun spectralSubtract(x: FloatArray, floor: Double, strength: Float): Boolean {
        val half = FRAME / 2
        val noise = DoubleArray(half)
        var frames = 0
        val re = DoubleArray(FRAME)
        val im = DoubleArray(FRAME)
        val ceiling = floor * 1.6
        var i = 0
        while (i + FRAME <= x.size) {
            if (rms(x, i, i + FRAME) <= ceiling) {
                for (j in 0 until FRAME) { re[j] = x[i + j] * window[j]; im[j] = 0.0 }
                fft(re, im, false)
                for (k in 0 until half) noise[k] += hypot(re[k], im[k])
                frames++
            }
            i += HOP
        }
        if (frames < 2) return false
        for (k in 0 until half) noise[k] = noise[k] / frames

        val out = DoubleArray(x.size)
        val wsum = DoubleArray(x.size)
        i = 0
        while (i + FRAME <= x.size) {
            for (j in 0 until FRAME) { re[j] = x[i + j] * window[j]; im[j] = 0.0 }
            fft(re, im, false)
            for (k in 1 until half) {
                val mag = hypot(re[k], im[k])
                if (mag < 1e-12) continue
                val scale = max(0.05, max(0.0, mag - strength * noise[k]) / mag)
                re[k] *= scale; im[k] *= scale
                val m = FRAME - k
                re[m] *= scale; im[m] *= scale
            }
            fft(re, im, true)
            for (j in 0 until FRAME) {
                out[i + j] += re[j] * window[j]
                wsum[i + j] += window[j] * window[j]
            }
            i += HOP
        }
        for (n in x.indices) if (wsum[n] > 1e-6) x[n] = (out[n] / wsum[n]).toFloat()
        return true
    }

    /**
     * Soft gate: -30 dB below the threshold, 1 ms attack with 5 ms look-ahead
     * (it is already open when the attack arrives), 120 ms release, 60 ms hold.
     */
    private fun gate(x: FloatArray, sampleRate: Int) {
        val floor = noiseFloor(x, sampleRate)
        var peak = 0f
        for (v in x) peak = max(peak, abs(v))
        val threshold = max(floor * 2.5, peak * 0.012)
        val win = max(1, sampleRate / 200) // 5 ms envelope blocks
        val env = DoubleArray(x.size)
        var b = 0
        while (b < x.size) {
            val e = min(x.size, b + win)
            val v = rms(x, b, e)
            for (i in b until e) env[i] = v
            b = e
        }
        val lookahead = win
        val attack = exp(-1.0 / (0.001 * sampleRate))
        val release = exp(-1.0 / (0.12 * sampleRate))
        val hold = (0.06 * sampleRate).toInt()
        val closed = 0.0316 // -30 dB
        var g = closed
        var held = 0
        for (n in x.indices) {
            val open = env[min(x.size - 1, n + lookahead)] > threshold || env[n] > threshold
            if (open) held = hold else if (held > 0) held--
            val target = if (open || held > 0) 1.0 else closed
            g = if (target > g) target + (g - target) * attack else target + (g - target) * release
            x[n] = (x[n] * g).toFloat()
        }
    }

    /** In-place radix-2 FFT; `inverse` scales by 1/n. */
    private fun fft(re: DoubleArray, im: DoubleArray, inverse: Boolean) {
        val n = re.size
        var j = 0
        for (i in 1 until n) {
            var bit = n shr 1
            while (j and bit != 0) { j = j xor bit; bit = bit shr 1 }
            j = j xor bit
            if (i < j) {
                var t = re[i]; re[i] = re[j]; re[j] = t
                t = im[i]; im[i] = im[j]; im[j] = t
            }
        }
        var len = 2
        while (len <= n) {
            val ang = 2 * PI / len * (if (inverse) 1 else -1)
            val wr = cos(ang)
            val wi = sin(ang)
            var i = 0
            while (i < n) {
                var cr = 1.0
                var ci = 0.0
                for (k in 0 until len / 2) {
                    val a = i + k
                    val b = a + len / 2
                    val vr = re[b] * cr - im[b] * ci
                    val vi = re[b] * ci + im[b] * cr
                    re[b] = re[a] - vr; im[b] = im[a] - vi
                    re[a] += vr; im[a] += vi
                    val nr = cr * wr - ci * wi
                    ci = cr * wi + ci * wr
                    cr = nr
                }
                i += len
            }
            len = len shl 1
        }
        if (inverse) for (i in 0 until n) { re[i] = re[i] / n; im[i] = im[i] / n }
    }
}
