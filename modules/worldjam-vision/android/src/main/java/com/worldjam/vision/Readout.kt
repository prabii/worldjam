package com.worldjam.vision

/** Turns a primary-object event into one short spoken sentence. */
interface ReadoutFormatter {
    fun format(event: PrimaryVisionEvent): String
}

/**
 * The deterministic formatter — always available, never needs a model.
 *
 *   "Laptop detected."
 *   "Laptop on your right."
 *   "Laptop detected. Two other objects are visible."
 *
 * Never mentions confidence, boxes, track ids or model details.
 */
class DirectReadoutFormatter : ReadoutFormatter {
    override fun format(event: PrimaryVisionEvent): String {
        val name = LabelNames.spoken(event.primaryObject.label)
        val head = when (event.direction) {
            Direction.LEFT -> "$name on your left."
            Direction.RIGHT -> "$name on your right."
            Direction.CENTER -> "$name detected."
        }
        val others = event.objectCount - 1
        return when {
            others <= 0 -> head
            others == 1 -> "$head One other object is visible."
            else -> "$head ${LabelNames.countWord(others)} other objects are visible."
        }
    }
}

/** Whatever actually makes sound. [TTSManager] in the app, a fake in tests. */
interface Speaker {
    /** Speaks [text], replacing anything still pending. */
    fun speak(text: String, utteranceId: String)
    fun stop()
}

/** The single source of truth the speaker button reads from. Thread-safe. */
class LatestReadoutStore {
    @Volatile
    var latest: LatestReadout? = null
        private set

    @Synchronized
    fun set(readout: LatestReadout) {
        latest = readout
    }

    @Synchronized
    fun clear() {
        latest = null
    }
}

/**
 * Decides when to speak.
 *
 * Duplicate suppression is identity-based first: the same tracked object staying
 * primary never produces another automatic announcement, no matter how long it
 * stays in view. Only a CHANGE of primary (which the resolver only makes after
 * temporal stability) is a new announcement. The cooldown is a secondary guard
 * that defers — not drops — an announcement that arrives too soon after the
 * previous one.
 *
 * Toggle OFF still stores every readout, so the speaker button always has
 * something current to repeat.
 */
