package com.worldjam.media

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/**
 * Voice prompts via the phone's on-device recognizer. Must be created and
 * driven on the main looper (SpeechRecognizer's rule); the module guarantees
 * that by running these calls on the main queue.
 */
class Speech(private val context: Context, private val emit: (String, Map<String, Any?>) -> Unit) {

    private var recognizer: SpeechRecognizer? = null

    fun availability(): Map<String, Boolean> {
        val onDevice = Build.VERSION.SDK_INT >= 33 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
        return mapOf("available" to (onDevice || SpeechRecognizer.isRecognitionAvailable(context)), "onDevice" to onDevice)
    }

    fun start(language: String?, preferOffline: Boolean, partial: Boolean) {
        cancel()
        val onDevice = Build.VERSION.SDK_INT >= 33 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
        val r = if (onDevice) SpeechRecognizer.createOnDeviceSpeechRecognizer(context) else SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = emit("onSpeechState", mapOf("state" to "listening"))
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) = emit("onSpeechState", mapOf("state" to "listening", "rmsDb" to rmsdB.toDouble()))
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() = emit("onSpeechState", mapOf("state" to "processing"))
            override fun onError(error: Int) {
                emit("onSpeechError", mapOf("code" to error, "message" to message(error)))
                emit("onSpeechState", mapOf("state" to "idle"))
            }
            override fun onResults(results: Bundle?) {
                emit("onSpeechResult", payload(results, true))
                emit("onSpeechState", mapOf("state" to "idle"))
            }
            override fun onPartialResults(partialResults: Bundle?) = emit("onSpeechPartial", payload(partialResults, false))
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, language ?: "en-US")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, partial)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, preferOffline)
        }
        r.startListening(intent)
    }

    fun stop() {
        recognizer?.stopListening()
    }

    fun cancel() {
        recognizer?.cancel()
        recognizer?.destroy()
        recognizer = null
    }

    private fun payload(b: Bundle?, final: Boolean): Map<String, Any?> {
        val list = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: arrayListOf()
        return mapOf("text" to (list.firstOrNull() ?: ""), "alternatives" to list, "isFinal" to final)
    }

    private fun message(code: Int): String = when (code) {
        SpeechRecognizer.ERROR_NO_MATCH -> "Didn't catch that"
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech heard"
        SpeechRecognizer.ERROR_AUDIO -> "Microphone busy"
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission needed"
        SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE, SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED -> "Speech language pack not installed"
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognizer busy"
        else -> "Speech recognition error $code"
    }
}
