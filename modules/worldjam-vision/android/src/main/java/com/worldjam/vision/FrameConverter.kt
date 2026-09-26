package com.worldjam.vision

import android.graphics.ImageFormat
import android.media.Image
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * YUV_420_888 camera image → letterboxed, upright, normalised RGB tensor.
 *
 * Runs synchronously inside the frame-processor callback so the camera buffer
 * is released the moment the callback returns (holding it was the root cause
 * of the old "maxImages (6)" camera crash). Everything is copied out: the three
 * planes into reusable byte arrays, then sampled through a precomputed lookup
 * table that bakes in rotation, mirroring and the letterbox, so the per-frame
 * cost is a few memcpys plus one pass over the 640×640 output.
 */
class FrameConverter(val inputSize: Int) {

    /** Direct buffer handed to the runtime; always holds the last converted frame. */
    val buffer: ByteBuffer = ByteBuffer.allocateDirect(inputSize * inputSize * 3 * 4).order(ByteOrder.nativeOrder())
    private val floats = FloatArray(inputSize * inputSize * 3)

    /** Second tensor in the other layout, filled only when a second model (depth) needs it. */
    val buffer2: ByteBuffer by lazy { ByteBuffer.allocateDirect(inputSize * inputSize * 3 * 4).order(ByteOrder.nativeOrder()) }
    private val floats2: FloatArray by lazy { FloatArray(inputSize * inputSize * 3) }

    private var yBytes = ByteArray(0)
    private var uBytes = ByteArray(0)
    private var vBytes = ByteArray(0)

    // Lookup tables, rebuilt only when the frame geometry changes.
    private var lutKey = ""
    private var yIndex = IntArray(0)
    private var uIndex = IntArray(0)
    private var vIndex = IntArray(0)
    var letterbox: Letterbox = Letterbox.forSource(inputSize, inputSize, inputSize)
        private set

    /** Returns false when the image is not something we can read. */
    fun convert(
        image: Image,
        rotationDegrees: Int,
        mirrored: Boolean,
        layout: InputLayout,
        secondary: InputLayout? = null,
    ): Boolean {
        if (image.format != ImageFormat.YUV_420_888 || image.planes.size < 3) return false
        val w = image.width
        val h = image.height
        val yP = image.planes[0]
        val uP = image.planes[1]
        val vP = image.planes[2]
        val rot = ((rotationDegrees % 360) + 360) % 360

        val key = "$w:$h:$rot:$mirrored:${yP.rowStride}:${uP.rowStride}:${uP.pixelStride}:${vP.rowStride}:${vP.pixelStride}"
        if (key != lutKey) buildLut(w, h, rot, mirrored, yP.rowStride, uP.rowStride, uP.pixelStride, vP.rowStride, vP.pixelStride, key)

        yBytes = copyPlane(yP.buffer, yBytes)
        uBytes = copyPlane(uP.buffer, uBytes)
        vBytes = copyPlane(vP.buffer, vBytes)

        val n = inputSize * inputSize
        val plane = n
        val yb = yBytes
        val ub = uBytes
        val vb = vBytes
        val second = secondary != null && secondary != layout
        val f2 = if (second) floats2 else floats
        for (p in 0 until n) {
            val yi = yIndex[p]
            var r: Float
            var g: Float
            var b: Float
            if (yi < 0) {
                // Letterbox padding: Ultralytics' grey (114/255).
                r = PAD; g = PAD; b = PAD
            } else {
                val y = (yb[yi].toInt() and 0xFF).toFloat()
                val u = (ub[uIndex[p]].toInt() and 0xFF) - 128f
                val v = (vb[vIndex[p]].toInt() and 0xFF) - 128f
                r = (y + 1.402f * v) * INV255
                g = (y - 0.344136f * u - 0.714136f * v) * INV255
                b = (y + 1.772f * u) * INV255
                if (r < 0f) r = 0f else if (r > 1f) r = 1f
                if (g < 0f) g = 0f else if (g > 1f) g = 1f
                if (b < 0f) b = 0f else if (b > 1f) b = 1f
            }
            if (layout == InputLayout.NHWC) {
                val o = p * 3
                floats[o] = r
                floats[o + 1] = g
                floats[o + 2] = b
                if (second) { f2[p] = r; f2[plane + p] = g; f2[2 * plane + p] = b }
            } else {
                floats[p] = r
                floats[plane + p] = g
                floats[2 * plane + p] = b
                if (second) { val o = p * 3; f2[o] = r; f2[o + 1] = g; f2[o + 2] = b }
            }
        }
        buffer.rewind()
        buffer.asFloatBuffer().put(floats)
        buffer.rewind()
        if (second) {
            buffer2.rewind()
            buffer2.asFloatBuffer().put(f2)
            buffer2.rewind()
        }
        return true
    }

    private fun copyPlane(src: ByteBuffer, dst: ByteArray): ByteArray {
        val s = src.duplicate()
        s.rewind()
        val out = if (dst.size >= s.remaining()) dst else ByteArray(s.remaining())
        s.get(out, 0, s.remaining())
        return out
    }

    private fun buildLut(
        w: Int, h: Int, rot: Int, mirrored: Boolean,
        yRow: Int, uRow: Int, uPix: Int, vRow: Int, vPix: Int, key: String,
    ) {
        // Upright dimensions after applying the rotation the image needs.
        val uprightW = if (rot == 90 || rot == 270) h else w
        val uprightH = if (rot == 90 || rot == 270) w else h
        val lb = Letterbox.forSource(inputSize, uprightW, uprightH)
        val n = inputSize * inputSize
        val yi = IntArray(n)
        val ui = IntArray(n)
        val vi = IntArray(n)
        for (oy in 0 until inputSize) {
            for (ox in 0 until inputSize) {
                val p = oy * inputSize + ox
                val fx = (ox + 0.5f - lb.padX) / lb.scale
                val fy = (oy + 0.5f - lb.padY) / lb.scale
                if (fx < 0f || fy < 0f || fx >= uprightW || fy >= uprightH) {
                    yi[p] = -1
                    continue
                }
                var ux = fx.toInt().coerceIn(0, uprightW - 1)
                val uy = fy.toInt().coerceIn(0, uprightH - 1)
                if (mirrored) ux = uprightW - 1 - ux
                // Upright (ux, uy) → sensor (sx, sy). rot is the clockwise
                // rotation that makes the sensor image upright.
                val sx: Int
                val sy: Int
                when (rot) {
                    90 -> { sx = uy; sy = h - 1 - ux }
                    180 -> { sx = w - 1 - ux; sy = h - 1 - uy }
                    270 -> { sx = w - 1 - uy; sy = ux }
                    else -> { sx = ux; sy = uy }
                }
                yi[p] = sy * yRow + sx
                ui[p] = (sy / 2) * uRow + (sx / 2) * uPix
                vi[p] = (sy / 2) * vRow + (sx / 2) * vPix
            }
        }
        yIndex = yi
        uIndex = ui
        vIndex = vi
        letterbox = lb
        lutKey = key
    }

    companion object {
        private const val INV255 = 1f / 255f
        private const val PAD = 114f / 255f
    }
}
