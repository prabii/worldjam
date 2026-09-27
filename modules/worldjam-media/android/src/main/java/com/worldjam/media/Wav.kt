package com.worldjam.media

import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Interleaved float PCM. */
class Pcm(val data: FloatArray, val sampleRate: Int, val channels: Int) {
    val frames: Int get() = if (channels == 0) 0 else data.size / channels
    val durationSec: Double get() = frames.toDouble() / sampleRate
}

/** Plain-Kotlin WAV I/O and basic conversions (no Android dependencies, so JVM-testable). */
object Wav {

    fun read(file: File): Pcm {
        val bytes = RandomAccessFile(file, "r").use { f -> ByteArray(f.length().toInt()).also { f.readFully(it) } }
        return parse(bytes)
    }

    fun parse(bytes: ByteArray): Pcm {
        val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        require(bytes.size >= 12 && String(bytes, 0, 4) == "RIFF" && String(bytes, 8, 4) == "WAVE") { "not a WAV file" }
        var pos = 12
        var format = 1
        var channels = 1
        var rate = 48000
        var bits = 16
        while (pos + 8 <= bytes.size) {
            val id = String(bytes, pos, 4)
            val size = buf.getInt(pos + 4)
            val body = pos + 8
            if (id == "fmt ") {
                format = buf.getShort(body).toInt() and 0xffff
                channels = max(1, buf.getShort(body + 2).toInt())
                rate = buf.getInt(body + 4)
                bits = buf.getShort(body + 14).toInt()
                if (format == 0xFFFE && size >= 26) format = buf.getShort(body + 24).toInt() and 0xffff
            } else if (id == "data") {
                val end = min(bytes.size, body + max(0, size))
                val bps = bits / 8
                val n = (end - body) / bps
                val out = FloatArray(n - n % channels)
                for (i in out.indices) {
                    val o = body + i * bps
                    out[i] = when {
                        format == 3 && bits == 32 -> buf.getFloat(o)
                        bits == 16 -> buf.getShort(o) / 32768f
                        bits == 24 -> {
                            val v = (bytes[o].toInt() and 0xff) or ((bytes[o + 1].toInt() and 0xff) shl 8) or (bytes[o + 2].toInt() shl 16)
                            v / 8388608f
                        }
                        bits == 32 -> buf.getInt(o) / 2147483648f
                        bits == 8 -> ((bytes[o].toInt() and 0xff) - 128) / 128f
                        else -> throw IllegalStateException("unsupported WAV: format $format, $bits bit")
                    }
                }
                return Pcm(out, rate, channels)
            }
            pos = body + size + (size and 1)
        }
        throw IllegalStateException("WAV has no data chunk")
    }

    /** Writes 16-bit PCM (clamped, rounded). */
    fun write16(file: File, pcm: Pcm) {
        file.parentFile?.mkdirs()
        val dataBytes = pcm.data.size * 2
        BufferedOutputStream(FileOutputStream(file), 1 shl 16).use { out ->
            out.write(header(pcm.sampleRate, pcm.channels, 16, 1, dataBytes))
            val chunk = ByteBuffer.allocate(8192).order(ByteOrder.LITTLE_ENDIAN)
            for (x in pcm.data) {
                if (chunk.remaining() < 2) {
                    out.write(chunk.array(), 0, chunk.position()); chunk.clear()
                }
                chunk.putShort((x.coerceIn(-1f, 1f) * 32767f).roundToInt().toShort())
            }
            out.write(chunk.array(), 0, chunk.position())
        }
    }

    /** Writes 32-bit float PCM. */
    fun writeFloat(file: File, pcm: Pcm) {
        file.parentFile?.mkdirs()
        BufferedOutputStream(FileOutputStream(file), 1 shl 16).use { out ->
            out.write(header(pcm.sampleRate, pcm.channels, 32, 3, pcm.data.size * 4))
            val chunk = ByteBuffer.allocate(8192).order(ByteOrder.LITTLE_ENDIAN)
            for (x in pcm.data) {
                if (chunk.remaining() < 4) {
                    out.write(chunk.array(), 0, chunk.position()); chunk.clear()
                }
                chunk.putFloat(x)
            }
            out.write(chunk.array(), 0, chunk.position())
        }
    }

    private fun header(rate: Int, channels: Int, bits: Int, format: Int, dataBytes: Int): ByteArray {
        val b = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        b.put("RIFF".toByteArray()); b.putInt(36 + dataBytes); b.put("WAVE".toByteArray())
        b.put("fmt ".toByteArray()); b.putInt(16); b.putShort(format.toShort()); b.putShort(channels.toShort())
        b.putInt(rate); b.putInt(rate * channels * bits / 8); b.putShort((channels * bits / 8).toShort()); b.putShort(bits.toShort())
        b.put("data".toByteArray()); b.putInt(dataBytes)
        return b.array()
    }

    fun toMono(p: Pcm): Pcm {
        if (p.channels == 1) return p
        val n = p.frames
        val out = FloatArray(n)
        for (i in 0 until n) {
            var s = 0f
            for (c in 0 until p.channels) s += p.data[i * p.channels + c]
            out[i] = s / p.channels
        }
        return Pcm(out, p.sampleRate, 1)
    }

    /**
     * Linear-interpolation resampler, per channel. Adequate for one-shot
     * sounds and preview material; not a mastering-grade SRC.
     */
    fun resample(p: Pcm, to: Int): Pcm {
        if (p.sampleRate == to || p.frames == 0) return p
        val ratio = p.sampleRate.toDouble() / to
        val outFrames = (p.frames / ratio).toInt()
        val ch = p.channels
        val out = FloatArray(outFrames * ch)
        val last = p.frames - 1
        for (i in 0 until outFrames) {
            val x = i * ratio
            val i0 = min(x.toInt(), last)
            val i1 = min(i0 + 1, last)
            val t = (x - i0).toFloat()
            for (c in 0 until ch) {
                val a = p.data[i0 * ch + c]
                out[i * ch + c] = a + (p.data[i1 * ch + c] - a) * t
            }
        }
        return Pcm(out, to, ch)
    }

    /** Normalised 0..1 peak envelope over `buckets` equal slices. */
    fun peaks(p: Pcm, buckets: Int): DoubleArray {
        val n = max(1, buckets)
        val frames = p.frames
        val out = DoubleArray(n)
        if (frames == 0) return out
        var maxAll = 0f
        for (b in 0 until n) {
            val from = (b.toLong() * frames / n).toInt()
            val to = max(from + 1, ((b + 1).toLong() * frames / n).toInt()).coerceAtMost(frames)
            var m = 0f
            for (i in from * p.channels until to * p.channels) m = max(m, abs(p.data[i]))
            out[b] = m.toDouble()
            maxAll = max(maxAll, m)
        }
        if (maxAll > 0f) for (b in 0 until n) out[b] = out[b] / maxAll
        return out
    }
}
