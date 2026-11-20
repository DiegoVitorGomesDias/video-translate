package com.videotranslate.app.text

/**
 * Porte de src/lib/stt/lyrics.ts: limpeza do texto do Whisper no modo música.
 * Remove marcadores ("♪", "[Music]", "(instrumental)") e descarta as frases que o Whisper
 * inventa em trechos só instrumentais ("Thank you.", "Thanks for watching").
 */
object LyricsFilter {
    private val HALLUCINATIONS = listOf(
        "thank you", "thanks for watching", "thank you for watching", "thank you so much for watching",
        "thanks for listening", "thank you for listening", "please subscribe", "subscribe to my channel",
        "like and subscribe", "subtitles by the amaraorg community", "subtitles by amaraorg",
        "transcribed by esoorg", "transcription by castingwords", "copyright", "you", "bye", "the end",
        "music", "applause", "laughter", "instrumental", "silence", "so", "oh", "uh", "hmm", "mm",
    ).map { key(it) }.toSet()

    private val MARKERS = Regex("\\[[^\\]]*\\]|\\([^)]*\\)|\\*[^*]*\\*|[♪♫♬♩🎵🎶]+")
    private val LEADING = Regex("^[\\s\\-–—.,;:!?]+")
    private val TRAILING = Regex("[\\s\\-–—,;:]+$")
    private val HAS_TEXT = Regex("[\\p{L}\\p{N}]")

    private fun key(text: String) = text.lowercase().replace(Regex("[^\\p{L}\\p{N}\\s]"), "").replace(Regex("\\s+"), " ").trim()

    /** Remove marcadores; devolve "" quando sobra só uma alucinação conhecida ou nada. */
    fun clean(text: String): String {
        var t = text.replace(MARKERS, " ").replace(Regex("\\s+"), " ").trim()
        t = t.replace(LEADING, "").replace(TRAILING, "").trim()
        if (!HAS_TEXT.containsMatchIn(t)) return ""
        if (key(t) in HALLUCINATIONS) return ""
        return t
    }
}
