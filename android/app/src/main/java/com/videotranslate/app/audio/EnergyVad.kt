package com.videotranslate.app.audio

/** Perfis de separação de frases (iguais aos da extensão/PWA). */
enum class VadProfile(val silenceMs: Int, val maxSegmentMs: Int, val label: String) {
    FAST(200, 3000, "Rápida"), NORMAL(250, 4000, "Normal"), LONG(400, 6000, "Longa")
}

enum class SegmentReason { SILENCE, MAX_LENGTH, FLUSH }

class AudioSegment(val id: Int, val audio: FloatArray, val sampleRate: Int, val endedAt: Long, val reason: SegmentReason) {
    val durationMs: Double get() = audio.size * 1000.0 / sampleRate
}

/**
 * Porte de src/lib/audio/vad.ts: detector de fala por energia (RMS) com piso de ruído
 * adaptativo, pré-rolo, fechamento por silêncio e corte no ponto mais silencioso ao
 * atingir a duração máxima.
 */
class EnergyVad(
    private val sampleRate: Int = 16000,
    silenceMs: Int = 250,
    maxSegmentMs: Int = 4000,
    minSpeechMs: Int = 250,
    preRollMs: Int = 300,
    private val minThreshold: Float = 0.008f,
    private val noiseFactor: Float = 3f,
) {
    private fun ms(v: Int) = (v / 1000.0 * sampleRate).toInt()
    private val silenceSamples = ms(silenceMs)
    private val maxSamples = ms(maxSegmentMs)
    private val minSpeechSamples = ms(minSpeechMs)
    private val preRollSamples = ms(preRollMs)

    private var noiseFloor = 0.002f
    private val preRoll = ArrayDeque<FloatArray>()
    private var preRollLength = 0
    private var segment = ArrayList<FloatArray>()
    private var meta = ArrayList<Pair<Float, Boolean>>() // rms, isSpeech
    private var segmentLength = 0
    private var speechSamples = 0
    private var trailingSilence = 0
    private var inSpeech = false
    private var nextId = 1
    private var currentId = 0

    var onSegment: ((AudioSegment) -> Unit)? = null
    var onSpeechStart: ((Int) -> Unit)? = null
    var onLevel: ((rms: Float, isSpeech: Boolean) -> Unit)? = null

    val isSpeaking: Boolean get() = inSpeech
    val currentSegmentId: Int get() = if (inSpeech) currentId else 0
    val currentDurationMs: Double get() = segmentLength * 1000.0 / sampleRate

    fun peek(): FloatArray? = if (inSpeech && segmentLength > 0) concat(segment, segmentLength) else null

    fun push(block: FloatArray) {
        var sum = 0.0
        for (v in block) sum += v * v
        val rms = Math.sqrt(sum / maxOf(1, block.size)).toFloat()
        val threshold = maxOf(minThreshold, noiseFloor * noiseFactor)
        val isSpeech = rms >= threshold
        if (!isSpeech) {
            val alpha = if (rms < noiseFloor) 0.2f else 0.02f
            noiseFloor = noiseFloor * (1 - alpha) + rms * alpha
        } else {
            noiseFloor = noiseFloor * 0.9995f + rms * 0.0005f
        }
        onLevel?.invoke(rms, isSpeech)

        if (!inSpeech) {
            if (isSpeech) {
                inSpeech = true
                currentId = nextId++
                segment = ArrayList(preRoll)
                meta = ArrayList(preRoll.map { 0f to false })
                segmentLength = preRollLength
                speechSamples = 0
                trailingSilence = 0
                preRoll.clear(); preRollLength = 0
                append(block, rms, true)
                speechSamples += block.size
                onSpeechStart?.invoke(currentId)
            } else {
                preRoll.addLast(block); preRollLength += block.size
                while (preRoll.size > 1 && preRollLength - preRoll.first().size >= preRollSamples) preRollLength -= preRoll.removeFirst().size
            }
            return
        }

        append(block, rms, isSpeech)
        if (isSpeech) { speechSamples += block.size; trailingSilence = 0 } else trailingSilence += block.size

        if (trailingSilence >= silenceSamples) close(SegmentReason.SILENCE)
        else if (segmentLength >= maxSamples) splitAtQuietest()
    }

    fun flush() { if (inSpeech) close(SegmentReason.FLUSH) }

    private fun splitAtQuietest() {
        val window = (1.2 * sampleRate).toInt()
        var acc = 0
        var bestIdx = segment.size
        var bestRms = Float.MAX_VALUE
        for (i in segment.size - 1 downTo 1) {
            acc += segment[i].size
            if (acc > window) break
            if (meta[i].first < bestRms) { bestRms = meta[i].first; bestIdx = i }
        }
        val headLen = segment.subList(0, minOf(bestIdx, segment.size)).sumOf { it.size }
        if (bestIdx >= segment.size || headLen < maxSamples / 2) { close(SegmentReason.MAX_LENGTH); return }
        val tail = ArrayList(segment.subList(bestIdx, segment.size))
        val tailMeta = ArrayList(meta.subList(bestIdx, meta.size))
        segment = ArrayList(segment.subList(0, bestIdx))
        meta = ArrayList(meta.subList(0, bestIdx))
        segmentLength = headLen
        val tailSpeech = tailMeta.indices.sumOf { if (tailMeta[it].second) tail[it].size else 0 }
        speechSamples = maxOf(0, speechSamples - tailSpeech)
        emit(SegmentReason.MAX_LENGTH)
        inSpeech = true
        currentId = nextId++
        segment = tail; meta = tailMeta
        segmentLength = tail.sumOf { it.size }
        speechSamples = tailSpeech
        trailingSilence = 0
        for (i in tail.indices.reversed()) { if (tailMeta[i].second) break; trailingSilence += tail[i].size }
        onSpeechStart?.invoke(currentId)
    }

    private fun close(reason: SegmentReason) {
        emit(reason)
        inSpeech = false
        segment = ArrayList(); meta = ArrayList(); segmentLength = 0
    }

    private fun emit(reason: SegmentReason) {
        if (speechSamples < minSpeechSamples) return
        val audio = concat(segment, segmentLength)
        onSegment?.invoke(AudioSegment(currentId, audio, sampleRate, System.currentTimeMillis(), reason))
    }

    private fun append(block: FloatArray, rms: Float, isSpeech: Boolean) {
        segment.add(block); meta.add(rms to isSpeech); segmentLength += block.size
    }

    private fun concat(blocks: List<FloatArray>, total: Int): FloatArray {
        val out = FloatArray(total)
        var o = 0
        for (b in blocks) { System.arraycopy(b, 0, out, o, b.size); o += b.size }
        return out
    }
}
