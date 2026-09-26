package com.worldjam.vision

import android.content.Context
import android.util.Log
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.TensorInfo
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.gpu.CompatibilityList
import org.tensorflow.lite.gpu.GpuDelegate
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * One interface, several runtimes. Every backend consumes the same letterboxed
 * tensor (in the layout it declares) and returns the same [1, 84, 8400] raw
 * output, so nothing downstream knows which one ran.
 */
interface ObjectDetectorBackend {
    fun initialize()
    /** Runs one inference on [input] (rewound, in [inputLayout]); returns the flat output. */
    fun detect(input: ByteBuffer): FloatArray
    fun close()
    fun getBackendName(): String      // "qnn" | "litert"
    fun getExecutionTarget(): String  // "HTP" | "GPU" | "CPU"
    fun getModelName(): String
    fun getInputSize(): Int
    val inputLayout: InputLayout
    val outputFeatures: Int
    val outputAnchors: Int
}

/**
 * YOLO26n on the Hexagon NPU through ONNX Runtime's QNN execution provider.
 *
 * The bundled model is an EPContext graph: a precompiled QNN context binary
 * wrapped in Quantize/Dequantize nodes. The CPU execution provider cannot run
 * an EPContext node at all, so if session creation succeeds the graph IS on the
 * HTP — there is no silent CPU path to mistake for NPU acceleration. The small
 * Q/DQ nodes around it may run on CPU, which is expected.
 */
class QNNObjectDetectorBackend(
    private val context: Context,
    private val model: ModelFile,
    private val performanceMode: String,
) : ObjectDetectorBackend {

    private val tag = "WorldVision"
    private var env: OrtEnvironment? = null
    private var session: OrtSession? = null
    private var inputName = ""
    private var outputName = ""
    private var inputShape = longArrayOf(1, 640, 640, 3)
    private var output = FloatArray(0)
    override var inputLayout = InputLayout.NHWC
        private set
    override var outputFeatures = 84
        private set
    override var outputAnchors = 8400
        private set

    override fun initialize() {
        // The DSP loader only searches fixed vendor paths unless told where the
        // app's skel libraries are; legacy packaging extracts them there.
        try {
            val nativeDir = context.applicationInfo.nativeLibraryDir
            android.system.Os.setenv(
                "ADSP_LIBRARY_PATH",
                "$nativeDir;/odm/lib/rfsa/adsp;/vendor/lib/rfsa/adsp;/system/lib/rfsa/adsp;/system/vendor/lib/rfsa/adsp;/dsp",
                true,
            )
        } catch (t: Throwable) {
            Log.w(tag, "Could not set ADSP_LIBRARY_PATH: ${t.message}")
        }

        val e = OrtEnvironment.getEnvironment()
        env = e
        val s = OrtSession.SessionOptions().use { opts ->
            opts.addQnn(
                mapOf(
                    "backend_path" to "libQnnHtp.so",
                    "htp_performance_mode" to performanceMode,
                ),
            )
            e.createSession(model.path, opts)
        }
        session = s
        inputName = s.inputNames.first()
        outputName = s.outputNames.first()
        inputShape = (s.inputInfo.getValue(inputName).info as TensorInfo).shape
        inputLayout = if (inputShape.size == 4 && inputShape[3] == 3L) InputLayout.NHWC else InputLayout.NCHW
        val outShape = (s.outputInfo.getValue(outputName).info as TensorInfo).shape
        require(outShape.size == 3) { "Unexpected QNN output shape ${outShape.toList()}" }
        outputFeatures = outShape[1].toInt()
        outputAnchors = outShape[2].toInt()
        output = FloatArray(outputFeatures * outputAnchors)
        Log.i(tag, "QNN HTP session ready: input=${inputShape.toList()} output=${outShape.toList()} mode=$performanceMode")
    }

    override fun detect(input: ByteBuffer): FloatArray {
        val e = env ?: error("QNN backend not initialised")
        val s = session ?: error("QNN backend not initialised")
        input.rewind()
        OnnxTensor.createTensor(e, input.asFloatBuffer(), inputShape).use { tensor ->
            s.run(mapOf(inputName to tensor)).use { results ->
                val out = results.get(0) as OnnxTensor
                val fb = out.floatBuffer
                fb.get(output, 0, minOf(output.size, fb.remaining()))
            }
        }
        return output
    }

    override fun close() {
        runCatching { session?.close() }
        session = null
    }

    override fun getBackendName() = "qnn"
    override fun getExecutionTarget() = "HTP"
    override fun getModelName() = model.name
    override fun getInputSize() = model.inputSize
}

