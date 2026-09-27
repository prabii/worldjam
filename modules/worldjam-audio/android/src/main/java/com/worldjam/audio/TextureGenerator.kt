package com.worldjam.audio

import android.content.Context
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.TimeUnit

/**
 * Runs Stable Audio Open Small on the phone to make a background texture layer.
 *
 * The model runs in sa3.cpp's `sat-generate`, packaged in the APK as
 * `libsatgen.so`. Android only lets an app execute files from its native
 * library directory, so the executable ships there under a library name and
 * runs as a separate process. The process gives crash isolation (a failed
 * generation cannot take the audio engine down with it) and returns all of its
 * memory the moment it exits, which matters with Gemma resident beside it.
 *
 * Model weights live in the app's private files dir under `sao/`, beside Gemma.
 *
 * Powered by Stability AI. The weights are under the Stability AI Community
 * License; see the NOTICE shipped with the model files.
 */
class TextureGenerator(private val context: Context) {

    companion object {
        const val DIT = "stable-audio-open-small-dit-0.3B-v1.0-Q5_K_M.gguf"
        const val T5 = "t5-base-encoder-0.1B-v1.0-Q5_K_M.gguf"
        const val AE = "stable-audio-open-small-oobleck-v1.0-Q5_K_M.gguf"
        private const val TIMEOUT_S = 150L
    }

    private val binary: File get() = File(context.applicationInfo.nativeLibraryDir, "libsatgen.so")
    /** Internal files first (the in-app downloader), then external files (adb-pushable on release builds). */
    private val modelsDir: File get() = listOfNotNull(
        File(context.filesDir, "sao"),
        context.getExternalFilesDir(null)?.let { File(it, "sao") },
    ).firstOrNull { dir -> listOf(DIT, T5, AE).all { File(dir, it).isFile } } ?: File(context.filesDir, "sao")

    /** Why generation cannot run, or null when it can. */
    fun unavailableReason(): String? {
        if (!binary.exists()) return "texture engine not packaged in this build"
        for (name in listOf(DIT, T5, AE)) {
            if (!File(modelsDir, name).exists()) return "model file missing: sao/$name"
        }
        return null
    }

    data class Result(val pcm: FloatArray, val elapsedMs: Long, val log: String)

    /**
     * Generates [seconds] of audio for [prompt] and returns it as mono float
     * PCM at [targetRate], trimmed to exactly [seconds] with short fades so it
     * loops without a click. Blocking: call from a background thread.
     */
    fun generate(prompt: String, seconds: Double, seed: Int, targetRate: Int, threads: Int): Result {
        unavailableReason()?.let { throw IllegalStateException(it) }

        val out = File(context.cacheDir, "texture-${System.currentTimeMillis()}.wav")
        val started = System.nanoTime()
        val pb = ProcessBuilder(
            binary.absolutePath,
            "--models-dir", modelsDir.absolutePath,
            "--model", "arc",
            "--encoding", "Q5_K_M",
            "--prompt", prompt,
            // The model makes up to ~11 s; ask for a little more than the loop
            // so the trim below never runs short.
            "--seconds", String.format("%.2f", minOf(11.0, seconds + 0.25)),
            "--seed", seed.toString(),
            "--out", out.absolutePath,
        )
        pb.environment()["SA3_THREADS"] = threads.toString()
        pb.redirectErrorStream(true)

        val process = pb.start()
        // Drained on its own thread: a full pipe would otherwise block the
        // child and the timeout below would be the only way out.
        val logBuf = StringBuilder()
        val reader = Thread {
            process.inputStream.bufferedReader().forEachLine { line ->
                synchronized(logBuf) { logBuf.append(line).append('\n') }
            }
        }.apply { start() }

        if (!process.waitFor(TIMEOUT_S, TimeUnit.SECONDS)) {
            process.destroyForcibly()
            throw IllegalStateException("texture generation timed out after ${TIMEOUT_S}s")
        }
        reader.join(1000)
        val log = synchronized(logBuf) { logBuf.toString() }
        val elapsedMs = (System.nanoTime() - started) / 1_000_000

        if (process.exitValue() != 0 || !out.exists()) {
            throw IllegalStateException("generator exited ${process.exitValue()}: ${log.takeLast(300)}")
        }

        try {
            val (stereo, rate, channels) = readWav(out)
            val mono = toMono(stereo, channels)
            val resampled = resample(mono, rate, targetRate)
            val frames = minOf(resampled.size, (seconds * targetRate).toInt())
            val trimmed = resampled.copyOf(frames)
            fade(trimmed, targetRate)
            return Result(trimmed, elapsedMs, log.takeLast(600))
        } finally {
            out.delete()
        }
    }

    /** Minimal RIFF reader for the 16-bit or 32-bit float PCM sat-generate writes. */
    private fun readWav(file: File): Triple<FloatArray, Int, Int> {
        val bytes = RandomAccessFile(file, "r").use { f ->
            ByteArray(f.length().toInt()).also { f.readFully(it) }
        }
        val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
        require(String(bytes, 0, 4) == "RIFF" && String(bytes, 8, 4) == "WAVE") { "not a WAV file" }

        var pos = 12
        var format = 1
        var channels = 2
        var rate = 44100
        var bits = 16
        while (pos + 8 <= bytes.size) {
            val id = String(bytes, pos, 4)
            val size = buf.getInt(pos + 4)
            val body = pos + 8
            when (id) {
                "fmt " -> {
                    format = buf.getShort(body).toInt() and 0xffff
                    channels = buf.getShort(body + 2).toInt()
                    rate = buf.getInt(body + 4)
                    bits = buf.getShort(body + 14).toInt()
                }
                "data" -> {
                    val end = minOf(bytes.size, body + size)
                    val samples = when {
                        format == 3 && bits == 32 -> FloatArray((end - body) / 4) { buf.getFloat(body + it * 4) }
                        bits == 16 -> FloatArray((end - body) / 2) { buf.getShort(body + it * 2) / 32768f }
                        else -> throw IllegalStateException("unsupported WAV: format $format, $bits bit")
                    }
                    return Triple(samples, rate, channels)
                }
            }
            pos = body + size + (size and 1)
        }
        throw IllegalStateException("WAV has no data chunk")
    }

    private fun toMono(interleaved: FloatArray, channels: Int): FloatArray {
        if (channels <= 1) return interleaved
        val n = interleaved.size / channels
        return FloatArray(n) { i ->
            var sum = 0f
            for (c in 0 until channels) sum += interleaved[i * channels + c]
            sum / channels
        }
    }

    private fun resample(src: FloatArray, from: Int, to: Int): FloatArray {
        if (from == to || src.isEmpty()) return src
        val ratio = from.toDouble() / to
        val n = (src.size / ratio).toInt()
        return FloatArray(n) { i ->
            val x = i * ratio
            val i0 = x.toInt().coerceAtMost(src.size - 1)
            val i1 = (i0 + 1).coerceAtMost(src.size - 1)
            val t = (x - i0).toFloat()
            src[i0] * (1 - t) + src[i1] * t
        }
    }

    /** 15 ms in, 40 ms out: no click at the loop seam. */
    private fun fade(pcm: FloatArray, rate: Int) {
        val fin = minOf(pcm.size, rate * 15 / 1000)
        val fout = minOf(pcm.size, rate * 40 / 1000)
        for (i in 0 until fin) pcm[i] *= i / fin.toFloat()
        for (i in 0 until fout) pcm[pcm.size - 1 - i] *= i / fout.toFloat()
    }
}
