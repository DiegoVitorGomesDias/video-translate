package com.videotranslate.app.stt

import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineMoonshineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineWhisperModelConfig
import java.io.File

/**
 * Reconhecedor offline (sherpa-onnx) com Moonshine ou Whisper. Uma instância por sessão;
 * chamadas serializadas.
 *
 * O Whisper processa sempre uma janela de 30 s (o trecho é preenchido com silêncio), por
 * isso cada chamada custa o mesmo para 3 s ou 9 s de áudio; ele é usado no modo música,
 * com janelas longas.
 */
class SherpaRecognizer(files: ModelFiles, numThreads: Int = 2) : AutoCloseable {
    private val recognizer: OfflineRecognizer
    @Volatile private var closed = false

    init {
        val modelConfig = when (files) {
            is ModelFiles.Moonshine -> OfflineModelConfig(
                moonshine = OfflineMoonshineModelConfig(
                    preprocessor = File(files.dir, "preprocess.onnx").path,
                    encoder = File(files.dir, "encode.int8.onnx").path,
                    uncachedDecoder = File(files.dir, "uncached_decode.int8.onnx").path,
                    cachedDecoder = File(files.dir, "cached_decode.int8.onnx").path,
                ),
                tokens = File(files.dir, "tokens.txt").path,
                numThreads = numThreads,
                debug = false,
                provider = "cpu",
            )
            is ModelFiles.Whisper -> OfflineModelConfig(
                whisper = OfflineWhisperModelConfig(
                    encoder = files.encoder.path,
                    decoder = files.decoder.path,
                    language = "en",
                    task = "transcribe",
                ),
                tokens = files.tokens.path,
                modelType = "whisper",
                numThreads = numThreads,
                debug = false,
                provider = "cpu",
            )
        }
        val cfg = OfflineRecognizerConfig(
            featConfig = FeatureConfig(sampleRate = 16000, featureDim = 80),
            modelConfig = modelConfig,
            decodingMethod = "greedy_search",
        )
        recognizer = OfflineRecognizer(assetManager = null, config = cfg)
    }

    @Synchronized
    fun transcribe(samples: FloatArray, sampleRate: Int = 16000): String {
        if (closed) return ""
        val stream = recognizer.createStream()
        try {
            stream.acceptWaveform(samples, sampleRate)
            recognizer.decode(stream)
            return recognizer.getResult(stream).text.trim()
        } finally {
            stream.release()
        }
    }

    /** Sincronizado com `transcribe`: liberar o nativo no meio de um decode derrubava o processo. */
    @Synchronized
    override fun close() { if (!closed) { closed = true; recognizer.release() } }
}
