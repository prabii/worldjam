package com.worldjam.media.render

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The offline renderer: executes a RenderGraph block by block, so a minute of
 * stereo audio renders in constant memory (a few blocks per layer/bus) instead
 * of holding every layer at full length. Deterministic: the same graph and
 * sources always produce the same samples.
 */
class Mixer(
    private val graph: RenderGraph,
    /** Mono PCM for a source, already resampled to graph.sampleRate, trimmed and gain-applied. */
    sources: Map<String, FloatArray>,
) {
    companion object {
        const val BLOCK = 2048
    }

    class Stats(val frames: Long, val peakDb: Double, val rmsDb: Double, val peaks: DoubleArray)

    private val sr = graph.sampleRate
    private val totalFrames = (graph.durationSec * sr).roundToLong()

    private inner class EventState(e: GraphEvent, val src: FloatArray) {
        val start = (e.timeSec * sr).roundToLong()
        val rate = e.rate
        val loop = e.loop && src.size > 2
        val gain = dbToGain(e.gainDb)
        val pan = e.pan
        /** How many output frames the source lasts at this rate (non-looping). */
        private val natural = floor((src.size - 1) / rate).toLong().coerceAtLeast(0)
        val length: Long = when {
            e.durationSec != null -> min((e.durationSec * sr).roundToLong(), if (loop) Long.MAX_VALUE else natural)
            loop -> totalFrames - start
            else -> natural
        }.coerceAtLeast(0)
        val end = start + length
        // 0 = no fade (a click must keep its first sample).
        val fadeIn = (e.fadeInSec * sr).roundToLong()
        val fadeOut = (e.fadeOutSec * sr).roundToLong()
    }

    private inner class LayerState(l: GraphLayer, src: FloatArray) {
        val gain = dbToGain(l.gainDb)
        val pan = l.pan
        val events = l.events.map { EventState(it, src) }.filter { it.length > 0 }
        val fx = l.effects.mapNotNull { GraphParser.effect(it, sr) }
        val automation = l.automation
        val bus = l.bus
        val left = FloatArray(BLOCK)
        val right = FloatArray(BLOCK)

        /** Automation gain (linear) at an absolute frame; flat before the first and after the last point. */
        fun autoGain(frame: Long): Float {
            if (automation.isEmpty()) return 1f
            val t = frame.toDouble() / sr
            if (t <= automation.first().timeSec) return dbToGain(automation.first().gainDb)
            if (t >= automation.last().timeSec) return dbToGain(automation.last().gainDb)
            for (i in 1 until automation.size) {
                val b = automation[i]
                if (t <= b.timeSec) {
                    val a = automation[i - 1]
                    val span = b.timeSec - a.timeSec
                    val k = if (span <= 0) 1.0 else (t - a.timeSec) / span
                    return dbToGain(a.gainDb + (b.gainDb - a.gainDb) * k)
                }
            }
            return 1f
        }
    }

    private class BusState(val gain: Float, val fx: List<StereoFx>) {
        val left = FloatArray(BLOCK)
        val right = FloatArray(BLOCK)
    }

    private val layers = graph.layers.mapNotNull { l -> sources[l.sourceId]?.let { LayerState(l, it) } }
    private val buses: Map<String, BusState> = layers.map { it.bus }.distinct().associateWith { name ->
        val spec = graph.buses.firstOrNull { it.name == name }
        BusState(dbToGain(spec?.gainDb ?: 0.0), spec?.effects?.mapNotNull { GraphParser.effect(it, sr) } ?: emptyList())
    }
    private val glue = graph.master.glue?.let { GraphParser.compressor(it, sr) }
    private val limiter = Limiter(sr, graph.master.limiterCeilingDb)
    private val masterGain = dbToGain(graph.master.gainDb)
    private val fadeOutFrames = (graph.master.fadeOutSec * sr).roundToLong()

    private fun panGains(pan: Double): Pair<Float, Float> {
        // Constant-power: equal loudness as a sound moves across the field.
        val angle = (pan.coerceIn(-1.0, 1.0) + 1.0) * PI / 4.0
        return Pair(cos(angle).toFloat(), sin(angle).toFloat())
    }

    private fun renderLayer(ls: LayerState, blockStart: Long, n: Int) {
        ls.left.fill(0f, 0, n)
        ls.right.fill(0f, 0, n)
        val blockEnd = blockStart + n
        for (e in ls.events) {
            if (e.end <= blockStart || e.start >= blockEnd) continue
            val (gl, gr) = panGains(e.pan ?: ls.pan)
            val src = e.src
            val loopLen = (src.size - 1).toDouble()
            val from = max(blockStart, e.start)
            val to = min(blockEnd, e.end)
            for (f in from until to) {
                val t = f - e.start
                var p = t * e.rate
                if (e.loop) p %= loopLen
                val i0 = p.toInt()
                val s = if (i0 + 1 >= src.size) src[src.size - 1] else {
                    val frac = (p - i0).toFloat()
                    src[i0] + (src[i0 + 1] - src[i0]) * frac
                }
                var env = 1f
                if (t < e.fadeIn) env = t.toFloat() / e.fadeIn
                val left = e.end - f
                if (left < e.fadeOut) env = min(env, left.toFloat() / e.fadeOut)
                val v = s * e.gain * env
                val o = (f - blockStart).toInt()
                ls.left[o] += v * gl
                ls.right[o] += v * gr
            }
        }
        // Layer gain + automation, interpolated across the block.
        val g0 = ls.gain * ls.autoGain(blockStart)
        val g1 = ls.gain * ls.autoGain(blockEnd)
        for (i in 0 until n) {
            val g = g0 + (g1 - g0) * (i.toFloat() / n)
            ls.left[i] *= g
            ls.right[i] *= g
        }
        for (fx in ls.fx) fx.process(ls.left, ls.right, n)
    }

    /**
     * Renders the whole graph, handing each finished stereo block to `sink`.
     * The limiter's look-ahead delay is compensated, so output stays aligned
     * to the graph's timeline.
     */
    fun render(peakBuckets: Int, onProgress: (Double) -> Unit, sink: (FloatArray, FloatArray, Int) -> Unit): Stats {
        val latency = limiter.latency.toLong()
        val renderFrames = totalFrames + latency
        val outL = FloatArray(BLOCK)
        val outR = FloatArray(BLOCK)
        val buckets = max(1, peakBuckets)
        val peaks = DoubleArray(buckets)
        var peak = 0f
        var sumSq = 0.0
        var written = 0L
        var skip = latency
        var lastProgress = -1.0

        var blockStart = 0L
        while (blockStart < renderFrames) {
            val n = min(BLOCK.toLong(), renderFrames - blockStart).toInt()
            for (b in buses.values) {
                b.left.fill(0f, 0, n); b.right.fill(0f, 0, n)
            }
            for (ls in layers) {
                renderLayer(ls, blockStart, n)
                val bus = buses.getValue(ls.bus)
                for (i in 0 until n) {
                    bus.left[i] += ls.left[i]; bus.right[i] += ls.right[i]
                }
            }
            outL.fill(0f, 0, n); outR.fill(0f, 0, n)
            for (bus in buses.values) {
                for (fx in bus.fx) fx.process(bus.left, bus.right, n)
                for (i in 0 until n) {
                    outL[i] += bus.left[i] * bus.gain; outR[i] += bus.right[i] * bus.gain
                }
            }
            for (i in 0 until n) {
                outL[i] *= masterGain; outR[i] *= masterGain
            }
            glue?.process(outL, outR, n)
            if (fadeOutFrames > 0) {
                val fadeStart = totalFrames - fadeOutFrames
                for (i in 0 until n) {
                    val f = blockStart + i
                    if (f >= fadeStart) {
                        val k = ((totalFrames - f).toFloat() / fadeOutFrames).coerceIn(0f, 1f)
                        outL[i] *= k; outR[i] *= k
                    }
                }
            }
            limiter.process(outL, outR, n)

            // Drop the limiter's look-ahead from the front so time 0 is time 0.
            var offset = 0
            if (skip > 0) {
                offset = min(skip, n.toLong()).toInt()
                skip -= offset
            }
            val count = min(n - offset, (totalFrames - written).toInt())
            if (count > 0) {
                val l = if (offset == 0) outL else outL.copyOfRange(offset, offset + count)
                val r = if (offset == 0) outR else outR.copyOfRange(offset, offset + count)
                for (i in 0 until count) {
                    val a = max(abs(l[i]), abs(r[i]))
                    if (a > peak) peak = a
                    sumSq += (l[i] * l[i] + r[i] * r[i]) / 2.0
                    val bucket = ((written + i) * buckets / max(1L, totalFrames)).toInt().coerceIn(0, buckets - 1)
                    if (a > peaks[bucket]) peaks[bucket] = a.toDouble()
                }
                sink(l, r, count)
                written += count
            }
            blockStart += n
            val progress = blockStart.toDouble() / renderFrames
            if (progress - lastProgress >= 0.05) {
                lastProgress = progress
                onProgress(progress)
            }
        }
        val maxBucket = peaks.maxOrNull() ?: 0.0
        if (maxBucket > 0) for (i in peaks.indices) peaks[i] /= maxBucket
        val rms = if (written > 0) sqrt(sumSq / written) else 0.0
        return Stats(written, gainToDb(peak.toDouble()), gainToDb(rms), peaks)
    }
}
