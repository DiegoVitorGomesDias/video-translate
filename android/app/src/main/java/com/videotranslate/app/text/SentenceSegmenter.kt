package com.videotranslate.app.text

/**
 * Porte de src/lib/segmenter.ts: junta os resultados finais do STT em frases.
 * - divide em ". ? !" respeitando abreviações, iniciais, decimais e reticências antes de minúscula;
 * - um final de trecho fechado por pausa (SILENCE/FLUSH) encerra a frase mesmo sem pontuação;
 *   só restos de trechos cortados por tamanho (MAX_LENGTH) esperam o próximo final;
 * - frases coladas sem pontuação são separadas antes de iniciadores em maiúscula;
 * - resto fechado à força acima de maxChars (cortando na vírgula/conjunção) ou maxWaitMs.
 */
enum class EndReason { SILENCE, MAX_LENGTH, FLUSH }

data class Sentence(val id: Int, val text: String, val endedAt: Long, val forced: Boolean)

class SentenceSegmenter(private val maxChars: Int = 90, private val maxWaitMs: Long = 5000) {
    private var rest = ""
    private var restSince = 0L
    private var nextId = 1

    val pending: String get() = rest

    fun push(text: String, now: Long = System.currentTimeMillis(), reason: EndReason = EndReason.MAX_LENGTH): List<Sentence> {
        val cleaned = normalize(text)
        if (cleaned.isEmpty()) return if (reason == EndReason.MAX_LENGTH) flushIfStale(now) else flush(now)

        val out = mutableListOf<Sentence>()
        if (rest.isEmpty()) restSince = now
        val combined = if (rest.isEmpty()) cleaned else "$rest $cleaned"
        val (sentences, newRest) = splitSentences(combined)
        for (s in sentences) out += make(s, now, false)
        rest = newRest
        if (sentences.isNotEmpty()) restSince = now

        if (rest.isNotEmpty() && reason != EndReason.MAX_LENGTH) {
            out += make(rest, now, false)
            rest = ""
        } else {
            while (rest.length >= maxChars) {
                val (head, tail) = cutAt(rest, maxChars)
                out += make(head, now, true)
                rest = tail
                restSince = now
            }
            if (rest.isNotEmpty() && now - restSince >= maxWaitMs) {
                out += make(rest, now, true)
                rest = ""
            }
        }
        return out
    }

    fun flushIfStale(now: Long = System.currentTimeMillis()): List<Sentence> =
        if (rest.isNotEmpty() && now - restSince >= maxWaitMs) flush(now) else emptyList()

    fun flush(now: Long = System.currentTimeMillis()): List<Sentence> {
        if (rest.isEmpty()) return emptyList()
        val s = make(rest, now, true)
        rest = ""
        return listOf(s)
    }

    private fun make(text: String, endedAt: Long, forced: Boolean) = Sentence(nextId++, text, endedAt, forced)

