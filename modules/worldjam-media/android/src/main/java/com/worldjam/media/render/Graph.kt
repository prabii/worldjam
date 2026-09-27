package com.worldjam.media.render

import org.json.JSONArray
import org.json.JSONObject

/** Kotlin mirror of src/v2/contracts/renderGraph.ts, parsed defensively: bad values are clamped or dropped, never thrown. */
data class GraphSource(val id: String, val path: String, val trimStartSec: Double, val trimEndSec: Double?, val gainDb: Double)

data class GraphEvent(
    val timeSec: Double,
    val durationSec: Double?,
    val rate: Double,
    val gainDb: Double,
    val pan: Double?,
    val loop: Boolean,
    val fadeInSec: Double,
    val fadeOutSec: Double,
)

data class GainPoint(val timeSec: Double, val gainDb: Double)

data class GraphLayer(
    val id: String,
    val sourceId: String,
    val bus: String,
    val gainDb: Double,
    val pan: Double,
    val effects: List<JSONObject>,
    val automation: List<GainPoint>,
    val events: List<GraphEvent>,
)

data class GraphBus(val name: String, val gainDb: Double, val effects: List<JSONObject>)

data class GraphMaster(val gainDb: Double, val glue: JSONObject?, val limiterCeilingDb: Double, val fadeOutSec: Double)

data class RenderGraph(
    val sampleRate: Int,
    val durationSec: Double,
    val sources: List<GraphSource>,
    val layers: List<GraphLayer>,
    val buses: List<GraphBus>,
    val master: GraphMaster,
)

private fun JSONObject.num(key: String, def: Double): Double {
    val v = optDouble(key, def)
    return if (v.isNaN() || v.isInfinite()) def else v
}

private fun JSONObject.numOrNull(key: String): Double? {
    if (!has(key) || isNull(key)) return null
    val v = optDouble(key, Double.NaN)
    return if (v.isNaN() || v.isInfinite()) null else v
}

private fun JSONArray?.objects(): List<JSONObject> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

object GraphParser {
    const val MAX_DURATION_SEC = 600.0

    fun parse(json: String): RenderGraph {
        val o = JSONObject(json)
        val sr = o.optInt("sampleRate", 48000).coerceIn(8000, 96000)
        val duration = o.num("durationSec", 30.0).coerceIn(0.1, MAX_DURATION_SEC)
        val sources = o.optJSONArray("sources").objects().mapNotNull { s ->
            val id = s.optString("id", "")
            val path = s.optString("path", "")
            if (id.isEmpty() || path.isEmpty()) null
            else GraphSource(id, path, s.num("trimStartSec", 0.0).coerceAtLeast(0.0), s.numOrNull("trimEndSec"), s.num("gainDb", 0.0).coerceIn(-60.0, 24.0))
        }
        val ids = sources.map { it.id }.toSet()
        val layers = o.optJSONArray("layers").objects().mapNotNull { l ->
            val src = l.optString("sourceId", "")
            if (src !in ids) return@mapNotNull null // unknown source: skip the layer, keep the rest
            GraphLayer(
                id = l.optString("id", src),
                sourceId = src,
                bus = l.optString("bus", "FX"),
                gainDb = l.num("gainDb", 0.0).coerceIn(-60.0, 12.0),
                pan = l.num("pan", 0.0).coerceIn(-1.0, 1.0),
                effects = l.optJSONArray("effects").objects(),
                automation = l.optJSONArray("automation").objects()
                    .map { GainPoint(it.num("timeSec", 0.0).coerceAtLeast(0.0), it.num("gainDb", 0.0).coerceIn(-90.0, 12.0)) }
                    .sortedBy { it.timeSec },
                events = l.optJSONArray("events").objects().mapNotNull { e ->
                    val t = e.num("timeSec", -1.0)
                    if (t < 0 || t > duration) null
                    else GraphEvent(
                        timeSec = t,
                        durationSec = e.numOrNull("durationSec")?.takeIf { it > 0 },
                        rate = e.num("rate", 1.0).coerceIn(0.125, 8.0),
                        gainDb = e.num("gainDb", 0.0).coerceIn(-60.0, 12.0),
                        pan = e.numOrNull("pan")?.coerceIn(-1.0, 1.0),
                        loop = e.optBoolean("loop", false),
                        fadeInSec = e.num("fadeInSec", 0.002).coerceIn(0.0, 10.0),
                        fadeOutSec = e.num("fadeOutSec", 0.01).coerceIn(0.0, 10.0),
                    )
                }.sortedBy { it.timeSec },
            )
        }
        val buses = o.optJSONArray("buses").objects().map { b ->
            GraphBus(b.optString("name", "FX"), b.num("gainDb", 0.0).coerceIn(-60.0, 12.0), b.optJSONArray("effects").objects())
        }
        val m = o.optJSONObject("master") ?: JSONObject()
        val master = GraphMaster(
            gainDb = m.num("gainDb", 0.0).coerceIn(-30.0, 12.0),
            glue = m.optJSONObject("glue"),
            limiterCeilingDb = m.num("limiterCeilingDb", -1.0).coerceAtMost(-1.0),
            fadeOutSec = m.num("fadeOutSec", 0.0).coerceIn(0.0, 30.0),
        )
        return RenderGraph(sr, duration, sources, layers, buses, master)
    }

    /** RenderEffect JSON → processor. Unknown types return null and are ignored. */
    fun effect(e: JSONObject, sr: Int): StereoFx? = when (e.optString("type")) {
        "lowpass", "highpass" -> Biquad(e.optString("type"), sr, e.num("cutoffHz", 1000.0), e.num("q", 0.707))
        "peak" -> Biquad("peak", sr, e.num("freqHz", 1000.0), e.num("q", 1.0), e.num("gainDb", 0.0).coerceIn(-24.0, 24.0))
        "delay" -> Delay(sr, e.num("timeSec", 0.3), e.num("feedback", 0.3).toFloat(), e.num("mix", 0.25).coerceIn(0.0, 1.0).toFloat())
        "reverb" -> Reverb(sr, e.num("roomSize", 0.5), e.num("damping", 0.5), e.num("mix", 0.25).coerceIn(0.0, 1.0).toFloat())
        "saturation" -> Saturation(e.num("drive", 2.0), e.num("mix", 1.0).coerceIn(0.0, 1.0).toFloat())
        "compressor" -> compressor(e, sr)
        else -> null
    }

    fun compressor(e: JSONObject, sr: Int) = Compressor(
        sr,
        e.num("thresholdDb", -18.0).coerceIn(-60.0, 0.0),
        e.num("ratio", 3.0),
        e.num("attackMs", 10.0),
        e.num("releaseMs", 120.0),
        e.num("makeupDb", 0.0).coerceIn(0.0, 24.0),
    )
}
