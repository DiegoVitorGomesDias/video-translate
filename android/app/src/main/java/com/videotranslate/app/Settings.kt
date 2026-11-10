package com.videotranslate.app

import android.content.Context
import com.videotranslate.app.audio.VadProfile
import com.videotranslate.app.stt.SttModel

enum class AudioSource { INTERNAL, MICROPHONE }

data class Settings(
    val audioSource: AudioSource = AudioSource.INTERNAL,
    val sttModel: SttModel = SttModel.MOONSHINE_TINY,
    val vadProfile: VadProfile = VadProfile.NORMAL,
    val fontSp: Int = 18,
    val libreUrl: String = "",
    val libreApiKey: String = "",
    val overlayEnabled: Boolean = true,
    val overlayOpacity: Float = 0.85f,
    val overlayLines: Int = 2,
) {
    companion object {
        private const val PREFS = "settings"

        fun load(context: Context): Settings {
            val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            return Settings(
                audioSource = runCatching { AudioSource.valueOf(p.getString("audioSource", "INTERNAL")!!) }.getOrDefault(AudioSource.INTERNAL),
                sttModel = SttModel.byId(p.getString("sttModel", null)),
                vadProfile = runCatching { VadProfile.valueOf(p.getString("vadProfile", "NORMAL")!!) }.getOrDefault(VadProfile.NORMAL),
                fontSp = p.getInt("fontSp", 18),
                libreUrl = p.getString("libreUrl", "") ?: "",
                libreApiKey = p.getString("libreApiKey", "") ?: "",
                overlayEnabled = p.getBoolean("overlayEnabled", true),
                overlayOpacity = p.getFloat("overlayOpacity", 0.85f),
                overlayLines = p.getInt("overlayLines", 2),
            )
        }

        fun save(context: Context, s: Settings) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("audioSource", s.audioSource.name)
                .putString("sttModel", s.sttModel.id)
                .putString("vadProfile", s.vadProfile.name)
                .putInt("fontSp", s.fontSp)
                .putString("libreUrl", s.libreUrl)
                .putString("libreApiKey", s.libreApiKey)
                .putBoolean("overlayEnabled", s.overlayEnabled)
                .putFloat("overlayOpacity", s.overlayOpacity)
                .putInt("overlayLines", s.overlayLines)
                .apply()
        }
    }
}
