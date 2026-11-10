package com.videotranslate.app.stt

import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineMoonshineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import java.io.File

/** Reconhecedor offline (sherpa-onnx) com Moonshine. Uma instância por sessão; chamadas serializadas. */
class SherpaRecognizer(modelDir: File, numThreads: Int = 2) : AutoCloseable {
    private val recognizer: OfflineRecognizer

    init {
        val cfg = OfflineRecognizerConfig(
            featConfig = FeatureConfig(sampleRate = 16000, featureDim = 80),
            modelConfig = OfflineModelConfig(
                moonshine = OfflineMoonshineModelConfig(
                    preprocessor = File(modelDir, "preprocess.onnx").path,
                    encoder = File(modelDir, "encode.int8.onnx").path,
                    uncachedDecoder = File(modelDir, "uncached_decode.int8.onnx").path,
                    cachedDecoder = File(modelDir, "cached_decode.int8.onnx").path,
                ),
                tokens = File(modelDir, "tokens.txt").path,
                numThreads = numThreads,
                debug = false,
                provider = "cpu",
            ),
            decodingMethod = "greedy_search",
        )
        recognizer = OfflineRecognizer(assetManager = null, config = cfg)
    }

    @Synchronized
    fun transcribe(samples: FloatArray, sampleRate: Int = 16000): String {
        val stream = recognizer.createStream()
        try {
            stream.acceptWaveform(samples, sampleRate)
            recognizer.decode(stream)
            return recognizer.getResult(stream).text.trim()
        } finally {
            stream.release()
        }
    }

    override fun close() = recognizer.release()
}
