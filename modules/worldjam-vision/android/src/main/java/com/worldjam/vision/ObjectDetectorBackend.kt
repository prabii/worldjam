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
 * One model on one runtime: takes the letterboxed input tensor (in the layout
 * it declares) and returns its first relevant output, flattened. Detectors and
 * depth estimators are thin wrappers over these, so every model gets the same
 * QNN → CPU / GPU → CPU fallback behaviour.
 */
interface ModelRunner {
    val inputLayout: InputLayout
    val inputSize: Int
    /** Shape of the output this runner returns, e.g. [1, 88, 8400] or [1, 1, 640, 640]. */
    val outputShape: IntArray
    /** "HTP" | "GPU" | "CPU" */
    val target: String
    fun run(input: ByteBuffer): FloatArray
    fun close()
}

/**
 * ONNX Runtime, with the QNN execution provider (Hexagon HTP) or plain CPU.
 *
 * QNN models here are EPContext graphs: a precompiled context binary between
 * Quantize/Dequantize nodes. The CPU provider cannot execute an EPContext node,
 * so a QNN session that initialises IS running on the HTP. Seg-headed models
 * have two outputs; [outputName] picks the detection tensor.
 */
class OrtModelRunner(
    private val context: Context,
    path: String,
    private val useQnn: Boolean,
    performanceMode: String,
    outputName: String? = null,
) : ModelRunner {

    private val env: OrtEnvironment = OrtEnvironment.getEnvironment()
    private val session: OrtSession
    private val inputName: String
    private val outName: String
    private val inShape: LongArray
    private val output: FloatArray
    override val inputLayout: InputLayout
    override val inputSize: Int
    override val outputShape: IntArray
    override val target: String = if (useQnn) "HTP" else "CPU"

    init {
        if (useQnn) setAdspLibraryPath(context)
        session = OrtSession.SessionOptions().use { opts ->
            if (useQnn) {
                opts.addQnn(mapOf("backend_path" to "libQnnHtp.so", "htp_performance_mode" to performanceMode))
            } else {
                opts.setIntraOpNumThreads(4)
                opts.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            }
            env.createSession(path, opts)
        }
        try {
            inputName = session.inputNames.first()
            inShape = (session.inputInfo.getValue(inputName).info as TensorInfo).shape
            require(inShape.size == 4) { "Expected a 4-D input, got ${inShape.toList()}" }
            val nhwc = inShape[3] == 3L && inShape[1] != 3L
            inputLayout = if (nhwc) InputLayout.NHWC else InputLayout.NCHW
            inputSize = (if (nhwc) inShape[1] else inShape[2]).toInt()
            outName = outputName?.takeIf { it in session.outputNames } ?: session.outputNames.first()
            outputShape = (session.outputInfo.getValue(outName).info as TensorInfo).shape.map { it.toInt() }.toIntArray()
            output = FloatArray(outputShape.fold(1) { a, b -> a * b })
        } catch (t: Throwable) {
            runCatching { session.close() }
            throw t
        }
        Log.i("WorldVision", "ORT $target session: input=${inShape.toList()} $outName=${outputShape.toList()}")
    }

    override fun run(input: ByteBuffer): FloatArray {
        input.rewind()
        OnnxTensor.createTensor(env, input.asFloatBuffer(), inShape).use { tensor ->
            session.run(mapOf(inputName to tensor), setOf(outName)).use { results ->
                val fb = (results.get(0) as OnnxTensor).floatBuffer
                fb.get(output, 0, minOf(output.size, fb.remaining()))
            }
        }
        return output
    }

    override fun close() {
        runCatching { session.close() }
    }

    companion object {
        /** The DSP loader only searches vendor paths unless pointed at the app's extracted skel libraries. */
        fun setAdspLibraryPath(context: Context) {
            try {
                val nativeDir = context.applicationInfo.nativeLibraryDir
                android.system.Os.setenv(
                    "ADSP_LIBRARY_PATH",
                    "$nativeDir;/odm/lib/rfsa/adsp;/vendor/lib/rfsa/adsp;/system/lib/rfsa/adsp;/system/vendor/lib/rfsa/adsp;/dsp",
                    true,
                )
            } catch (t: Throwable) {
                Log.w("WorldVision", "Could not set ADSP_LIBRARY_PATH: ${t.message}")
            }
        }
    }
}

