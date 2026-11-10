package com.videotranslate.app.translate

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** LibreTranslate: POST {url}/translate (mesma API usada pela extensão). */
class LibreTranslateProvider(url: String, private val apiKey: String = "", private val timeoutMs: Int = 8000) : TranslationProvider {
    override val name = "LibreTranslate"
    private val base = url.trimEnd('/')

    override suspend fun prepare(onProgress: (String) -> Unit) {
        // Health check: GET /languages
        withContext(Dispatchers.IO) {
            val conn = (URL("$base/languages").openConnection() as HttpURLConnection).apply { connectTimeout = timeoutMs; readTimeout = timeoutMs }
            if (conn.responseCode !in 200..299) throw IllegalStateException("LibreTranslate respondeu HTTP ${conn.responseCode}")
            conn.disconnect()
        }
    }

    override suspend fun translate(text: String, from: String, to: String): String = withContext(Dispatchers.IO) {
        val body = JSONObject().put("q", text).put("source", from).put("target", to).put("format", "text")
        if (apiKey.isNotEmpty()) body.put("api_key", apiKey)
        val conn = (URL("$base/translate").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = timeoutMs
            readTimeout = timeoutMs
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
        }
        conn.outputStream.use { it.write(body.toString().toByteArray()) }
        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val res = stream?.bufferedReader()?.readText() ?: ""
        if (code !in 200..299) throw IllegalStateException("LibreTranslate HTTP $code: $res")
        JSONObject(res).optString("translatedText").ifEmpty { throw IllegalStateException("resposta sem translatedText") }
    }
}
