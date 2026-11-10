package com.videotranslate.app.stt

import android.content.Context
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Modelos de STT do sherpa-onnx (baixados no primeiro uso para o armazenamento interno). */
enum class SttModel(val id: String, val label: String, val url: String, val dirName: String, val sizeMb: Int) {
    MOONSHINE_TINY(
        "moonshine-tiny", "Moonshine tiny (padrão)",
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2",
        "sherpa-onnx-moonshine-tiny-en-int8", 108,
    ),
    MOONSHINE_BASE(
        "moonshine-base", "Moonshine base (mais preciso, mais lento)",
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-base-en-int8.tar.bz2",
        "sherpa-onnx-moonshine-base-en-int8", 251,
    );

    companion object {
        fun byId(id: String?) = entries.firstOrNull { it.id == id } ?: MOONSHINE_TINY
    }
}

class ModelDownloader(private val context: Context) {
    fun modelDir(model: SttModel): File = File(context.filesDir, "models/${model.dirName}")

    fun isReady(model: SttModel): Boolean {
        val d = modelDir(model)
        return listOf("preprocess.onnx", "encode.int8.onnx", "uncached_decode.int8.onnx", "cached_decode.int8.onnx", "tokens.txt").all { File(d, it).length() > 0 }
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
                target.parentFile?.mkdirs()
                target.outputStream().use { tar.copyTo(it) }
            }
        }
    }
}
