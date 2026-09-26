package com.worldjam.vision

/**
 * Every tunable in one place. Nothing in the UI or the pipeline hard-codes a
 * threshold; JS can override any field through `setConfig`.
 */
data class VisionConfig(
    /** Detections below this are discarded outright. */
    val minConfidence: Float = 0.50f,
    /** Reported in diagnostics; detections at or above it are "high confidence". */
    val highConfidence: Float = 0.70f,
    /** Inference rate cap. Preview keeps its own frame rate. */
    val targetFps: Int = 10,
    /** IoU above which two same-class boxes are the same object during NMS. */
    val nmsIou: Float = 0.45f,
    /** Detections kept per frame after NMS. */
    val maxDetections: Int = 20,

    /** Consecutive matched frames before a track counts as a real object. */
    val minimumStableFrames: Int = 3,
    /** How long a track survives without being seen before it is gone. */
    val trackGraceMs: Long = 800L,
    /** Minimum IoU for a detection to continue an existing track. */
    val trackIouMatch: Float = 0.25f,
    /** Fallback match on centre distance (normalised) for fast pans. */
    val trackCenterMatch: Float = 0.12f,
    /** Weight of the newest box when smoothing a track. */
    val trackSmoothing: Float = 0.6f,

    val weightConfidence: Float = 0.50f,
    val weightArea: Float = 0.35f,
    val weightCenter: Float = 0.15f,
    /** Area ratio at which areaScore saturates to 1. */
    val areaSaturation: Float = 0.5f,
    /** A challenger must beat the current primary by this much... */
    val primarySwitchMargin: Float = 0.08f,
    /** ...for this many consecutive frames before the primary changes. */
    val primarySwitchFrames: Int = 3,

    val directionLeftMax: Float = 0.33f,
    val directionRightMin: Float = 0.66f,

    /** Minimum gap between two automatic announcements. */
    val readoutCooldownMs: Long = 3000L,
    /** A new track with the same label as the last spoken one stays silent this long. */
    val sameLabelRepeatMs: Long = 8000L,
    /** Budget for an optional external (Gemma) formatter before falling back. */
    val externalFormatTimeoutMs: Long = 1200L,

    /** Capture mode: how often the depth model runs. */
    val depthIntervalMs: Long = 330L,
    /** yolo26n-depth outputs metric depth, so a smaller value is nearer. */
    val depthNearIsSmall: Boolean = true,
    /** A challenger must be this much (relative) nearer to become the capture target. yolo26n-depth values are
     *  compressed (measured 1.56–1.78 across a desk scene), so the margin is small. */
    val closestSwitchMargin: Float = 0.04f,
    /** ...for this many consecutive evaluations. */
    val closestSwitchFrames: Int = 2,
    /** Large surfaces that only become the capture target when nothing else is in view (or when tapped). */
    val surfaceLabels: Set<String> = setOf("table", "desk", "dining table", "bed", "couch"),

    /** QNN HTP performance profile. Sustained keeps thermals flat on long runs. */
    val qnnPerformanceMode: String = "sustained_high_performance",
    val preferQnn: Boolean = true,
    val allowGpu: Boolean = true,
) {
    fun toMap(): Map<String, Any> = mapOf(
        "minConfidence" to minConfidence,
        "highConfidence" to highConfidence,
        "targetFps" to targetFps,
        "nmsIou" to nmsIou,
        "maxDetections" to maxDetections,
        "minimumStableFrames" to minimumStableFrames,
        "trackGraceMs" to trackGraceMs,
        "trackIouMatch" to trackIouMatch,
        "trackCenterMatch" to trackCenterMatch,
        "trackSmoothing" to trackSmoothing,
        "weightConfidence" to weightConfidence,
        "weightArea" to weightArea,
        "weightCenter" to weightCenter,
        "areaSaturation" to areaSaturation,
        "primarySwitchMargin" to primarySwitchMargin,
        "primarySwitchFrames" to primarySwitchFrames,
        "directionLeftMax" to directionLeftMax,
        "directionRightMin" to directionRightMin,
        "readoutCooldownMs" to readoutCooldownMs,
        "sameLabelRepeatMs" to sameLabelRepeatMs,
        "externalFormatTimeoutMs" to externalFormatTimeoutMs,
        "depthIntervalMs" to depthIntervalMs,
        "depthNearIsSmall" to depthNearIsSmall,
        "closestSwitchMargin" to closestSwitchMargin,
        "closestSwitchFrames" to closestSwitchFrames,
        "qnnPerformanceMode" to qnnPerformanceMode,
        "preferQnn" to preferQnn,
        "allowGpu" to allowGpu,
    )

    /** Returns a copy with any recognised keys from [m] applied; unknown keys are ignored. */
    fun merge(m: Map<String, Any?>): VisionConfig {
        fun f(k: String, d: Float) = (m[k] as? Number)?.toFloat() ?: d
        fun i(k: String, d: Int) = (m[k] as? Number)?.toInt() ?: d
        fun l(k: String, d: Long) = (m[k] as? Number)?.toLong() ?: d
        fun b(k: String, d: Boolean) = (m[k] as? Boolean) ?: d
        fun s(k: String, d: String) = (m[k] as? String) ?: d
        return VisionConfig(
            minConfidence = f("minConfidence", minConfidence).coerceIn(0.05f, 0.99f),
            highConfidence = f("highConfidence", highConfidence).coerceIn(0.05f, 0.99f),
            targetFps = i("targetFps", targetFps).coerceIn(1, 30),
            nmsIou = f("nmsIou", nmsIou).coerceIn(0.1f, 0.95f),
            maxDetections = i("maxDetections", maxDetections).coerceIn(1, 100),
            minimumStableFrames = i("minimumStableFrames", minimumStableFrames).coerceIn(1, 30),
            trackGraceMs = l("trackGraceMs", trackGraceMs).coerceIn(0L, 10_000L),
            trackIouMatch = f("trackIouMatch", trackIouMatch).coerceIn(0.01f, 0.95f),
            trackCenterMatch = f("trackCenterMatch", trackCenterMatch).coerceIn(0f, 0.5f),
            trackSmoothing = f("trackSmoothing", trackSmoothing).coerceIn(0.05f, 1f),
            weightConfidence = f("weightConfidence", weightConfidence).coerceAtLeast(0f),
            weightArea = f("weightArea", weightArea).coerceAtLeast(0f),
            weightCenter = f("weightCenter", weightCenter).coerceAtLeast(0f),
            areaSaturation = f("areaSaturation", areaSaturation).coerceIn(0.01f, 1f),
            primarySwitchMargin = f("primarySwitchMargin", primarySwitchMargin).coerceIn(0f, 1f),
            primarySwitchFrames = i("primarySwitchFrames", primarySwitchFrames).coerceIn(1, 30),
            directionLeftMax = f("directionLeftMax", directionLeftMax).coerceIn(0f, 0.5f),
            directionRightMin = f("directionRightMin", directionRightMin).coerceIn(0.5f, 1f),
            readoutCooldownMs = l("readoutCooldownMs", readoutCooldownMs).coerceIn(0L, 60_000L),
            sameLabelRepeatMs = l("sameLabelRepeatMs", sameLabelRepeatMs).coerceIn(0L, 120_000L),
            externalFormatTimeoutMs = l("externalFormatTimeoutMs", externalFormatTimeoutMs).coerceIn(100L, 10_000L),
            depthIntervalMs = l("depthIntervalMs", depthIntervalMs).coerceIn(50L, 5_000L),
            depthNearIsSmall = b("depthNearIsSmall", depthNearIsSmall),
            closestSwitchMargin = f("closestSwitchMargin", closestSwitchMargin).coerceIn(0f, 1f),
            closestSwitchFrames = i("closestSwitchFrames", closestSwitchFrames).coerceIn(1, 30),
            qnnPerformanceMode = s("qnnPerformanceMode", qnnPerformanceMode),
            preferQnn = b("preferQnn", preferQnn),
            allowGpu = b("allowGpu", allowGpu),
        )
    }
}
