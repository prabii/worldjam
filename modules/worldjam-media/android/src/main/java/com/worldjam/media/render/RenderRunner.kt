package com.worldjam.media.render

import com.worldjam.media.Pcm
import com.worldjam.media.Wav
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.roundToInt

/** Parses a graph, loads its sources once, renders, and streams a 16-bit stereo WAV. */
object RenderRunner {

    class Output(val path: String, val durationSec: Double, val peakDb: Double, val rmsDb: Double, val renderMs: Long, val peaks: DoubleArray)

    fun loadSource(s: GraphSource, sr: Int): FloatArray? {
        val file = File(s.path)
        if (!file.isFile) return null
        val pcm = Wav.resample(Wav.toMono(Wav.read(file)), sr)
        val from = (s.trimStartSec * sr).roundToInt().coerceIn(0, pcm.frames)
        val to = (s.trimEndSec?.let { (it * sr).roundToInt() } ?: pcm.frames).coerceIn(from, pcm.frames)
        if (to - from < 2) return null
        val g = dbToGain(s.gainDb)
        return FloatArray(to - from) { pcm.data[from + it] * g }
    }

    fun run(graphJson: String, outputPath: String, peakBuckets: Int, onProgress: (Double) -> Unit): Output {
        val started = System.nanoTime()
        val graph = GraphParser.parse(graphJson)
        val sources = HashMap<String, FloatArray>()
        for (s in graph.sources) loadSource(s, graph.sampleRate)?.let { sources[s.id] = it }
        val mixer = Mixer(graph, sources)

        val out = File(outputPath)
        out.parentFile?.mkdirs()
        val totalFrames = (graph.durationSec * graph.sampleRate).toLong()
        val stats: Mixer.Stats
        BufferedOutputStream(FileOutputStream(out), 1 shl 16).use { stream ->
            stream.write(ByteArray(44)) // header patched below, once the frame count is final
            val bytes = ByteBuffer.allocate(Mixer.BLOCK * 4).order(ByteOrder.LITTLE_ENDIAN)
            stats = mixer.render(peakBuckets, onProgress) { l, r, n ->
                bytes.clear()
                for (i in 0 until n) {
                    bytes.putShort((l[i].coerceIn(-1f, 1f) * 32767f).roundToInt().toShort())
                    bytes.putShort((r[i].coerceIn(-1f, 1f) * 32767f).roundToInt().toShort())
                }
                stream.write(bytes.array(), 0, n * 4)
            }
        }
        writeHeader(out, graph.sampleRate, 2, stats.frames)
        check(stats.frames == totalFrames || totalFrames == 0L) { "rendered ${stats.frames} of $totalFrames frames" }
        return Output(
            out.absolutePath,
            stats.frames.toDouble() / graph.sampleRate,
            stats.peakDb,
            stats.rmsDb,
            (System.nanoTime() - started) / 1_000_000,
            stats.peaks,
        )
    }

    private fun writeHeader(file: File, rate: Int, channels: Int, frames: Long) {
        val dataBytes = (frames * channels * 2).toInt()
        val b = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        b.put("RIFF".toByteArray()); b.putInt(36 + dataBytes); b.put("WAVE".toByteArray())
        b.put("fmt ".toByteArray()); b.putInt(16); b.putShort(1); b.putShort(channels.toShort())
        b.putInt(rate); b.putInt(rate * channels * 2); b.putShort((channels * 2).toShort()); b.putShort(16)
        b.put("data".toByteArray()); b.putInt(dataBytes)
        RandomAccessFile(file, "rw").use { it.seek(0); it.write(b.array()) }
    }

    /** Convenience for tests: render to memory via a temp file. */
    fun renderToPcm(graphJson: String, tmp: File): Pcm {
        run(graphJson, tmp.absolutePath, 16) {}
        return Wav.read(tmp)
    }
}
