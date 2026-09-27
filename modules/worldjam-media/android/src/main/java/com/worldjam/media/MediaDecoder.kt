package com.worldjam.media

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import java.io.File
import java.nio.ByteOrder

/** Decodes the first audio track of any container Android can read (MP4 video, M4A, WAV, MP3…) to PCM. */
object MediaDecoder {

    data class Probe(
        val durationMs: Long,
        val hasAudio: Boolean,
        val hasVideo: Boolean,
        val width: Int?,
        val height: Int?,
        val sampleRate: Int?,
        val channels: Int?,
        val mimeType: String?,
        val sizeBytes: Long,
    )

    fun probe(path: String): Probe {
        val ex = MediaExtractor()
        var hasAudio = false
        var hasVideo = false
        var sr: Int? = null
        var ch: Int? = null
        var w: Int? = null
        var h: Int? = null
        var durUs = 0L
        try {
            ex.setDataSource(path)
            for (i in 0 until ex.trackCount) {
                val f = ex.getTrackFormat(i)
                val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
                if (f.containsKey(MediaFormat.KEY_DURATION)) durUs = maxOf(durUs, f.getLong(MediaFormat.KEY_DURATION))
                if (mime.startsWith("audio/") && !hasAudio) {
                    hasAudio = true
                    sr = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    ch = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                } else if (mime.startsWith("video/") && !hasVideo) {
                    hasVideo = true
                    w = f.getInteger(MediaFormat.KEY_WIDTH)
                    h = f.getInteger(MediaFormat.KEY_HEIGHT)
                }
            }
        } finally {
            ex.release()
        }
        var mimeType: String? = null
        var rotation = 0
        runCatching {
            MediaMetadataRetriever().apply {
                setDataSource(path)
                mimeType = extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE)
                rotation = extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
                if (durUs == 0L) durUs = (extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) * 1000
                release()
            }
        }
        // Report displayed size: a portrait phone video is stored landscape + rotation.
        if (rotation == 90 || rotation == 270) {
            val t = w; w = h; h = t
        }
        return Probe(durUs / 1000, hasAudio, hasVideo, w, h, sr, ch, mimeType, File(path).length())
    }

    /** Decodes to interleaved float PCM at the track's own rate/channels. */
    fun decode(path: String, maxSeconds: Double?): Pcm {
        val ex = MediaExtractor()
        ex.setDataSource(path)
        var track = -1
        for (i in 0 until ex.trackCount) {
            if (ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true) {
                track = i; break
            }
        }
        if (track < 0) {
            ex.release()
            throw IllegalStateException("no audio track")
        }
        ex.selectTrack(track)
        val format = ex.getTrackFormat(track)
        val mime = format.getString(MediaFormat.KEY_MIME)!!
        var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        val codec = MediaCodec.createDecoderByType(mime)
        codec.configure(format, null, null, 0)
        codec.start()

        val out = FloatArrayBuilder()
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var outputDone = false
        var pcmFloat = false
        val limitUs = maxSeconds?.let { (it * 1_000_000).toLong() }
        try {
            while (!outputDone) {
                if (!inputDone) {
                    val inIdx = codec.dequeueInputBuffer(10_000)
                    if (inIdx >= 0) {
                        val buf = codec.getInputBuffer(inIdx)!!
                        val size = ex.readSampleData(buf, 0)
                        val t = ex.sampleTime
                        if (size < 0 || (limitUs != null && t > limitUs)) {
                            codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(inIdx, 0, size, t, 0)
                            ex.advance()
                        }
                    }
                }
                val outIdx = codec.dequeueOutputBuffer(info, 10_000)
                when {
                    outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val f = codec.outputFormat
                        rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        pcmFloat = f.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
                            f.getInteger(MediaFormat.KEY_PCM_ENCODING) == android.media.AudioFormat.ENCODING_PCM_FLOAT
                    }
                    outIdx >= 0 -> {
                        val buf = codec.getOutputBuffer(outIdx)!!.order(ByteOrder.LITTLE_ENDIAN)
                        buf.position(info.offset)
                        buf.limit(info.offset + info.size)
                        if (pcmFloat) {
                            val fb = buf.asFloatBuffer()
                            while (fb.hasRemaining()) out.add(fb.get())
                        } else {
                            val sb = buf.asShortBuffer()
                            while (sb.hasRemaining()) out.add(sb.get() / 32768f)
                        }
                        codec.releaseOutputBuffer(outIdx, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                    }
                }
            }
        } finally {
            codec.stop()
            codec.release()
            ex.release()
        }
        var pcm = Pcm(out.toArray(), rate, channels)
        if (maxSeconds != null && pcm.durationSec > maxSeconds) {
            val keep = (maxSeconds * rate).toInt() * channels
            pcm = Pcm(pcm.data.copyOf(keep), rate, channels)
        }
        return pcm
    }

    /** Growable float buffer without boxing. */
    private class FloatArrayBuilder {
        private var data = FloatArray(1 shl 16)
        private var size = 0
        fun add(v: Float) {
            if (size == data.size) data = data.copyOf(data.size * 2)
            data[size++] = v
        }
        fun toArray(): FloatArray = data.copyOf(size)
    }
}