    companion object {
        private val ABBREVIATIONS = setOf(
            "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt", "vs", "etc", "inc", "ltd", "co",
            "e.g", "i.e", "u.s", "u.k", "a.m", "p.m", "no", "fig", "approx", "dept", "est", "gen", "gov",
            "sen", "rep", "capt", "col", "lt", "sgt", "ave", "blvd", "rd",
        )
        private val STARTERS = (
            "what why how when where who whose which and but so well okay ok yes yeah no nope he she they we you it that this there here " +
                "do did does is are was were can could would should will let's maybe now then please thanks thank sorry look listen wait hey oh " +
                "anyway actually because if just come go get give tell take stop don't"
            ).split(' ').toSet()
        private val TITLES = setOf("mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "doctor", "mister", "miss", "president", "captain", "professor", "uncle", "aunt")
        private val CONJ = Regex("\\s(and|but|so|because|or|then|which|while|when|that)\\s", RegexOption.IGNORE_CASE)

        /** Colapsa espaços; vazio se não houver letra ou número. */
        fun normalize(text: String): String {
            val t = text.replace(Regex("\\s+"), " ").trim()
            return if (t.any { it.isLetterOrDigit() }) t else ""
        }

        fun splitSentences(text: String): Pair<List<String>, String> {
            val (byPunct, restPunct) = splitByPunctuation(text)
            val sentences = mutableListOf<String>()
            for (s in byPunct) sentences += splitGlued(s)
            val restParts = splitGlued(restPunct).toMutableList()
            val rest = if (restParts.isEmpty()) "" else restParts.removeAt(restParts.size - 1)
            sentences += restParts
            return sentences to rest
        }

        fun cutAt(text: String, max: Int): Pair<String, String> {
            val limit = minOf(text.length, max)
            val min = (max * 0.4).toInt()
            var cut = -1
            for (i in limit downTo min) {
                if (i < text.length && text[i] in ",;:" && text.getOrNull(i + 1) == ' ') { cut = i + 1; break }
            }
            if (cut < 0) {
                for (m in CONJ.findAll(text)) { if (m.range.first > limit) break; if (m.range.first >= min) cut = m.range.first }
            }
            if (cut < 0) {
                val sp = text.lastIndexOf(' ', limit.coerceAtMost(text.length - 1))
                cut = if (sp > min) sp else limit
            }
            return text.substring(0, cut).trim() to text.substring(cut).trim()
        }

        fun splitGlued(text: String): List<String> {
            val words = text.split(' ').filter { it.isNotEmpty() }
            if (words.size < 4) return if (text.isNotEmpty()) listOf(text) else emptyList()
            val out = mutableListOf<String>()
            var start = 0
            for (i in 2 until words.size - 1) {
                val w = words[i]
                val prev = words[i - 1]
                val bare = w.filter { it.isLetter() || it == '\'' }
                if (bare.isEmpty() || bare == "I" || !bare[0].isUpperCase()) continue
                if (bare.lowercase() !in STARTERS) continue
                val prevBare = prev.filter { it.isLetter() || it == '\'' }
                if (prevBare.isEmpty() || !prevBare[0].isLowerCase()) continue
                if (prev.last() in ",;:(-–—\"'“") continue
                if (prevBare.lowercase() in TITLES) continue
                if (i - start < 2 || words.size - i < 2) continue
                out += words.subList(start, i).joinToString(" ")
                start = i
            }
            out += words.subList(start, words.size).joinToString(" ")
            return out
        }

        private fun splitByPunctuation(text: String): Pair<List<String>, String> {
            val sentences = mutableListOf<String>()
            var start = 0
            var i = 0
            while (i < text.length) {
                val ch = text[i]
                if (ch != '.' && ch != '?' && ch != '!') { i++; continue }
                var end = i + 1
                while (end < text.length && text[end] in ".?!") end++
                while (end < text.length && text[end] in "\"'”’)]") end++
                val atEnd = end >= text.length
                if (!atEnd && text[end] != ' ') { i = end; continue }
                if (ch == '.' && !atEnd && isAbbreviationEnd(text, i)) { i = end; continue }
                if (!atEnd && end - i >= 2 && text.startsWith("..", i) && text.getOrNull(end + 1)?.isLowerCase() == true) { i = end; continue }
                val sentence = text.substring(start, end).trim()
                if (sentence.isNotEmpty()) sentences += sentence
                start = end
                i = end
            }
            return sentences to text.substring(start).trim()
        }

        private fun isAbbreviationEnd(text: String, dot: Int): Boolean {
            if (text.getOrNull(dot - 1)?.isDigit() == true && text.getOrNull(dot + 1)?.isDigit() == true) return true
            var j = dot - 1
            while (j >= 0 && (text[j].isLetter() || text[j] == '.')) j--
            val word = text.substring(j + 1, dot).lowercase()
            if (word.isEmpty()) return false
            if (word in ABBREVIATIONS) return true
            if (word.length == 1 && text.getOrNull(dot + 2)?.isUpperCase() == true) return true
            return false
        }
    }
}