class ReadoutManager(
    private val formatter: ReadoutFormatter,
    private val speaker: Speaker,
    val store: LatestReadoutStore,
    private val clock: () -> Long,
    private val listener: Listener? = null,
) {
    interface Listener {
        /** The latest readout changed (spoken tells whether it was announced). */
        fun onReadout(readout: LatestReadout, spoken: Boolean)
        /** An external formatter (Gemma) should phrase this; answer via [completeExternal]. */
        fun onFormatRequest(requestId: Long, event: PrimaryVisionEvent, fallbackText: String)
    }

    @Volatile
    var readoutEnabled: Boolean = true
        set(value) {
            field = value
            if (!value) {
                pending = null
                pendingExternal = null
                speaker.stop()
            }
        }

    @Volatile
    var externalFormatting: Boolean = false

    private var lastPrimaryId: String? = null
    private var lastSpokenAt: Long = Long.MIN_VALUE / 2
    private var lastSpokenLabel: String? = null
    private var utteranceCounter = 0L
    private var requestCounter = 0L

    private data class Pending(val trackId: String, val text: String)
    private data class PendingExternal(val requestId: Long, val trackId: String, val fallbackText: String)

    private var pending: Pending? = null
    private var pendingExternal: PendingExternal? = null

    var spokenCount: Int = 0
        private set

    /** Called once per processed frame with the resolver's result (null = nothing stable in view). */
    @Synchronized
    fun onPrimary(event: PrimaryVisionEvent?, config: VisionConfig) {
        if (event == null) return
        val now = clock()
        val id = event.primaryObject.trackId
        val text = formatter.format(event)

        if (id == lastPrimaryId) {
            // Same object. Keep the stored text current (count/direction can
            // change) without announcing it again.
            val cur = store.latest
            if (cur != null && cur.objectId == id && cur.text != text && pendingExternal == null) {
                store.set(readoutFrom(event, text, now))
                listener?.onReadout(store.latest!!, spoken = false)
            }
            // A deferred announcement goes out once the cooldown has passed.
            val p = pending
            if (p != null && p.trackId == id && readoutEnabled && now - lastSpokenAt >= config.readoutCooldownMs) {
                pending = null
                speakNow(store.latest?.text ?: p.text, event.primaryObject.label, now)
                store.latest?.let { listener?.onReadout(it, spoken = true) }
            }
            return
        }

        // A new primary object.
        lastPrimaryId = id
        pending = null
        pendingExternal = null
        val readout = readoutFrom(event, text, now)
        store.set(readout)

        val sameLabelRecently = event.primaryObject.label == lastSpokenLabel &&
            now - lastSpokenAt < config.sameLabelRepeatMs
        if (!readoutEnabled || sameLabelRecently) {
            listener?.onReadout(readout, spoken = false)
            return
        }

        if (externalFormatting && listener != null) {
            val rid = ++requestCounter
            pendingExternal = PendingExternal(rid, id, text)
            listener.onReadout(readout, spoken = false)
            listener.onFormatRequest(rid, event, text)
            return
        }

        announce(id, text, event.primaryObject.label, now, config)
    }

    /**
     * Delivers an external formatter's result. Returns false when the request is
     * stale (the primary changed, or the fallback already fired).
     */
    @Synchronized
    fun completeExternal(requestId: Long, formatted: String?, config: VisionConfig): Boolean {
        val pe = pendingExternal ?: return false
        if (pe.requestId != requestId || pe.trackId != lastPrimaryId) return false
        pendingExternal = null
        val now = clock()
        val text = formatted?.trim()?.takeIf { it.isNotEmpty() } ?: pe.fallbackText
        val cur = store.latest
        if (cur != null && cur.objectId == pe.trackId) {
            store.set(cur.copy(text = text, timestamp = now))
        }
        if (readoutEnabled) announce(pe.trackId, text, cur?.label ?: "", now, config)
        return true
    }

    /** The external formatter ran out of time: speak the deterministic text. */
    fun onExternalTimeout(requestId: Long, config: VisionConfig) {
        completeExternal(requestId, null, config)
    }

    /**
     * The speaker button. Never runs inference, never calls a formatter, works
     * with the toggle off.
     */
    @Synchronized
    fun repeatLatest(): String {
        val text = store.latest?.text ?: NO_OBJECT_TEXT
        val now = clock()
        utteranceCounter++
        speaker.speak(text, "repeat-$utteranceCounter")
        // Counts as speech for the cooldown so an automatic readout does not
        // talk over the user's explicit request.
        lastSpokenAt = now
        return text
    }

    @Synchronized
    fun reset() {
        lastPrimaryId = null
        pending = null
        pendingExternal = null
    }

    private fun announce(trackId: String, text: String, label: String, now: Long, config: VisionConfig) {
        if (now - lastSpokenAt >= config.readoutCooldownMs) {
            speakNow(text, label, now)
            store.latest?.let { listener?.onReadout(it, spoken = true) }
        } else {
            pending = Pending(trackId, text)
            store.latest?.let { listener?.onReadout(it, spoken = false) }
        }
    }

    private fun speakNow(text: String, label: String, now: Long) {
        utteranceCounter++
        speaker.speak(text, "readout-$utteranceCounter")
        lastSpokenAt = now
        lastSpokenLabel = label
        spokenCount++
    }

    private fun readoutFrom(e: PrimaryVisionEvent, text: String, now: Long) = LatestReadout(
        objectId = e.primaryObject.trackId,
        label = e.primaryObject.label,
        confidence = e.primaryObject.confidence,
        direction = e.direction,
        multipleObjectsDetected = e.multipleObjectsDetected,
        objectCount = e.objectCount,
        text = text,
        timestamp = now,
    )

    companion object {
        const val NO_OBJECT_TEXT = "No object detected yet."
    }
}
