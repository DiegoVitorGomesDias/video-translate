package com.videotranslate.app.text

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SentenceSegmenterTest {
    @Test fun divideEmFrasesPorPontuacao() {
        val (s, rest) = SentenceSegmenter.splitSentences("Hello there. How are you? Great! Still going")
        assertEquals(listOf("Hello there.", "How are you?", "Great!"), s)
        assertEquals("Still going", rest)
    }

    @Test fun preservaAbreviacoesIniciaisDecimais() {
        val (s, rest) = SentenceSegmenter.splitSentences("Mr. Smith met Dr. J. K. Rowling at 3.14 p.m. today. Then he left.")
        assertEquals(listOf("Mr. Smith met Dr. J. K. Rowling at 3.14 p.m. today.", "Then he left."), s)
        assertEquals("", rest)
    }

    @Test fun reticenciasAntesDeMinusculaNaoQuebram() {
        val (s, _) = SentenceSegmenter.splitSentences("Use fruits, e.g. apples... and pears. Done.")
        assertEquals(listOf("Use fruits, e.g. apples... and pears.", "Done."), s)
    }

    @Test fun juntaRestosComProximoFinalQuandoCortadoPorTamanho() {
        val seg = SentenceSegmenter()
        assertTrue(seg.push("and my goal is for you to come away", 1000, EndReason.MAX_LENGTH).isEmpty())
        val out = seg.push("feeling like you could have invented calculus yourself. Next", 2000, EndReason.MAX_LENGTH)
        assertEquals(1, out.size)
        assertEquals("and my goal is for you to come away feeling like you could have invented calculus yourself.", out[0].text)
        assertEquals("Next", seg.pending)
    }

    @Test fun pausaFechaFraseSemPontuacao() {
        val seg = SentenceSegmenter()
        val out = seg.push("and my goal is for you to come away", 0, EndReason.SILENCE)
        assertEquals(1, out.size)
        assertFalse(out[0].forced)
        assertEquals("", seg.pending)
    }

    @Test fun separaFrasesColadas() {
        val (a, _) = SentenceSegmenter.splitSentences("I don't know who She and she is practically living together What did you just order?")
        assertEquals("What did you just order?", a.last())
        assertFalse(a.any { it.contains("living together") && it.contains("What did") })
        val (b, rest) = SentenceSegmenter.splitSentences("That's what leads you to sandpaper yes but i don't like eating the same thing two days in a row You froze nursing")
        assertTrue(b.any { it.endsWith("two days in a row") })
        assertEquals("You froze nursing", rest)
    }

    @Test fun naoQuebraNomesTitulosVirgula() {
        assertEquals(listOf("I talked to Doctor House yesterday"), SentenceSegmenter.splitGlued("I talked to Doctor House yesterday"))
        assertEquals(listOf("We went to New York"), SentenceSegmenter.splitGlued("We went to New York"))
        assertEquals(listOf("I think, So do I"), SentenceSegmenter.splitGlued("I think, So do I"))
        assertEquals(listOf("so I said Yes"), SentenceSegmenter.splitGlued("so I said Yes"))
    }

    @Test fun limiteDeCaracteresCortaNaVirgulaOuConjuncao() {
        val (head, tail) = SentenceSegmenter.cutAt("alpha beta gamma and delta epsilon zeta", 25)
        assertEquals("alpha beta gamma", head)
        assertEquals("and delta epsilon zeta", tail)
        val seg = SentenceSegmenter(maxChars = 40)
        val out = seg.push("this is a long run on sentence without any punctuation at all", 0, EndReason.MAX_LENGTH)
        assertEquals(1, out.size)
        assertTrue(out[0].forced)
        assertTrue(out[0].text.length <= 40)
        assertEquals("this is a long run on sentence without any punctuation at all", "${out[0].text} ${seg.pending}")
    }

    @Test fun fechamentoPorTempo() {
        val seg = SentenceSegmenter(maxWaitMs = 5000)
        assertTrue(seg.push("waiting for more", 0, EndReason.MAX_LENGTH).isEmpty())
        assertTrue(seg.flushIfStale(3000).isEmpty())
        val out = seg.flushIfStale(5000)
        assertEquals(1, out.size)
        assertTrue(out[0].forced)
    }

    @Test fun ignoraVazios() {
        assertEquals("", SentenceSegmenter.normalize("..."))
        assertEquals("hello world", SentenceSegmenter.normalize("  hello   world "))
        val seg = SentenceSegmenter()
        assertTrue(seg.push(".", 0, EndReason.SILENCE).isEmpty())
    }
}
