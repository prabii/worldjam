package com.worldjam.vision

import android.content.Context
import android.media.AudioAttributes
import android.os.Bundle
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

/**
 * Android's on-device TextToSpeech, owned natively so read-out never waits on
 * the JS thread.
 *
 * Every utterance uses QUEUE_FLUSH: the newest meaningful sentence replaces
 * whatever was still pending, so there is never a backlog of stale objects.
 * An offline voice is preferred when the engine offers one.
 */
class TTSManager(context: Context, private val onLatency: (Double) -> Unit) : Speaker {

    private val tag = "WorldVision"
    @Volatile var ready = false
        private set
    @Volatile var error: String? = null
        private set
    @Volatile var engine: String? = null
        private set
    @Volatile var offlineVoice: Boolean? = null
        private set
    @Volatile var voiceName: String? = null
        private set

    private val requestedAt = ConcurrentHashMap<String, Long>()
    private var pendingBeforeReady: Pair<String, String>? = null

    private val tts: TextToSpeech = TextToSpeech(context.applicationContext) { status ->
        if (status == TextToSpeech.SUCCESS) onInit() else {
            error = "TextToSpeech init failed ($status)"
            Log.w(tag, error!!)
        }
    }

    private fun onInit() {
        try {
            engine = tts.defaultEngine
            val locale = Locale.getDefault().takeIf { tts.isLanguageAvailable(it) >= TextToSpeech.LANG_AVAILABLE } ?: Locale.US
            tts.language = locale
            // Prefer a voice that needs no network for this language.
            val voices = runCatching { tts.voices }.getOrNull().orEmpty()
            val offline = voices.filter {
                !it.isNetworkConnectionRequired && it.locale.language == locale.language &&
                    !it.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)
            }
            val current = runCatching { tts.voice }.getOrNull()
            val chosen = when {
                current != null && !current.isNetworkConnectionRequired -> current
                offline.isNotEmpty() -> offline.maxByOrNull { it.quality }
                else -> current
            }
            if (chosen != null && chosen != current) tts.voice = chosen
            voiceName = chosen?.name
            offlineVoice = chosen?.isNetworkConnectionRequired?.not()
            tts.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String) {
                    requestedAt.remove(utteranceId)?.let { onLatency((SystemClock.elapsedRealtime() - it).toDouble()) }
                }
                override fun onDone(utteranceId: String) {}
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String) { requestedAt.remove(utteranceId) }
            })
            ready = true
            Log.i(tag, "TTS ready: engine=$engine voice=$voiceName offline=$offlineVoice locale=$locale")
            pendingBeforeReady?.let { (text, id) -> speak(text, id) }
            pendingBeforeReady = null
        } catch (t: Throwable) {
            error = "TextToSpeech setup failed: ${t.message}"
            Log.w(tag, error!!)
        }
    }

    override fun speak(text: String, utteranceId: String) {
        if (!ready) {
            // Only the newest request survives until the engine is up.
            pendingBeforeReady = text to utteranceId
            return
        }
        requestedAt[utteranceId] = SystemClock.elapsedRealtime()
        Log.i(tag, "speak[$utteranceId]: $text")
        val result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, Bundle(), utteranceId)
        if (result != TextToSpeech.SUCCESS) Log.w(tag, "TTS speak failed ($result)")
    }

    override fun stop() {
        pendingBeforeReady = null
        if (ready) tts.stop()
    }

    fun shutdown() {
        runCatching { tts.stop() }
        runCatching { tts.shutdown() }
        ready = false
    }

    fun describe(): Map<String, Any?> = mapOf(
        "ready" to ready,
        "engine" to engine,
        "voice" to voiceName,
        "offlineVoice" to offlineVoice,
        "error" to error,
    )
}
