package com.worldjam.audio

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Bridge between React Native and the native Oboe engine.
 *
 * Design rule from the HLD: JS never touches the real-time path. A trigger call
 * from JS only enqueues into a lock-free ring; the audio thread does the rest.
 * Every function here is synchronous so a tap costs one JSI hop, not a round
 * trip through the async bridge.
 */
class WorldJamAudioModule : Module() {

    private external fun nativeStart(): Boolean
    private external fun nativeStop()
    private external fun nativeTrigger(slot: Int, gain: Float, pan: Float): Long
    private external fun nativeTriggerAt(slot: Int, gain: Float, pan: Float, frame: Long)
    private external fun nativeStopAllVoices()
    private external fun nativeLoadSample(slot: Int, pcm: FloatArray, gain: Float): Boolean
    private external fun nativeClearSlot(slot: Int)
    private external fun nativeStartRecording(): Boolean
    private external fun nativeStopRecording(): FloatArray
    private external fun nativeCurrentFrame(): Long
    private external fun nativeLatencyMillis(): Double
    private external fun nativeSampleRate(): Int
    private external fun nativeBufferFrames(): Int
    private external fun nativeSetMasterGain(gain: Float)
    private external fun nativeSetMetronome(on: Boolean, bpm: Double)

    /**
     * Created lazily: constructing it eagerly would load ARCore classes on
     * every device, including ones that do not have it.
     */
    private var ar: ArSessionManager? = null

    private var texture: TextureGenerator? = null

    private fun textureGen(): TextureGenerator? {
        val ctx = appContext.reactContext ?: return null
        return texture ?: TextureGenerator(ctx).also { texture = it }
    }

    private fun arManager(): ArSessionManager {
        return ar ?: ArSessionManager(appContext.reactContext!!).also { ar = it }
    }

    companion object {
        init {
            System.loadLibrary("worldjam_audio")
        }
    }

    override fun definition() = ModuleDefinition {
        Name("WorldJamAudio")

        Function("start") { nativeStart() }
        Function("stop") { nativeStop() }

        Function("trigger") { slot: Int, gain: Float, pan: Float ->
            nativeTrigger(slot, gain, pan)
        }

        Function("triggerAt") { slot: Int, gain: Float, pan: Float, frame: Double ->
            nativeTriggerAt(slot, gain, pan, frame.toLong())
        }

        Function("stopAllVoices") { nativeStopAllVoices() }

        // PCM arrives as a plain JS number array of mono float samples.
        Function("loadSample") { slot: Int, pcm: DoubleArray, gain: Float ->
            val floats = FloatArray(pcm.size) { pcm[it].toFloat() }
            nativeLoadSample(slot, floats, gain)
        }

        Function("clearSlot") { slot: Int -> nativeClearSlot(slot) }

        Function("startRecording") { nativeStartRecording() }

        Function("stopRecording") {
            val pcm = nativeStopRecording()
            // Returned as a list so JS can analyse it without another bridge hop.
            pcm.map { it.toDouble() }
        }

        Function("currentFrame") { nativeCurrentFrame().toDouble() }
        Function("latencyMillis") { nativeLatencyMillis() }
        Function("sampleRate") { nativeSampleRate() }
        Function("bufferFrames") { nativeBufferFrames() }
        Function("setMasterGain") { gain: Float -> nativeSetMasterGain(gain) }
        Function("setMetronome") { on: Boolean, bpm: Double -> nativeSetMetronome(on, bpm) }

        // --- Stable Audio Open Small: AI texture layer ----------------------
        // Runs as a separate process for ~18 s, so this is the one async call
        // in the module. It never touches the real-time path: the finished
        // audio is loaded into a slot exactly like a captured sample.

        /** Null when generation can run, otherwise the reason it cannot. */
        Function("textureUnavailableReason") {
            val gen = textureGen()
            if (gen == null) "no app context" else gen.unavailableReason()
        }

        AsyncFunction("generateTexture") { prompt: String, seconds: Double, seed: Int, slot: Int, promise: Promise ->
            val gen = textureGen()
            if (gen == null) {
                promise.resolve(mapOf("ok" to false, "error" to "no app context"))
                return@AsyncFunction
            }
            Thread {
                try {
                    val r = gen.generate(prompt, seconds, seed, nativeSampleRate(), 6)
                    val loaded = nativeLoadSample(slot, r.pcm, 1f)
                    promise.resolve(
                        mapOf(
                            "ok" to loaded,
                            "elapsedMs" to r.elapsedMs.toDouble(),
                            "frames" to r.pcm.size,
                            "log" to r.log,
                        ),
                    )
                } catch (e: Throwable) {
                    promise.resolve(mapOf("ok" to false, "error" to (e.message ?: e.toString())))
                }
            }.apply { name = "worldjam-texture" }.start()
        }

        // --- ARCore: world-anchored sound objects ---------------------------
        // Every function degrades rather than throws, so a device without
        // ARCore keeps the full audio experience and simply loses the 3D
        // layer (HLD v2 §2: AR is removable).

        Function("arSupported") {
            arManager().isSupported()
        }

        Function("arStart") {
            arManager().start(appContext.activityProvider?.currentActivity)
        }

        Function("arResume") { arManager().resume() }
        Function("arPause") { arManager().pause() }
        Function("arStop") { arManager().stop() }

        Function("arIsTracking") { ar?.tracking ?: false }
        Function("arLastError") { ar?.lastError }

        Function("arSetDisplayGeometry") { rotation: Int, width: Int, height: Int ->
            ar?.setDisplayGeometry(rotation, width, height)
        }

        /** Pins an object to the real-world point under a screen tap. */
        Function("arCreateAnchor") { id: String, screenX: Float, screenY: Float ->
            ar?.createAnchorAt(id, screenX, screenY) ?: false
        }

        Function("arRemoveAnchor") { id: String -> ar?.removeAnchor(id) }

        /**
         * Screen positions for every anchor this frame, as a flat array of
         * [id, x, y, distance, visible] — flat to keep the per-frame bridge
         * cost low, since JS polls this at display rate.
         */
        Function("arProjectAnchors") { width: Int, height: Int ->
            ar?.projectAnchors(width, height) ?: emptyList<Any>()
        }

        /** [tx, ty, tz, qx, qy, qz, qw] — drives head-tracked spatial audio. */
        Function("arCameraPose") { ar?.cameraPose() ?: emptyList<Double>() }

        OnDestroy {
            ar?.stop()
            ar = null
            nativeStop()
        }
    }
}
