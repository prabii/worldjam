package com.worldjam.vision

import android.content.Context
import android.os.Build
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.security.MessageDigest

/** A model on disk, verified, with everything a runtime and decoder need. */
data class ModelFile(
    val id: String,
    val role: String,           // "detector" | "depth"
    val name: String,
    val format: String,         // "onnx-qnn" | "onnx-cpu" | "litert"
    val path: String,
    val inputSize: Int,
    val version: String,
    val sha256: String,
    val verified: Boolean,
    val source: String,
    val labels: List<String>,
    val numClasses: Int,
    /** When non-null, detections with other labels are dropped (used to strip people from COCO). */
    val allowedLabels: Set<String>?,
    val outputName: String?,
)

/** A manifest entry, before its file is extracted. */
data class ModelInfo(
    val id: String,
    val role: String,
    val name: String,
    val file: String,
    val format: String,
    val inputSize: Int,
    val version: String,
    val sha256: String,
    val source: String,
    val labelsFile: String?,
    val numClasses: Int,
    val allowedLabels: Set<String>?,
    val outputName: String?,
    val priority: Int,
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
 * Finds, verifies and caches models listed in assets/models/model_manifest.json.
 *
 * Models ship inside the APK (offline from first launch). On first use each is
 * copied to app-private storage, SHA-256 checked, and atomically renamed into a
 * versioned directory, so a half-written or tampered file is never loaded. A
 * developer override in `files/vision-models/override/` is used only when its
 * hash matches the manifest. No network access.
 */
class ModelManager(private val context: Context) {

    private val tag = "WorldVision"
    private val baseDir = File(context.filesDir, "vision-models")
    private val labelCache = HashMap<String, List<String>>()

    val entries: List<ModelInfo> by lazy {
        val root = JSONObject(context.assets.open("models/model_manifest.json").bufferedReader().readText())
        val arr = root.getJSONArray("models")
        (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            val allowed = o.optJSONArray("allowedLabels")?.let { a -> (0 until a.length()).map { a.getString(it) }.toSet() }
            ModelInfo(
                id = o.getString("id"),
                role = o.optString("role", "detector"),
                name = o.optString("name", "YOLO"),
                file = o.getString("file"),
                format = o.getString("format"),
                inputSize = o.optInt("inputSize", 640),
                version = o.optString("version", "unknown"),
                sha256 = o.getString("sha256").lowercase(),
                source = o.optString("source", ""),
                labelsFile = o.optString("labels", "").ifEmpty { null },
                numClasses = o.optInt("numClasses", 0),
                allowedLabels = allowed,
                outputName = o.optString("outputName", "").ifEmpty { null },
                priority = o.optInt("priority", 100),
            )
        }.sortedBy { it.priority }
    }

    fun detectors(): List<ModelInfo> = entries.filter { it.role == "detector" }
    fun depthModels(): List<ModelInfo> = entries.filter { it.role == "depth" }

    fun labels(file: String): List<String> = labelCache.getOrPut(file) {
        context.assets.open("models/$file").bufferedReader().readLines().map { it.trim() }.filter { it.isNotEmpty() }
    }

    /** Returns the verified on-disk model, or throws with the reason. */
    fun resolve(e: ModelInfo): ModelFile {
        val labels = e.labelsFile?.let { labels(it) } ?: emptyList()
        if (e.role == "detector") {
            require(labels.size == e.numClasses) { "${e.id}: ${labels.size} labels but numClasses=${e.numClasses}" }
        }

        val override = File(File(baseDir, "override"), e.file)
        if (override.exists()) {
            val hash = Checksums.sha256(override)
            if (hash == e.sha256) {
                Log.i(tag, "Using developer override for ${e.id} (hash verified)")
                return e.toModelFile(override, labels)
            }
            Log.w(tag, "Ignoring override ${override.path}: sha256 $hash != manifest ${e.sha256}")
        }

        val dir = File(baseDir, e.version).apply { mkdirs() }
        val target = File(dir, e.file)
        if (target.exists()) {
            if (Checksums.sha256(target) == e.sha256) return e.toModelFile(target, labels)
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
        return e.toModelFile(target, labels)
    }

    private fun ModelInfo.toModelFile(f: File, labels: List<String>) = ModelFile(
        id, role, name, format, f.absolutePath, inputSize, version, sha256, true, source,
        labels, numClasses, allowedLabels, outputName,
    )
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

    /** The bundled QNN models are compiled for v81 only. */
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
