package com.videotranslate.app.audio

/** Interface comum dos segmentadores de áudio (detector de fala por energia e janelas do modo música). */
interface AudioSegmenter {
    val isSpeaking: Boolean
    val currentSegmentId: Int
    val currentDurationMs: Double
    var onSegment: ((AudioSegment) -> Unit)?
    var onSpeechStart: ((Int) -> Unit)?
    var onLevel: ((rms: Float, isSpeech: Boolean) -> Unit)?
    fun peek(): FloatArray?
    fun push(block: FloatArray)
    fun flush()
}
