package com.videotranslate.app.audio

import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.atomic.AtomicReference
import kotlin.random.Random

/**
 * Reproduz o cenário do app: uma thread empurra áudio (como a thread de leitura) enquanto
 * outra lê `peek`/`isSpeaking` (como a coroutine das parciais). Sem sincronização isso
 * lançava ConcurrentModificationException/ArrayIndexOutOfBounds e derrubava o app.
 */
class SegmenterConcurrencyTest {
    private fun hammer(seg: AudioSegmenter) {
        val error = AtomicReference<Throwable?>()
        val rnd = Random(7)
        var finals = 0
        seg.onSegment = { finals++ }
        val pusher = Thread {
            try {
                repeat(6000) { i ->
                    // Blocos de 64 ms alternando som alto (3 s) e silêncio (0,5 s).
                    val loud = (i % 55) < 47
                    val block = FloatArray(1024) { if (loud) (rnd.nextFloat() - 0.5f) * 0.6f else (rnd.nextFloat() - 0.5f) * 0.001f }
                    seg.push(block)
                }
                seg.flush()
            } catch (t: Throwable) { error.set(t) }
        }
        val peeker = Thread {
            try {
                while (pusher.isAlive) {
                    if (seg.isSpeaking) seg.peekWithId()?.let { (id, audio) -> check(id > 0 && audio.isNotEmpty()) }
                    seg.peek(); seg.currentDurationMs
                }
            } catch (t: Throwable) { error.set(t) }
        }
        pusher.start(); peeker.start()
        pusher.join(30_000); peeker.join(30_000)
        assertNull("exceção em thread: ${error.get()}", error.get())
        assertTrue("deveria ter fechado trechos", finals > 0)
    }

    @Test fun energyVadAguentaPeekConcorrente() = hammer(EnergyVad(16000, 250, 4000))

    @Test fun musicSegmenterAguentaPeekConcorrente() = hammer(MusicSegmenter(16000))
}
