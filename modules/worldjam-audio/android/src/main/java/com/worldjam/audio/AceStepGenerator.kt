package com.worldjam.audio

import android.content.Context
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * ACE-Step 1.5 "AI production": the phone runs acestep.cpp (packaged as
 * libacesynth.so and started as its own process, like the texture engine) in
 * cover-nofsq mode. The source is the mix rendered from the user's own
 * captures, so the model re-produces THEIR sounds in the requested style while
 * keeping the structure, timing and timbre of the source. Always instrumental:
 * the user's own voice is mixed in afterwards, never generated.
 *
 * Models live in <files>/acestep or <external files>/acestep (the in-app
 * downloader writes the former; adb can push to the latter on dev phones).
 */
class AceStepGenerator(private val context: Context) {

    companion object {
        const val EMBEDDING = "Qwen3-Embedding-0.6B-Q8_0.gguf"
        const val DIT = "acestep-v15-turbo-Q4_K_M.gguf"
        const val VAE = "vae-BF16.gguf"
        val REQUIRED = listOf(EMBEDDING, DIT, VAE)
        private const val TIMEOUT_S = 900L
        private val STEP = Regex("""\[DiT] Step (\d+)/(\d+)""")
    }

    @Volatile private var running: Process? = null

    private val binary: File get() = File(context.applicationInfo.nativeLibraryDir, "libacesynth.so")

    private fun candidateDirs(): List<File> = listOfNotNull(
        File(context.filesDir, "acestep"),
        context.getExternalFilesDir(null)?.let { File(it, "acestep") },
    )

    /** The first directory holding every required model, or null. */
    fun modelsDir(): File? = candidateDirs().firstOrNull { dir -> REQUIRED.all { File(dir, it).isFile } }

    /** Null when generation can run, otherwise why not (shown in the UI). */
    fun unavailableReason(): String? {
        if (!binary.exists()) return "AI production engine not packaged in this build"
        if (modelsDir() == null) {
            val dir = candidateDirs().first()
            val missing = REQUIRED.filterNot { File(dir, it).isFile }
            return "model files missing: ${missing.joinToString()}"
        }
        return null
    }

    data class Result(val path: String, val elapsedMs: Long, val log: String)

    /**
     * Blocking; call from a background thread. [requestJson] is the AceRequest
     * (task_type, caption, bpm, keyscale, duration, seed, inference_steps,
     * audio_cover_strength...) built in TypeScript; [srcPath] is a WAV of the
     * captures mix. [onProgress] receives 0..1 and a stage name.
     */
    fun generate(
        requestJson: String,
        srcPath: String,
        outDir: String,
        threads: Int,
        onProgress: (Double, String) -> Unit,
    ): Result {
        unavailableReason()?.let { throw IllegalStateException(it) }
        val models = modelsDir()!!
        val dir = File(outDir).apply { mkdirs() }
        val base = "ace-${System.currentTimeMillis()}"
        val request = File(dir, "$base.json").apply { writeText(requestJson) }
        dir.listFiles { f -> f.name.startsWith(base) && f.name.endsWith(".wav") }?.forEach { it.delete() }

        val started = System.nanoTime()
        val pb = ProcessBuilder(
            binary.absolutePath,
            "--models", models.absolutePath,
            "--request", request.absolutePath,
            "--src-audio", srcPath,
            // cover-nofsq keeps closest to the source when the reference is the same file.
            "--ref-audio", srcPath,
        )
        pb.environment()["GGML_N_THREADS"] = threads.toString()
        pb.environment()["OMP_NUM_THREADS"] = threads.toString()
        pb.redirectErrorStream(true)
        pb.directory(dir)

        onProgress(0.02, "loading")
        val process = pb.start()
        running = process
        val logBuf = StringBuilder()
        // Drained on its own thread: a full pipe would otherwise block the child.
        val reader = Thread {
            process.inputStream.bufferedReader().forEachLine { line ->
                synchronized(logBuf) { logBuf.append(line).append('\n') }
                when {
                    line.startsWith("[Encode-Src]") -> onProgress(0.12, "listening")
                    STEP.containsMatchIn(line) -> {
                        val m = STEP.find(line)!!
                        val step = m.groupValues[1].toDouble()
                        val total = m.groupValues[2].toDouble().coerceAtLeast(1.0)
                        onProgress(0.15 + 0.7 * step / total, "producing")
                    }
                    line.contains("VAE", ignoreCase = false) && line.contains("decod", ignoreCase = true) ->
                        onProgress(0.88, "mastering")
                }
            }
        }.apply { name = "worldjam-acestep-log"; start() }

        try {
            if (!process.waitFor(TIMEOUT_S, TimeUnit.SECONDS)) {
                process.destroyForcibly()
                throw IllegalStateException("AI production timed out after ${TIMEOUT_S}s")
            }
            reader.join(2000)
        } finally {
            running = null
            request.delete()
        }
        val log = synchronized(logBuf) { logBuf.toString() }
        val elapsedMs = (System.nanoTime() - started) / 1_000_000
        val out = dir.listFiles { f -> f.name.startsWith(base) && f.name.endsWith(".wav") }?.maxByOrNull { it.length() }
        if (process.exitValue() != 0 || out == null || out.length() < 1024) {
            throw IllegalStateException("AI production failed (exit ${process.exitValue()}): ${log.takeLast(400)}")
        }
        onProgress(1.0, "done")
        return Result(out.absolutePath, elapsedMs, log.takeLast(1200))
    }

    /** Stops a running generation; the pending generate() call then throws. */
    fun cancel() {
        running?.destroyForcibly()
    }
}
