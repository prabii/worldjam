package com.worldjam.vision

import android.content.Context
import android.util.Log
import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.FrameProcessorPluginRegistry
import com.mrousavy.camera.frameprocessors.VisionCameraProxy
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The frame-processor plugin VisionCamera calls for every camera frame. It does
 * no work itself beyond handing the frame to the service, which copies what it
 * needs synchronously and returns — the frame is never held.
 */
class WorldVisionFrameProcessorPlugin(
    @Suppress("UNUSED_PARAMETER") proxy: VisionCameraProxy,
    @Suppress("UNUSED_PARAMETER") options: Map<String, Any>?,
) : FrameProcessorPlugin() {
    override fun callback(frame: Frame, params: Map<String, Any>?): Any? {
        WorldVisionRuntime.service?.onFrame(frame)
        return null
    }
}

/** Process-wide owner of the pipeline, shared by the module and the plugin. */
object WorldVisionRuntime {
    const val PLUGIN_NAME = "worldVisionDetect"
    private const val PREFS = "worldjam.vision"
    private const val KEY_READOUT = "worldjam.audioObjectGuide.enabled"

    @Volatile var service: ObjectDetectorService? = null
    private var registered = false

    @Synchronized
    fun registerPlugin() {
        if (registered) return
        FrameProcessorPluginRegistry.addFrameProcessorPlugin(PLUGIN_NAME) { proxy, options ->
            WorldVisionFrameProcessorPlugin(proxy, options)
        }
        registered = true
    }

    fun readoutPreference(ctx: Context): Boolean =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_READOUT, true)

    fun saveReadoutPreference(ctx: Context, enabled: Boolean) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_READOUT, enabled).apply()
    }
}

/**
 * JS API for the vision subsystem. Synchronous where the call is a flag flip,
 * so the speaker button costs one JSI hop.
 */
class WorldVisionModule : Module() {

    private val tag = "WorldVision"

    private val context: Context
        get() = requireNotNull(appContext.reactContext) { "React context not available" }.applicationContext

    private fun service(): ObjectDetectorService {
        WorldVisionRuntime.service?.let { return it }
        synchronized(WorldVisionRuntime) {
            WorldVisionRuntime.service?.let { return it }
            val s = ObjectDetectorService(context, object : ObjectDetectorService.Emitter {
                override fun onVisionState(state: Map<String, Any?>) = emit("onVisionState", state)
                override fun onReadout(readout: Map<String, Any?>) = emit("onReadout", readout)
                override fun onFormatRequest(request: Map<String, Any?>) = emit("onFormatRequest", request)
                override fun onStatus(status: Map<String, Any?>) = emit("onStatus", status)
            })
            s.readout.readoutEnabled = WorldVisionRuntime.readoutPreference(context)
            WorldVisionRuntime.service = s
            return s
        }
    }

    private fun emit(name: String, body: Map<String, Any?>) {
        try {
            sendEvent(name, body)
        } catch (t: Throwable) {
            Log.w(tag, "sendEvent($name) failed: ${t.message}")
        }
    }

    override fun definition() = ModuleDefinition {
        Name("WorldVision")

        Events("onVisionState", "onReadout", "onFormatRequest", "onStatus")

        OnCreate {
            WorldVisionRuntime.registerPlugin()
        }

        OnDestroy {
            WorldVisionRuntime.service?.shutdown()
            WorldVisionRuntime.service = null
        }

        /** Registers the frame plugin (idempotent) and starts loading a model. */
        Function("initialize") {
            WorldVisionRuntime.registerPlugin()
            val s = service()
            s.initializeAsync()
            s.statusMap()
        }

        Function("startDetection") {
            WorldVisionRuntime.registerPlugin()
            service().start()
        }

        Function("stopDetection") {
            WorldVisionRuntime.service?.stop()
        }

        Function("setReadoutEnabled") { enabled: Boolean ->
            service().readout.readoutEnabled = enabled
            WorldVisionRuntime.saveReadoutPreference(context, enabled)
            enabled
        }

        Function("isReadoutEnabled") {
            service().readout.readoutEnabled
        }

        /** Speaks LatestReadout.text (or "No object detected yet."). No inference, no Gemma. */
        Function("repeatLatestReadout") {
            service().readout.repeatLatest()
        }

        Function("getLatestReadout") {
            service().readout.store.latest?.toMap()
        }

        Function("getBackend") {
            service().statusMap()
        }

        Function("getModelInfo") {
            val s = service()
            mapOf(
                "model" to s.backend?.getModelName(),
                "backend" to s.backend?.getBackendName(),
                "execution" to s.backend?.getExecutionTarget(),
                "inputSize" to s.backend?.getInputSize(),
                "inputLayout" to s.backend?.inputLayout?.name,
                "outputShape" to listOf(1, s.backend?.outputFeatures, s.backend?.outputAnchors),
            )
        }

        Function("getDiagnostics") {
            service().diagnosticsMap()
        }

        Function("resetDiagnostics") {
            service().diagnostics.reset()
        }

        Function("setConfig") { patch: Map<String, Any?> ->
            val s = service()
            s.config = s.config.merge(patch)
            s.config.toMap()
        }

        Function("getConfig") {
            service().config.toMap()
        }

        /** Optional external (Gemma) phrasing; off by default. */
        Function("setExternalFormatting") { enabled: Boolean ->
            service().readout.externalFormatting = enabled
            enabled
        }

        Function("completeReadout") { requestId: Double, text: String? ->
            service().completeExternal(requestId.toLong(), text)
        }
    }
}
