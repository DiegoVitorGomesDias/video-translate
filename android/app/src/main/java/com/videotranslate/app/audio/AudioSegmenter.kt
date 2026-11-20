package com.videotranslate.app.audio

/**
 * Interface comum dos segmentadores de áudio (detector de fala por energia e janelas do modo
 * música). As implementações são thread-safe: `push` chega da thread de leitura do áudio e
 * `peek`/`isSpeaking`/`flush` de coroutines.
 */
interface AudioSegmenter {
    val isSpeaking: Boolean
    val currentSegmentId: Int
    val currentDurationMs: Double
    var onSegment: ((AudioSegment) -> Unit)?
    var onSpeechStart: ((Int) -> Unit)?
    var onLevel: ((rms: Float, isSpeech: Boolean) -> Unit)?
    fun peek(): FloatArray?
    /** Trecho aberto e o id dele, lidos atomicamente (para as parciais). */
    fun peekWithId(): Pair<Int, FloatArray>?
    fun push(block: FloatArray)
    fun flush()
}