/**
 * YOLO26n on LiteRT (TensorFlow Lite), GPU delegate when the device supports
 * it, otherwise multi-threaded CPU (XNNPACK). Same LiteRT artifact version the
 * app already ships for react-native-fast-tflite.
 */
class LiteRTObjectDetectorBackend(
    private val model: ModelFile,
    private val useGpu: Boolean,
) : ObjectDetectorBackend {

    private val tag = "WorldVision"
    private var interpreter: Interpreter? = null
    private var gpu: GpuDelegate? = null
    private var outBuffer: ByteBuffer = ByteBuffer.allocateDirect(4)
    private var output = FloatArray(0)
    private var target = "CPU"
    override var inputLayout = InputLayout.NCHW
        private set
    override var outputFeatures = 84
        private set
    override var outputAnchors = 8400
        private set

    override fun initialize() {
        val options = Interpreter.Options()
        if (useGpu) {
            val compat = CompatibilityList()
            if (!compat.isDelegateSupportedOnThisDevice) {
                compat.close()
                throw IllegalStateException("GPU delegate not supported on this device")
            }
            compat.close()
            val delegate = GpuDelegate()
            gpu = delegate
            options.addDelegate(delegate)
            target = "GPU"
        } else {
            options.setNumThreads(Runtime.getRuntime().availableProcessors().coerceIn(1, 4))
            options.setUseXNNPACK(true)
            target = "CPU"
        }
        val interp = Interpreter(File(model.path), options)
        interpreter = interp
        val inShape = interp.getInputTensor(0).shape()
        inputLayout = if (inShape.size == 4 && inShape[1] == 3) InputLayout.NCHW else InputLayout.NHWC
        val outShape = interp.getOutputTensor(0).shape()
        require(outShape.size == 3) { "Unexpected LiteRT output shape ${outShape.toList()}" }
        outputFeatures = outShape[1]
        outputAnchors = outShape[2]
        outBuffer = ByteBuffer.allocateDirect(outputFeatures * outputAnchors * 4).order(ByteOrder.nativeOrder())
        output = FloatArray(outputFeatures * outputAnchors)

        // One warm-up run: a delegate that accepts the graph but cannot execute
        // it fails here, where the caller can still fall back.
        val probe = ByteBuffer.allocateDirect(inShape.fold(1) { a, b -> a * b } * 4).order(ByteOrder.nativeOrder())
        detect(probe)
        Log.i(tag, "LiteRT $target ready: input=${inShape.toList()} output=${outShape.toList()}")
    }

    override fun detect(input: ByteBuffer): FloatArray {
        val interp = interpreter ?: error("LiteRT backend not initialised")
        input.rewind()
        outBuffer.rewind()
        interp.run(input, outBuffer)
        outBuffer.rewind()
        outBuffer.asFloatBuffer().get(output)
        return output
    }

    override fun close() {
        runCatching { interpreter?.close() }
        runCatching { gpu?.close() }
        interpreter = null
        gpu = null
    }

    override fun getBackendName() = "litert"
    override fun getExecutionTarget() = target
    override fun getModelName() = model.name
    override fun getInputSize() = model.inputSize
}
