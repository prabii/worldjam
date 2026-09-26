package com.worldjam.vision

import android.content.Context
import android.os.Build
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/** A model on disk, ready to hand to a runtime. */
data class ModelFile(
    val id: String,
    val name: String,
    val format: String,
    val path: String,
    val inputSize: Int,
    val version: String,
    val sha256: String,
    val verified: Boolean,
    val source: String,
)

object Checksums {
    fun sha256(input: InputStream): String {
        val md = MessageDigest.getInstance("SHA-256")
        val buf = ByteArray(1 shl 16)
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            md.update(buf, 0, n)
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    fun sha256(file: File): String = file.inputStream().use { sha256(it) }
}

/**
 * Finds, verifies and caches detector models.
 *
 * Models ship inside the APK (offline from first launch). On first use each is
 * copied to app-private storage, SHA-256 checked against model_manifest.json,
 * and atomically renamed into a versioned directory, so a half-written or
 * tampered file is never loaded. A developer can drop a replacement into
 * `files/vision-models/override/` with `adb run-as`; it is used only if its
 * hash matches the manifest, otherwise reported and ignored.
 *
 * No network: Phase 1 is offline-only.
 */
class ModelManager(private val context: Context) {

    private data class Entry(
        val id: String, val name: String, val file: String, val format: String,
        val inputSize: Int, val version: String, val sha256: String, val source: String,
    )

    private val tag = "WorldVision"
    private val baseDir = File(context.filesDir, "vision-models")

    val labels: List<String> by lazy {
        context.assets.open("models/$labelsFile").bufferedReader().readLines().map { it.trim() }.filter { it.isNotEmpty() }
    }

    private var labelsFile = "coco80.txt"

    private val entries: List<Entry> by lazy {
        val json = context.assets.open("models/model_manifest.json").bufferedReader().readText()
        val root = JSONObject(json)
        labelsFile = root.optString("labels", "coco80.txt")
        val arr = root.getJSONArray("models")
        (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            Entry(
                id = o.getString("id"),
                name = o.optString("name", "YOLO26n"),
                file = o.getString("file"),
                format = o.getString("format"),
                inputSize = o.optInt("inputSize", 640),
                version = o.optString("version", "unknown"),
                sha256 = o.getString("sha256").lowercase(),
                source = o.optString("source", ""),
            )
        }
    }

    /** Returns the verified on-disk model for [format] ("onnx-qnn" or "litert"), or throws with the reason. */
    fun resolve(format: String): ModelFile {
        val e = entries.firstOrNull { it.format == format }
            ?: throw IllegalStateException("No $format model in model_manifest.json")
        // Touch labels so the manifest's label file name is honoured.
        labels

        val override = File(File(baseDir, "override"), e.file)
        if (override.exists()) {
            val hash = Checksums.sha256(override)
            if (hash == e.sha256) {
                Log.i(tag, "Using developer override for ${e.id} (hash verified)")
                return e.toModelFile(override, true)
            }
            Log.w(tag, "Ignoring override ${override.path}: sha256 $hash != manifest ${e.sha256}")
        }

        val dir = File(baseDir, e.version).apply { mkdirs() }
        val target = File(dir, e.file)
        if (target.exists()) {
            if (Checksums.sha256(target) == e.sha256) return e.toModelFile(target, true)
            Log.w(tag, "Cached ${target.name} failed verification; re-extracting")
            target.delete()
        }

        val tmp = File(dir, "${e.file}.part")
        context.assets.open("models/${e.file}").use { input ->
            tmp.outputStream().use { out -> input.copyTo(out, 1 shl 16) }
        }
        val hash = Checksums.sha256(tmp)
        if (hash != e.sha256) {
            tmp.delete()
            throw IllegalStateException("Bundled ${e.file} checksum mismatch ($hash)")
        }
        if (!tmp.renameTo(target)) {
            tmp.delete()
            throw IllegalStateException("Could not move ${e.file} into place")
        }
        return e.toModelFile(target, true)
    }

    private fun Entry.toModelFile(f: File, verified: Boolean) =
        ModelFile(id, name, format, f.absolutePath, inputSize, version, sha256, verified, source)
}

/** What this phone can accelerate on. */
object DeviceCapabilityManager {
    /** Hexagon HTP architecture by Snapdragon SoC model. */
    private val htpBySoc = mapOf(
        "SM8850" to 81, // Snapdragon 8 Elite Gen 5
        "SM8750" to 79, // Snapdragon 8 Elite
        "SM8650" to 75, // Snapdragon 8 Gen 3
        "SM8550" to 73, // Snapdragon 8 Gen 2
    )

    val socModel: String
        get() = if (Build.VERSION.SDK_INT >= 31) Build.SOC_MODEL ?: "unknown" else "unknown"

    val htpArch: Int? get() = htpBySoc[socModel.uppercase()]

    /** The bundled QNN model is compiled for v81 only. */
    fun supportsBundledQnn(): Boolean =
        htpArch == 81 && (File("/vendor/lib64/libcdsprpc.so").exists() || File("/system/vendor/lib64/libcdsprpc.so").exists())

    fun describe(): Map<String, Any?> = mapOf(
        "socModel" to socModel,
        "htpArch" to htpArch,
        "cdsprpc" to File("/vendor/lib64/libcdsprpc.so").exists(),
        "sdk" to Build.VERSION.SDK_INT,
        "device" to Build.MODEL,
    )
}
