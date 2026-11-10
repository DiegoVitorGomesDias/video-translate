package com.videotranslate.app.translate

import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import kotlinx.coroutines.tasks.await

/** Tradução offline do ML Kit (modelo EN→PT de ~30 MB baixado no primeiro uso). */
class MlKitTranslator : TranslationProvider {
    override val name = "ML Kit (no aparelho)"
    private var translator: Translator? = null

    override suspend fun prepare(onProgress: (String) -> Unit) {
        if (translator != null) return
        val opts = TranslatorOptions.Builder()
            .setSourceLanguage(TranslateLanguage.ENGLISH)
            .setTargetLanguage(TranslateLanguage.PORTUGUESE)
            .build()
        val t = Translation.getClient(opts)
        onProgress("baixando modelo de tradução EN→PT (~30 MB)…")
        t.downloadModelIfNeeded(DownloadConditions.Builder().build()).await()
        translator = t
    }

    override suspend fun translate(text: String, from: String, to: String): String {
        prepare()
        return translator!!.translate(text).await()
    }

    override fun close() {
        translator?.close()
        translator = null
    }
}
