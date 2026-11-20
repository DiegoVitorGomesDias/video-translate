package com.videotranslate.app.audio

/**
 * Porte de src/lib/audio/music.ts: modo música, sem detector de fala.
 *
 * O áudio é acumulado continuamente e cortado a cada `windowMs` no bloco mais silencioso
 * dos últimos `searchMs` (fim de verso, respiração). Uma pausa de `silenceMs` abaixo de
 * `minRms` fecha a janela; uma janela só de silêncio (vídeo pausado) é descartada. Cada
 * janela sai com motivo SILENCE para o segmentador de frases tratá-la como verso fechado.
 */
/**
 * Tamanho da janela do modo música (igual a MUSIC_WINDOWS em src/lib/audio/music.ts). O Whisper
 * processa 30 s por chamada: o custo é por janela, não por segundo, então janelas curtas
 * chamam o modelo mais vezes (a fila acumula na CPU) e tiram contexto; longas acertam mais.
 */
enum class MusicWindow(val windowMs: Int, val maxWindowMs: Int, val searchMs: Int, val label: String, val description: String) {
    SHORT(4000, 5500, 1500, "Curta (~4 s)", "legenda antes, versos cortados, 2 a 3x mais chamadas do modelo (a fila acumula)"),
    MEDIUM(7000, 9000, 2500, "Média (~7 s)", "meio-termo: um ou dois versos por janela"),
    LONG(10000, 12000, 3000, "Longa (~10 s)", "mais precisa, versos inteiros, o modelo acompanha; legenda uns 10 a 15 s depois do início do verso");

    val segmenterLabel: String get() = "Música (janela ${label.lowercase()})"
}

class MusicSegmenter(
    private val sampleRate: Int = 16000,
    windowMs: Int = WINDOW_MS,
    maxWindowMs: Int = MAX_WINDOW_MS,
    searchMs: Int = SEARCH_MS,
    private val minRms: Float = MIN_RMS,
    silenceMs: Int = SILENCE_MS,
    minSoundMs: Int = MIN_SOUND_MS,
) : AudioSegmenter {
    companion object {
        const val WINDOW_MS = 10000
        const val MAX_WINDOW_MS = 12000
        const val SEARCH_MS = 3000
        const val SILENCE_MS = 1000
        const val MIN_RMS = 0.004f
        const val MIN_SOUND_MS = 500
        /** Janelas na fila do STT acima disso são puladas (o modelo não acompanha). */
        const val MAX_BACKLOG = 2
    }

    private fun ms(v: Int) = (v / 1000.0 * sampleRate).toInt()
    private val windowSamples = ms(windowMs)
    private val maxSamples = ms(maxWindowMs)
    private val searchSamples = ms(searchMs)
    private val silenceSamples = ms(silenceMs)
    private val minSoundSamples = ms(minSoundMs)

    private var blocks = ArrayList<FloatArray>()
    private var rmsList = ArrayList<Float>()
    private var length = 0
    private var soundSamples = 0
    private var trailingSilence = 0
    private var open = false
    private var nextId = 1
    private var currentId = 0

    override var onSegment: ((AudioSegment) -> Unit)? = null
    override var onSpeechStart: ((Int) -> Unit)? = null
    override var onLevel: ((rms: Float, isSpeech: Boolean) -> Unit)? = null

    /** Mesmo lock do EnergyVad: `push` vem da thread de áudio, o resto de coroutines. */
    private val lock = Any()

    override val isSpeaking: Boolean get() = synchronized(lock) { open }
    override val currentSegmentId: Int get() = synchronized(lock) { if (open) currentId else 0 }
    override val currentDurationMs: Double get() = synchronized(lock) { length * 1000.0 / sampleRate }

    override fun peek(): FloatArray? = synchronized(lock) { if (open && length > 0) concat(blocks, length) else null }

    override fun peekWithId(): Pair<Int, FloatArray>? = synchronized(lock) { if (open && length > 0) currentId to concat(blocks, length) else null }

    override fun push(block: FloatArray) = synchronized(lock) { pushLocked(block) }

    private fun pushLocked(block: FloatArray) {
        var sum = 0.0
        for (v in block) sum += v * v
        val rms = Math.sqrt(sum / maxOf(1, block.size)).toFloat()
        val loud = rms >= minRms
        onLevel?.invoke(rms, loud)

        if (!open) {
            if (!loud) return
            open = true
            currentId = nextId++
            soundSamples = 0
            trailingSilence = 0
            onSpeechStart?.invoke(currentId)
        }
        blocks.add(block); rmsList.add(rms); length += block.size
        if (loud) { soundSamples += block.size; trailingSilence = 0 } else trailingSilence += block.size

        if (trailingSilence >= silenceSamples) close(SegmentReason.SILENCE)
        else if (length >= windowSamples) splitAtQuietest()
    }

    override fun flush() = synchronized(lock) { if (open) close(SegmentReason.FLUSH) }

    private fun splitAtQuietest() {
        var acc = 0
        var bestIdx = -1
        var bestRms = Float.MAX_VALUE
        for (i in blocks.size - 1 downTo 1) {
            acc += blocks[i].size
            if (acc > searchSamples) break
            if (rmsList[i] < bestRms) { bestRms = rmsList[i]; bestIdx = i }
        }
        if (bestIdx < 0) { if (length >= maxSamples) close(SegmentReason.MAX_LENGTH); return }
        val mean = rmsList.sum() / rmsList.size
        if (bestRms > mean * 0.5f && length < maxSamples) return

        val tail = ArrayList(blocks.subList(bestIdx, blocks.size))
        val tailRms = ArrayList(rmsList.subList(bestIdx, rmsList.size))
        blocks = ArrayList(blocks.subList(0, bestIdx))
        rmsList = ArrayList(rmsList.subList(0, bestIdx))
        length = blocks.sumOf { it.size }
        var tailSound = 0
        for (i in tail.indices) if (tailRms[i] >= minRms) tailSound += tail[i].size
        soundSamples = maxOf(0, soundSamples - tailSound)
        emit(SegmentReason.MAX_LENGTH)

        open = true
        currentId = nextId++
        blocks = tail; rmsList = tailRms
        length = tail.sumOf { it.size }
        soundSamples = tailSound
        trailingSilence = 0
        for (i in tail.indices.reversed()) { if (tailRms[i] >= minRms) break; trailingSilence += tail[i].size }
        onSpeechStart?.invoke(currentId)
    }

    private fun close(reason: SegmentReason) {
        emit(reason)
        open = false
        blocks = ArrayList(); rmsList = ArrayList(); length = 0; soundSamples = 0; trailingSilence = 0
    }

    private fun emit(reason: SegmentReason) {
        if (soundSamples < minSoundSamples) return
        val audio = concat(blocks, length)
        // Cada janela é um verso fechado (o segmentador de frases não espera o próximo final).
        val r = if (reason == SegmentReason.MAX_LENGTH) SegmentReason.SILENCE else reason
        onSegment?.invoke(AudioSegment(currentId, audio, sampleRate, System.currentTimeMillis(), r))
    }

    private fun concat(list: List<FloatArray>, total: Int): FloatArray {
        val out = FloatArray(total)
        var o = 0
        for (b in list) { System.arraycopy(b, 0, out, o, b.size); o += b.size }
        return out
    }
}
