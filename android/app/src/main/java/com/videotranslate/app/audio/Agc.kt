package com.videotranslate.app.audio

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * Porte de src/lib/audio/agc.ts: controle automático de ganho antes do detector de fala.
 * Acompanha o pico recente do sinal e amplifica até um alvo, com ganho máximo limitado
 * para não transformar o ruído de fundo em "fala". O ganho muda devagar (sem bombeio).
 */
class Agc(
    private val target: Float = 0.5f,
    private val maxGain: Float = 4f,
    sampleRate: Int = 16000,
    releaseSeconds: Float = 2f,
) {
    private val decayPerSample = 0.5.pow(1.0 / (releaseSeconds * sampleRate))
    private var envelope = target // começa com ganho 1
    var currentGain = 1f
        private set

    /** Amplifica o bloco no lugar e o devolve. */
    fun process(block: FloatArray): FloatArray {
        var peak = 0f
        for (v in block) { val a = abs(v); if (a > peak) peak = a }
        // Envelope: sobe na hora, desce devagar.
        envelope = max(peak, (envelope * decayPerSample.pow(block.size.toDouble())).toFloat())
        val wanted = min(maxGain, max(1f, target / max(envelope, 1e-4f)))
        // Desce rápido (som alto chegou), sobe devagar.
        currentGain = if (wanted < currentGain) wanted else currentGain * 0.8f + wanted * 0.2f
        if (currentGain > 1.001f) {
            for (i in block.indices) {
                val v = block[i] * currentGain
                block[i] = if (v > 1f) 1f else if (v < -1f) -1f else v
            }
        }
        return block
    }

    companion object {
        /** Normaliza o trecho para o pico alvo quando está baixo (ganho entre 1 e maxGain). */
        fun normalizePeak(audio: FloatArray, target: Float = 0.9f, maxGain: Float = 8f): FloatArray {
            var peak = 0f
            for (v in audio) { val a = abs(v); if (a > peak) peak = a }
            if (peak <= 0f || peak >= target) return audio
            val gain = min(maxGain, target / peak)
            if (gain <= 1.001f) return audio
            return FloatArray(audio.size) { audio[it] * gain }
        }
    }
}
