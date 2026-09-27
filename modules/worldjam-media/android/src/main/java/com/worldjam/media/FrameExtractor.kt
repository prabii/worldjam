package com.worldjam.media

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max

/**
 * Picks the most representative frame of a video for its card: several evenly
 * spaced candidates are scored by detail (luma variance + edge energy) and the
 * sharpest, least blank one wins — the first frame is often black or blurred.
 */
object FrameExtractor {

    data class Result(val width: Int, val height: Int, val timeMs: Long)

    fun extract(videoPath: String, outPath: String, maxSize: Int, candidates: Int, quality: Int): Result {
        val mmr = MediaMetadataRetriever()
        try {
            mmr.setDataSource(videoPath)
            val durMs = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            val n = candidates.coerceIn(1, 12)
            var best: Bitmap? = null
            var bestScore = -1.0
            var bestTime = 0L
            for (i in 0 until n) {
                // Avoid the very first/last frames (fades, fingers on the lens).
                val tMs = if (durMs <= 0) 0L else durMs * (i + 1) / (n + 1)
                val frame = mmr.getScaledFrameAtTime(tMs * 1000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, maxSize, maxSize) ?: continue
                val s = score(frame)
                if (s > bestScore) {
                    best?.recycle()
                    best = frame; bestScore = s; bestTime = tMs
                } else {
                    frame.recycle()
                }
            }
            val bmp = best ?: mmr.frameAtTime ?: throw IllegalStateException("video has no decodable frame")
            File(outPath).parentFile?.mkdirs()
            FileOutputStream(outPath).use { bmp.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(40, 100), it) }
            val r = Result(bmp.width, bmp.height, bestTime)
            bmp.recycle()
            return r
        } finally {
            mmr.release()
        }
    }

    /** Detail score on a coarse grid: luma variance plus mean horizontal/vertical gradient. */
    private fun score(b: Bitmap): Double {
        val step = max(1, minOf(b.width, b.height) / 48)
        var sum = 0.0; var sumSq = 0.0; var edges = 0.0; var count = 0
        var y = step
        while (y < b.height - step) {
            var x = step
            while (x < b.width - step) {
                val l = luma(b.getPixel(x, y))
                sum += l; sumSq += l * l; count++
                edges += kotlin.math.abs(l - luma(b.getPixel(x + step, y))) + kotlin.math.abs(l - luma(b.getPixel(x, y + step)))
                x += step
            }
            y += step
        }
        if (count == 0) return 0.0
        val mean = sum / count
        val variance = sumSq / count - mean * mean
        return variance + 4 * edges / count
    }

    private fun luma(c: Int): Double = 0.299 * ((c shr 16) and 0xff) + 0.587 * ((c shr 8) and 0xff) + 0.114 * (c and 0xff)
}
