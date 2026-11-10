package com.videotranslate.app.translate

interface TranslationProvider {
    val name: String
    /** Prepara (baixa modelo etc.). Pode demorar. */
    suspend fun prepare(onProgress: (String) -> Unit = {})
    suspend fun translate(text: String, from: String = "en", to: String = "pt"): String
    fun close() {}
}

class CachedTranslationProvider(private val inner: TranslationProvider) : TranslationProvider {
    private val cache = HashMap<String, String>()
    override val name get() = inner.name
    override suspend fun prepare(onProgress: (String) -> Unit) = inner.prepare(onProgress)
    override suspend fun translate(text: String, from: String, to: String): String {
        val key = "$from>$to:$text"
        cache[key]?.let { return it }
        val out = inner.translate(text, from, to)
        cache[key] = out
        return out
    }
    override fun close() = inner.close()
}
