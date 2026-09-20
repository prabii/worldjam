package com.worldjam.audio

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

        OnDestroy { nativeStop() }
    }
}