/** LiteRT (TensorFlow Lite): GPU delegate when supported, otherwise XNNPACK CPU. */
class LiteRtModelRunner(path: String, useGpu: Boolean) : ModelRunner {
    private val interpreter: Interpreter
    private var gpu: GpuDelegate? = null
    private val outBuffer: ByteBuffer
    private val output: FloatArray
    override val inputLayout: InputLayout
    override val inputSize: Int
    override val outputShape: IntArray
    override val target: String

    init {
        val options = Interpreter.Options()
        if (useGpu) {
            val compat = CompatibilityList()
            val ok = compat.isDelegateSupportedOnThisDevice
            compat.close()
            if (!ok) throw IllegalStateException("GPU delegate not supported on this device")
            gpu = GpuDelegate().also { options.addDelegate(it) }
            target = "GPU"
        } else {
            options.setNumThreads(Runtime.getRuntime().availableProcessors().coerceIn(1, 4))
            options.setUseXNNPACK(true)
            target = "CPU"
        }
        interpreter = Interpreter(File(path), options)
        val inShape = interpreter.getInputTensor(0).shape()
        val nchw = inShape.size == 4 && inShape[1] == 3
        inputLayout = if (nchw) InputLayout.NCHW else InputLayout.NHWC
        inputSize = if (nchw) inShape[2] else inShape[1]
        outputShape = interpreter.getOutputTensor(0).shape()
        val n = outputShape.fold(1) { a, b -> a * b }
        outBuffer = ByteBuffer.allocateDirect(n * 4).order(ByteOrder.nativeOrder())
        output = FloatArray(n)
        // A delegate that accepts the graph but cannot execute it fails here,
        // where the caller can still fall back.
        run(ByteBuffer.allocateDirect(inShape.fold(1) { a, b -> a * b } * 4).order(ByteOrder.nativeOrder()))
        Log.i("WorldVision", "LiteRT $target: input=${inShape.toList()} output=${outputShape.toList()}")
    }

    override fun run(input: ByteBuffer): FloatArray {
        input.rewind()
        outBuffer.rewind()
        interpreter.run(input, outBuffer)
        outBuffer.rewind()
        outBuffer.asFloatBuffer().get(output)
        return output
    }

    override fun close() {
        runCatching { interpreter.close() }
        runCatching { gpu?.close() }
    }
}

/**
 * A YOLO detector. Every backend returns the same channel-major
 * [1, 4 + classes (+ mask coefficients), anchors] tensor, so nothing downstream
 * knows which runtime or model produced it.
 */
class ObjectDetectorBackend(
    private val runner: ModelRunner,
    val model: ModelFile,
) {
    init {
        require(runner.outputShape.size == 3) { "Unexpected detector output ${runner.outputShape.toList()}" }
        require(runner.outputShape[1] >= 4 + model.numClasses) {
            "Output has ${runner.outputShape[1]} features, model declares ${model.numClasses} classes"
        }
    }

    val inputLayout: InputLayout get() = runner.inputLayout
    val outputFeatures: Int get() = runner.outputShape[1]
    val outputAnchors: Int get() = runner.outputShape[2]

    fun detect(input: ByteBuffer): FloatArray = runner.run(input)
    fun close() = runner.close()
    fun getBackendName(): String = if (model.format == "litert") "litert" else if (runner.target == "HTP") "qnn" else "onnx"
    fun getExecutionTarget(): String = runner.target
    fun getModelName(): String = model.name
    fun getInputSize(): Int = runner.inputSize
}

/** Monocular depth: one value per input pixel, used only to rank which object is closest. */
class DepthEstimator(private val runner: ModelRunner, val model: ModelFile) {
    val inputLayout: InputLayout get() = runner.inputLayout
    val target: String get() = runner.target
    val width: Int
    val height: Int

    init {
        val s = runner.outputShape
        require(s.size == 4 && (s[1] == 1 || s[3] == 1)) { "Unexpected depth output ${s.toList()}" }
        val channelLast = s[3] == 1 && s[1] != 1
        height = if (channelLast) s[1] else s[2]
        width = if (channelLast) s[2] else s[3]
    }

    fun estimate(input: ByteBuffer): FloatArray = runner.run(input)
    fun close() = runner.close()
}
