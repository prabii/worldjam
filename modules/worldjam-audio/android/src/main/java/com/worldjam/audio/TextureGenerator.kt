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

        /**
         * Stable Audio 3 Small-Music, the preferred engine.
         *
         * A general music model rather than a finetune, so it follows a genre
         * instead of pulling every request toward one sound. Measured on the
         * dev phone: 30 s of audio in ~30–40 s at 8 steps, 6 threads — close to
         * real time, where the older model managed 11 s in 19 s. It also makes
         * up to ~45 s per call, so a song section no longer has to loop a clip.
         */
        val SA3_FILES = listOf(
            "stable-audio-3-small-music-dit-0.5B-v1.0-Q5_K_M.gguf",
            "stable-audio-3-small-music-same-s-v1.0-Q5_K_M.gguf",
            "stable-audio-3-small-music-conditioner-v1.0-F32.gguf",
            "t5gemma-b-b-ul2-encoder-0.3B-v1.0-Q8_0.gguf",
            "t5gemma-b-b-ul2-v1.0-vocab.gguf",
        )
        private const val SA3_STEPS = 8
        const val SA3_MAX_SECONDS = 45.0
        const val SAO_MAX_SECONDS = 11.0

        private const val TIMEOUT_S = 180L
    }

    enum class Engine(val label: String) {
        SA3("Stable Audio 3 Small-Music"),
        SAO("Stable Audio Open Small"),
    }

    private val sa3Binary: File get() = File(context.applicationInfo.nativeLibraryDir, "libsa3gen.so")
    private val saoBinary: File get() = File(context.applicationInfo.nativeLibraryDir, "libsatgen.so")
    // Models may sit in the app's private files dir (in-app download) or its
    // external files dir (adb-pushed onto a release build); use whichever is complete.
    private fun dirWith(name: String, files: List<String>): File =
        listOfNotNull(File(context.filesDir, name), context.getExternalFilesDir(null)?.let { File(it, name) })
            .firstOrNull { d -> files.all { File(d, it).isFile } } ?: File(context.filesDir, name)
    private val sa3Dir: File get() = dirWith("sa3", SA3_FILES)
    private val modelsDir: File get() = dirWith("sao", listOf(DIT, T5, AE))

    /** The best engine whose binary and weights are all present, or null. */
    fun engine(): Engine? {
        if (sa3Binary.exists() && SA3_FILES.all { File(sa3Dir, it).exists() }) return Engine.SA3
        if (saoBinary.exists() && listOf(DIT, T5, AE).all { File(modelsDir, it).exists() }) {
            return Engine.SAO
        }
        return null
    }

    /** Longest clip the active engine makes in one call. */
    fun maxSeconds(): Double = if (engine() == Engine.SA3) SA3_MAX_SECONDS else SAO_MAX_SECONDS

    /** Why generation cannot run, or null when it can. */
    fun unavailableReason(): String? {
        if (engine() != null) return null
        if (!saoBinary.exists() && !sa3Binary.exists()) return "music engine not packaged in this build"
        val missing = SA3_FILES.firstOrNull { !File(sa3Dir, it).exists() }
        return if (missing != null) "model file missing: sa3/$missing" else "model file missing: sao/$DIT"
    }

    data class Result(val pcm: FloatArray, val elapsedMs: Long, val log: String)

    /**
     * Generates [seconds] of audio for [prompt] and returns it as mono float
     * PCM at [targetRate], trimmed to exactly [seconds] with short fades so it
     * loops without a click. Blocking: call from a background thread.
     */
    /**
     * [initPath], when given, is a stereo WAV the music is built around — a
     * sung or hummed melody. The model starts from it rather than from noise,
     * and [initNoise] sets how far it may wander: lower stays closer to the
     * tune. Measured on the dev phone: at 0.6 and 0.8 alike the sung note is
     * among the three loudest pitches on every beat of the result.
     */
    fun generate(
        prompt: String,
        seconds: Double,
        seed: Int,
        targetRate: Int,
        threads: Int,
        initPath: String? = null,
        initNoise: Double = 0.7,
        keepWavAt: File? = null,
    ): Result {
        unavailableReason()?.let { throw IllegalStateException(it) }

        val out = File(context.cacheDir, "texture-${System.currentTimeMillis()}.wav")
        val started = System.nanoTime()

        val engine = engine() ?: throw IllegalStateException("no music engine available")
        // Ask for a little more than needed so the trim below never runs short.
        val want = minOf(maxSeconds(), seconds + 0.25)

        val args = when (engine) {
            Engine.SA3 -> mutableListOf(
                sa3Binary.absolutePath,
                "--models-dir", sa3Dir.absolutePath,
                "--model", "small-music",
                // The DiT and decoder at Q5; the shared text encoder is only
                // published at Q8 and above, so its tier is named separately.
                "--encoding", "q5_k_m",
                "--t5-encoding", "q8_0",
                "--ae-encoding", "q5_k_m",
                "--steps", SA3_STEPS.toString(),
                "--threads", threads.toString(),
            ).apply {
                // With a source melody the output takes its length; asking for
                // a duration as well is rejected.
                if (initPath != null) {
                    addAll(listOf("--init", initPath, "--init-noise-level", String.format("%.2f", initNoise)))
                } else {
                    addAll(listOf("--duration", String.format("%.2f", want)))
                }
            }
            Engine.SAO -> {
                if (initPath != null) {
                    throw IllegalStateException("building around a melody needs Stable Audio 3")
                }
                mutableListOf(
                saoBinary.absolutePath,
                "--models-dir", modelsDir.absolutePath,
                "--model", "arc",
                "--encoding", "Q5_K_M",
                "--seconds", String.format("%.2f", want),
                )
            }
        }

        args += listOf(
            "--prompt", prompt,
            "--seed", seed.toString(),
            "--out", out.absolutePath,
        )

        val pb = ProcessBuilder(args)
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
            // V2 mixes the clip offline: keep the generator's own WAV when asked.
            if (keepWavAt != null) {
                keepWavAt.parentFile?.mkdirs()
                if (!out.renameTo(keepWavAt)) { out.copyTo(keepWavAt, overwrite = true); out.delete() }
            } else {
                out.delete()
            }
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
