package com.videotranslate.app

import android.content.Context
import com.videotranslate.app.audio.MusicWindow
import com.videotranslate.app.audio.VadProfile
import com.videotranslate.app.audio.VadSensitivity
import com.videotranslate.app.stt.SttModel


enum class AudioSource { INTERNAL, MICROPHONE }

/** Fala (detector de fala + Moonshine) ou música (janelas fixas + Whisper, para letras cantadas). */
enum class AudioMode(val label: String) { SPEECH("Fala"), MUSIC("Música") }

data class Settings(
    val audioSource: AudioSource = AudioSource.INTERNAL,
    val sttModel: SttModel = SttModel.MOONSHINE_TINY,
    val vadProfile: VadProfile = VadProfile.NORMAL,
    val vadSensitivity: VadSensitivity = VadSensitivity.NORMAL,
    val audioMode: AudioMode = AudioMode.SPEECH,
    /** Modelo usado no modo música (só Whisper). */
    val musicModel: SttModel = SttModel.WHISPER_BASE_EN,
    val musicWindow: MusicWindow = MusicWindow.LONG,
    val fontSp: Int = 18,
    val libreUrl: String = "",
    val libreApiKey: String = "",
    val overlayEnabled: Boolean = true,
    val overlayOpacity: Float = 0.85f,
    val overlayLines: Int = 2,
) {
    /** Modelo de STT efetivo para o modo escolhido. */
    val activeModel: SttModel get() = if (audioMode == AudioMode.MUSIC) musicModel else sttModel

    companion object {
        private const val PREFS = "settings"

        fun load(context: Context): Settings {
            val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            return Settings(
                audioSource = runCatching { AudioSource.valueOf(p.getString("audioSource", "INTERNAL")!!) }.getOrDefault(AudioSource.INTERNAL),
                sttModel = SttModel.byId(p.getString("sttModel", null)),
                vadProfile = runCatching { VadProfile.valueOf(p.getString("vadProfile", "NORMAL")!!) }.getOrDefault(VadProfile.NORMAL),
                vadSensitivity = runCatching { VadSensitivity.valueOf(p.getString("vadSensitivity", "NORMAL")!!) }.getOrDefault(VadSensitivity.NORMAL),
                audioMode = runCatching { AudioMode.valueOf(p.getString("audioMode", "SPEECH")!!) }.getOrDefault(AudioMode.SPEECH),
                musicModel = SttModel.byIdOrNull(p.getString("musicModel", null))?.takeIf { it.forMusic } ?: SttModel.WHISPER_BASE_EN,
                musicWindow = runCatching { MusicWindow.valueOf(p.getString("musicWindow", "LONG")!!) }.getOrDefault(MusicWindow.LONG),
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
                .putString("vadSensitivity", s.vadSensitivity.name)
                .putString("audioMode", s.audioMode.name)
                .putString("musicModel", s.musicModel.id)
                .putString("musicWindow", s.musicWindow.name)
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
