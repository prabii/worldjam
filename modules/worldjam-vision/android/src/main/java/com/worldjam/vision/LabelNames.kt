package com.worldjam.vision

/** Turns COCO class names into words that sound natural when spoken. */
object LabelNames {
    private val overrides = mapOf(
        "cell phone" to "Phone",
        "dining table" to "Table",
        "tv" to "TV",
        "potted plant" to "Plant",
        "wine glass" to "Wine glass",
        "hair drier" to "Hair dryer",
        "sports ball" to "Ball",
        "motorcycle" to "Motorbike",
        "couch" to "Sofa",
    )

    fun spoken(label: String): String {
        overrides[label]?.let { return it }
        if (label.isEmpty()) return "Object"
        return label.replaceFirstChar { it.uppercaseChar() }
    }

    private val words = arrayOf(
        "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
        "nineteen", "twenty",
    )

    /** "Two", "Three"... — digits past twenty, where words stop helping. */
    fun countWord(n: Int): String {
        val w = if (n in words.indices) words[n] else n.toString()
        return w.replaceFirstChar { it.uppercaseChar() }
    }
}
