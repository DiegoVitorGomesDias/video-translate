package com.videotranslate.app.stt

import android.content.Context
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

enum class SttKind { MOONSHINE, WHISPER }

/**
 * Modelos de STT do sherpa-onnx (baixados no primeiro uso para o armazenamento interno).
 * `sizeMb` é o download (o .tar.bz2 do Whisper traz também os pesos fp32, que não são usados).
 */
enum class SttModel(val id: String, val label: String, val url: String, val dirName: String, val sizeMb: Int, val kind: SttKind = SttKind.MOONSHINE) {
    MOONSHINE_TINY(
        "moonshine-tiny", "Moonshine tiny (padrão)",
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2",
        "sherpa-onnx-moonshine-tiny-en-int8", 108,
    ),
    MOONSHINE_BASE(
        "moonshine-base", "Moonshine base (mais preciso, mais lento)",
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-base-en-int8.tar.bz2",
        "sherpa-onnx-moonshine-base-en-int8", 251,
    ),
    WHISPER_BASE_EN(
        "whisper-base.en", "Whisper base (inglês; padrão do modo música)",
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.en.tar.bz2",
        "sherpa-onnx-whisper-base.en", 209, SttKind.WHISPER,
    ),
    WHISPER_SMALL_EN(
        "whisper-small.en", "Whisper small (inglês; letras mais certas, 3 a 4x mais lento)",
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.en.tar.bz2",
        "sherpa-onnx-whisper-small.en", 636, SttKind.WHISPER,
    );

    /** Modelos oferecidos no modo fala (os Whisper processam janela fixa de 30 s: lentos para diálogo). */
    val forSpeech: Boolean get() = kind == SttKind.MOONSHINE
    /** Modelos oferecidos no modo música (o Moonshine é treinado só em fala e erra muito em canto). */
    val forMusic: Boolean get() = kind == SttKind.WHISPER

    companion object {
        fun byId(id: String?) = entries.firstOrNull { it.id == id } ?: MOONSHINE_TINY
        fun byIdOrNull(id: String?) = entries.firstOrNull { it.id == id }
    }
}

sealed class ModelFiles {
    data class Moonshine(val dir: File) : ModelFiles()
    data class Whisper(val encoder: File, val decoder: File, val tokens: File) : ModelFiles()
}

class ModelDownloader(private val context: Context) {
    fun modelDir(model: SttModel): File = File(context.filesDir, "models/${model.dirName}")

    fun isReady(model: SttModel): Boolean = modelFiles(model) != null

    /** Arquivos do modelo já extraídos, ou null se faltar algum. */
    fun modelFiles(model: SttModel): ModelFiles? {
        val d = modelDir(model)
        return when (model.kind) {
            SttKind.MOONSHINE -> {
                val names = listOf("preprocess.onnx", "encode.int8.onnx", "uncached_decode.int8.onnx", "cached_decode.int8.onnx", "tokens.txt")
                if (names.all { File(d, it).length() > 0 }) ModelFiles.Moonshine(d) else null
            }
            SttKind.WHISPER -> {
                // Nomes seguem o padrão "<nome>-encoder.int8.onnx" (ex.: base.en-encoder.int8.onnx).
                val files = d.listFiles() ?: return null
                val encoder = files.firstOrNull { it.name.endsWith("-encoder.int8.onnx") && it.length() > 0 } ?: return null
                val decoder = files.firstOrNull { it.name.endsWith("-decoder.int8.onnx") && it.length() > 0 } ?: return null
                val tokens = files.firstOrNull { it.name.endsWith("-tokens.txt") && it.length() > 0 } ?: return null
                ModelFiles.Whisper(encoder, decoder, tokens)
            }
        }
    }

    /**
     * Baixa e extrai o .tar.bz2 do modelo. `onProgress(bytes, total)`; total pode ser -1.
     * Verifica o tamanho recebido contra o Content-Length.
     */
    fun ensure(model: SttModel, onProgress: (Long, Long) -> Unit) {
        if (isReady(model)) return
        val root = File(context.filesDir, "models").apply { mkdirs() }
        val archive = File(root, "${model.dirName}.tar.bz2")
        val conn = URL(model.url).openConnection() as HttpURLConnection
        conn.instanceFollowRedirects = true
        conn.connectTimeout = 20000
        conn.readTimeout = 60000
        conn.connect()
        if (conn.responseCode !in 200..299) throw IllegalStateException("HTTP ${conn.responseCode} ao baixar o modelo")
        val total = conn.contentLengthLong
        var done = 0L
        conn.inputStream.use { input ->
            archive.outputStream().use { out ->
                val buf = ByteArray(256 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    done += n
                    onProgress(done, total)
                }
            }
        }
        if (total > 0 && done != total) {
            archive.delete()
            throw IllegalStateException("download incompleto ($done de $total bytes)")
        }
        extract(archive, root)
        archive.delete()
        if (!isReady(model)) throw IllegalStateException("arquivos do modelo não encontrados após extrair")
    }

    private fun extract(archive: File, dest: File) {
        TarArchiveInputStream(BZip2CompressorInputStream(BufferedInputStream(archive.inputStream()))).use { tar ->
            while (true) {
                val entry = tar.nextEntry ?: break
                val target = File(dest, entry.name)
                if (!target.canonicalPath.startsWith(dest.canonicalPath)) continue // zip slip
                if (entry.isDirectory) { target.mkdirs(); continue }
                // Whisper: o pacote traz também os pesos fp32 (não usados) e wavs de teste; não gasta disco com eles.
                val name = entry.name.substringAfterLast('/')
                if (name.endsWith(".onnx") && !name.contains(".int8.") && entry.name.contains("whisper")) continue
                if (entry.name.contains("/test_wavs/")) continue
                target.parentFile?.mkdirs()
                target.outputStream().use { tar.copyTo(it) }
            }
        }
    }
}
