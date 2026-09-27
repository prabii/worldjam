package com.worldjam.media

import android.util.Base64
import com.worldjam.media.render.RenderRunner
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest

class DecodeOptions : Record {
    @Field val sampleRate: Int = 48000
    @Field val mono: Boolean = true
    @Field val maxSeconds: Double? = null
}

class FrameOptions : Record {
    @Field val maxSize: Int = 512
    @Field val candidates: Int = 5
    @Field val quality: Int = 85
}

class ListenOptions : Record {
    @Field val language: String? = null
    @Field val preferOffline: Boolean = true
    @Field val partialResults: Boolean = true
}

/**
 * WorldJam V2 media services (modules/worldjam-media/src/index.ts is the
 * contract). AsyncFunctions run off the JS thread; speech runs on the main
 * queue as SpeechRecognizer requires.
 */
class WorldJamMediaModule : Module() {

    private var speech: Speech? = null

    private fun speechOrCreate(): Speech {
        val ctx = appContext.reactContext ?: throw IllegalStateException("no app context")
        return speech ?: Speech(ctx) { name, body -> sendEvent(name, body) }.also { speech = it }
    }

    override fun definition() = ModuleDefinition {
        Name("WorldJamMedia")

        Events("onRenderProgress", "onSpeechPartial", "onSpeechResult", "onSpeechError", "onSpeechState")

        AsyncFunction("probe") { path: String ->
            val p = MediaDecoder.probe(path)
            mapOf(
                "durationMs" to p.durationMs.toDouble(),
                "hasAudio" to p.hasAudio,
                "hasVideo" to p.hasVideo,
                "width" to p.width,
                "height" to p.height,
                "sampleRate" to p.sampleRate,
                "channels" to p.channels,
                "mimeType" to p.mimeType,
                "sizeBytes" to p.sizeBytes.toDouble(),
            )
        }

        AsyncFunction("decodeToWav") { input: String, output: String, options: DecodeOptions ->
            var pcm = MediaDecoder.decode(input, options.maxSeconds)
            if (options.mono) pcm = Wav.toMono(pcm)
            pcm = Wav.resample(pcm, options.sampleRate)
            Wav.write16(File(output), pcm)
            mapOf("durationSec" to pcm.durationSec, "sampleRate" to pcm.sampleRate, "channels" to pcm.channels, "frames" to pcm.frames)
        }

        AsyncFunction("extractFrame") { video: String, output: String, options: FrameOptions ->
            val r = FrameExtractor.extract(video, output, options.maxSize, options.candidates, options.quality)
            mapOf("width" to r.width, "height" to r.height, "timeMs" to r.timeMs.toDouble())
        }

        AsyncFunction("wavPeaks") { path: String, buckets: Int ->
            Wav.peaks(Wav.read(File(path)), buckets).toList()
        }

        AsyncFunction("normalizeWav") { path: String, targetDb: Double, maxGainDb: Double ->
            val src = File(path)
            val pcm = Wav.read(src)
            val gainDb = Wav.normalize(pcm, targetDb, maxGainDb)
            val tmp = File(src.parentFile, src.name + ".norm")
            Wav.write16(tmp, pcm)
            if (!tmp.renameTo(src)) { src.delete(); tmp.renameTo(src) }
            gainDb
        }

        AsyncFunction("readPcm") { path: String, maxSeconds: Double, sampleRate: Int ->
            var pcm = Wav.resample(Wav.toMono(Wav.read(File(path))), sampleRate)
            val maxFrames = (maxSeconds * sampleRate).toInt()
            if (maxSeconds > 0 && pcm.frames > maxFrames) pcm = Pcm(pcm.data.copyOf(maxFrames), sampleRate, 1)
            val bytes = ByteBuffer.allocate(pcm.data.size * 4).order(ByteOrder.LITTLE_ENDIAN)
            for (x in pcm.data) bytes.putFloat(x)
            mapOf("base64" to Base64.encodeToString(bytes.array(), Base64.NO_WRAP), "sampleRate" to sampleRate, "frames" to pcm.frames)
        }

        AsyncFunction("sha256") { path: String ->
            val md = MessageDigest.getInstance("SHA-256")
            FileInputStream(path).use { input ->
                val buf = ByteArray(1 shl 20)
                while (true) {
                    val n = input.read(buf)
                    if (n <= 0) break
                    md.update(buf, 0, n)
                }
            }
            md.digest().joinToString("") { "%02x".format(it) }
        }

        AsyncFunction("renderMix") { graphJson: String, outputPath: String, peakBuckets: Int ->
            val r = RenderRunner.run(graphJson, outputPath, peakBuckets) { p ->
                sendEvent("onRenderProgress", mapOf("progress" to p))
            }
            mapOf(
                "path" to r.path,
                "durationSec" to r.durationSec,
                "peakDb" to r.peakDb,
                "rmsDb" to r.rmsDb,
                "renderMs" to r.renderMs.toDouble(),
                "peaks" to r.peaks.toList(),
            )
        }

        AsyncFunction("speechAvailability") {
            speechOrCreate().availability()
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("startListening") { options: ListenOptions ->
            speechOrCreate().start(options.language, options.preferOffline, options.partialResults)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("stopListening") {
            speech?.stop()
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("cancelListening") {
            speech?.cancel()
        }.runOnQueue(Queues.MAIN)

        OnDestroy {
            speech?.cancel()
            speech = null
        }
    }
}
