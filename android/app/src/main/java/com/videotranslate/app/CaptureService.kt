package com.videotranslate.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import com.videotranslate.app.audio.Agc
import com.videotranslate.app.audio.AudioSegment
import com.videotranslate.app.audio.AudioSegmenter
import com.videotranslate.app.audio.EnergyVad
import com.videotranslate.app.audio.MusicSegmenter
import com.videotranslate.app.audio.SegmentReason
import com.videotranslate.app.overlay.OverlayManager
import com.videotranslate.app.stt.ModelDownloader
import com.videotranslate.app.stt.SherpaRecognizer
import com.videotranslate.app.stt.SttKind
import com.videotranslate.app.text.EndReason
import com.videotranslate.app.text.LyricsFilter
import com.videotranslate.app.text.SentenceSegmenter
import com.videotranslate.app.translate.CachedTranslationProvider
import com.videotranslate.app.translate.LibreTranslateProvider
import com.videotranslate.app.translate.MlKitTranslator
import com.videotranslate.app.translate.TranslationProvider
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicInteger

/**
 * Serviço em primeiro plano: captura o áudio (interno via MediaProjection, ou microfone),
 * roda VAD → STT (sherpa-onnx) → segmentador → tradução e publica no TranscriptRepository
 * e no overlay.
 */
class CaptureService : Service() {
    companion object {
        const val ACTION_START = "com.videotranslate.app.START"
        const val ACTION_STOP = "com.videotranslate.app.STOP"
        const val ACTION_CLEAR = "com.videotranslate.app.CLEAR"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
        const val EXTRA_USE_MIC = "useMic"
        private const val CHANNEL_ID = "capture"
        private const val NOTIFICATION_ID = 1
        private const val SAMPLE_RATE = 16000
        private const val TAG = "CaptureService"
        private const val PARTIAL_INTERVAL_MS = 1500L
        private const val HEARTBEAT_MS = 10_000L
        /** Trechos finais à espera do STT. Se o reconhecedor não acompanha o áudio, os mais antigos caem
         *  (antes a fila era ilimitada e crescia até faltar memória). */
        private const val FINALS_BACKLOG = 12

        @Volatile var running = false
            private set

        fun stop(context: Context) {
            context.startService(Intent(context, CaptureService::class.java).setAction(ACTION_STOP))
        }

        /**
         * Botão "limpar" (tela e painel flutuante): começou outro vídeo. Apaga as frases, a parcial,
         * o resto do segmentador e o painel; a captura continua. Sem serviço rodando só limpa a tela
         * (startService criaria um serviço sem primeiro plano à toa).
         */
        fun clear(context: Context) {
            if (running) context.startService(Intent(context, CaptureService::class.java).setAction(ACTION_CLEAR))
            else TranscriptRepository.clearTranscript()
        }
    }

    /** Erro em qualquer coroutine vira estado de erro visível (e registro em CrashLog) em vez de derrubar o app. */
    private val onError = CoroutineExceptionHandler { _, e -> reportError("Erro na pipeline de captura", e) }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default + onError)
    private val startedAt = System.currentTimeMillis()
    private var projection: MediaProjection? = null
    private var record: AudioRecord? = null
    private var readThread: Thread? = null
    @Volatile private var reading = false
    private var recognizer: SherpaRecognizer? = null
    private var musicMode = false
    private var translator: TranslationProvider? = null
    private var overlay: OverlayManager? = null
    private val segmenter = SentenceSegmenter()
    private val finalsPending = AtomicInteger(0)
    private val finals = Channel<AudioSegment>(FINALS_BACKLOG, BufferOverflow.DROP_OLDEST) { finalsPending.decrementAndGet(); Log.w(TAG, "STT atrasado: trecho ${it.id} descartado") }
    private val partials = Channel<Pair<Int, FloatArray>>(Channel.CONFLATED)
    /** Maior id de trecho já fechado (os ids crescem em ordem); parcial de id menor ou igual é descartada. */
    private val lastClosedId = AtomicInteger(0)
    @Volatile private var lastPartialCostMs = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopSelf(); return START_NOT_STICKY }
            ACTION_CLEAR -> { if (running) clearTranscript() else stopSelf(); return START_NOT_STICKY }
            ACTION_START -> {
                if (running) return START_STICKY
                val useMic = intent.getBooleanExtra(EXTRA_USE_MIC, false)
                startForegroundCompat(useMic)
                running = true
                TranscriptRepository.reset()
                val settings = Settings.load(this)
                musicMode = settings.audioMode == AudioMode.MUSIC
                val profileLabel = if (musicMode) settings.musicWindow.segmenterLabel else "${settings.vadProfile.label} (${settings.vadProfile.silenceMs / 1000.0} s / ${settings.vadProfile.maxSegmentMs / 1000} s) · sensibilidade ${settings.vadSensitivity.label.lowercase()}"
                TranscriptRepository.update { it.copy(capture = CaptureState.STARTING, statusText = "Iniciando…", appliedModel = settings.activeModel.label.substringBefore(" ("), appliedProfile = profileLabel) }
                if (settings.overlayEnabled && android.provider.Settings.canDrawOverlays(this)) {
                    overlay = OverlayManager(this, settings).also { it.show() }
                }
                scope.launch { runPipeline(settings, useMic, intent) }
            }
        }
        return START_STICKY
    }

    private fun startForegroundCompat(useMic: Boolean) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, getString(R.string.notification_channel), NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, CaptureService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_text))
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, getString(R.string.action_stop), stop).build())
            .setOngoing(true)
            .build()
        val type = if (useMic) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        else ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, n, type) else startForeground(NOTIFICATION_ID, n)
    }

    private suspend fun runPipeline(settings: Settings, useMic: Boolean, intent: Intent) {
        try {
            // 1. Fonte de áudio.
            val rec = if (useMic) openMicrophone() else openInternalCapture(intent)
            record = rec

            // 2. Segmentador + fila de trechos; a leitura começa já (o modelo carrega em paralelo).
            //    Fala: detector por energia (com sensibilidade e AGC). Música: janelas fixas de
            //    ~7 s, sem detector nem AGC (o canto sobre instrumentos não tem as pausas que o
            //    detector procura, e o instrumental não deve ser amplificado).
            val sens = settings.vadSensitivity
            val vad: AudioSegmenter = if (musicMode) MusicSegmenter(SAMPLE_RATE, settings.musicWindow.windowMs, settings.musicWindow.maxWindowMs, settings.musicWindow.searchMs)
            else EnergyVad(SAMPLE_RATE, settings.vadProfile.silenceMs, settings.vadProfile.maxSegmentMs, minSpeechMs = sens.minSpeechMs, minThreshold = sens.minThreshold, noiseFactor = sens.noiseFactor)
            val agc = if (!musicMode && sens.agcMaxGain > 1f) Agc(target = 0.5f, maxGain = sens.agcMaxGain, sampleRate = SAMPLE_RATE) else null
            vad.onSegment = { seg ->
                lastClosedId.accumulateAndGet(seg.id) { a, b -> maxOf(a, b) }
                // Música: o Whisper custa o mesmo por janela; com mais de 2 na fila o modelo não
                // acompanha e a legenda só atrasaria. Pula a janela em vez de acumular.
                if (musicMode && finalsPending.get() >= MusicSegmenter.MAX_BACKLOG) {
                    Log.w(TAG, "STT atrasado (${finalsPending.get()} janelas na fila): janela ${seg.id} pulada")
                    TranscriptRepository.update { it.copy(statusText = "Ouvindo · modelo atrasado, pulando trechos") }
                } else {
                    finalsPending.incrementAndGet(); finals.trySend(seg)
                }
            }
            vad.onLevel = { rms, _ -> TranscriptRepository.update { it.copy(level = minOf(1f, rms * 8)) } }
            startReading(rec, vad, agc)

            // 3. Tradutor (ML Kit por padrão; LibreTranslate se configurado e saudável).
            scope.launch { translator = pickTranslator(settings) }

            // 4. Modelo de STT (download no primeiro uso). No modo música é um Whisper.
            val model = settings.activeModel
            TranscriptRepository.update { it.copy(capture = CaptureState.LOADING_MODEL, statusText = "Preparando modelo ${model.label}…", progress = 0f) }
            val downloader = ModelDownloader(this)
            withContext(Dispatchers.IO) {
                downloader.ensure(model) { done, total ->
                    val p = if (total > 0) done.toFloat() / total else null
                    TranscriptRepository.update { it.copy(statusText = "Baixando modelo ${done / 1_000_000} MB${if (total > 0) " de ${total / 1_000_000} MB" else ""}", progress = p) }
                }
                val files = downloader.modelFiles(model) ?: throw IllegalStateException("arquivos do modelo não encontrados")
                // Whisper roda uma janela de 30 s por chamada: vale usar mais núcleos.
                val threads = if (model.kind == SttKind.WHISPER) Runtime.getRuntime().availableProcessors().coerceIn(2, 4) else 2
                recognizer = SherpaRecognizer(files, threads)
            }
            val modeLabel = if (musicMode) " · modo música" else ""
            TranscriptRepository.update { it.copy(capture = CaptureState.LISTENING, statusText = "Ouvindo · ${model.label.substringBefore(" (")}$modeLabel", progress = null) }
            overlay?.setStatus("Ouvindo · ${model.label.substringBefore(" (")} · ${if (musicMode) "Música" else "${settings.vadProfile.label} · ${settings.vadSensitivity.label}"}")

            // 5. Parciais a cada 1,5 s enquanto há trecho aberto (não no modo música: o Whisper
            //    custa o mesmo para um parcial e para o final, e a janela já é longa).
            //    Se a última parcial custou mais que o intervalo, o aparelho não acompanha: pula
            //    parciais para não atrasar os finais.
            if (!musicMode) scope.launch {
                while (isActive) {
                    delay(PARTIAL_INTERVAL_MS)
                    if (lastPartialCostMs > PARTIAL_INTERVAL_MS) { lastPartialCostMs = lastPartialCostMs * 2 / 3; continue }
                    if (vad.isSpeaking && vad.currentDurationMs >= 1000) vad.peekWithId()?.let { partials.trySend(it) }
                }
            }
            // Batimento: estado e memória em arquivo, para diagnosticar se o processo morrer sem exceção.
            scope.launch {
                while (isActive) {
                    CrashLog.heartbeat(this@CaptureService, System.currentTimeMillis() - startedAt, "${TranscriptRepository.state.value.statusText} · ${TranscriptRepository.state.value.cards.size} frases · fila ${finalsPending.get()}")
                    delay(HEARTBEAT_MS)
                }
            }
            // 6. Consumidor: finais têm prioridade sobre parciais.
            while (scope.isActive) {
                val seg = finals.tryReceive().getOrNull()
                if (seg != null) { handleFinal(seg); continue }
                val partial = partials.tryReceive().getOrNull()
                if (partial != null) {
                    if (partial.first > lastClosedId.get()) handlePartial(partial.first, partial.second)
                    continue
                }
                delay(50)
            }
        } catch (e: Throwable) {
            reportError("Falha na captura", e)
        }
    }

    /** Limpa o que está na tela e no painel; o reconhecedor do app não guarda contexto entre trechos (sem prompt). */
    private fun clearTranscript() {
        segmenter.reset()
        TranscriptRepository.clearTranscript()
        overlay?.clear()
        Log.i(TAG, "legendas limpas pelo usuário")
    }

    private fun reportError(title: String, e: Throwable) {
        if (e is kotlinx.coroutines.CancellationException) return
        Log.e(TAG, title, e)
        CrashLog.record(this, title, e)
        TranscriptRepository.update { it.copy(capture = CaptureState.ERROR, statusText = "Erro", error = "$title: ${e.message ?: e.toString()}") }
        overlay?.setStatus("Erro: ${e.message ?: e.javaClass.simpleName}")
    }

    private fun handleFinal(seg: AudioSegment) {
        finalsPending.decrementAndGet()
        val rec = recognizer ?: return
        var text = rec.transcribe(Agc.normalizePeak(seg.audio), seg.sampleRate)
        if (musicMode) text = LyricsFilter.clean(text)
        val reason = when (seg.reason) { SegmentReason.SILENCE -> EndReason.SILENCE; SegmentReason.MAX_LENGTH -> EndReason.MAX_LENGTH; SegmentReason.FLUSH -> EndReason.FLUSH }
        val sentences = segmenter.push(text, System.currentTimeMillis(), reason)
        TranscriptRepository.update { it.copy(partial = "") }
        for (s in sentences) {
            val card = Card(s.id, s.text)
            TranscriptRepository.addCard(card)
            overlay?.showCard(card)
            scope.launch { translate(card) }
        }
    }

    private fun handlePartial(segmentId: Int, audio: FloatArray) {
        val rec = recognizer ?: return
        val t0 = System.currentTimeMillis()
        val text = rec.transcribe(Agc.normalizePeak(audio))
        lastPartialCostMs = System.currentTimeMillis() - t0
        if (segmentId <= lastClosedId.get()) return
        val pending = segmenter.pending
        TranscriptRepository.update { it.copy(partial = listOf(pending, text).filter { p -> p.isNotBlank() }.joinToString(" ")) }
    }

    private suspend fun translate(card: Card) {
        var t = translator
        var waited = 0
        while (t == null && waited < 60_000) { delay(250); waited += 250; t = translator }
        if (t == null) { TranscriptRepository.setTranslation(card.id, null, "tradutor indisponível"); return }
        try {
            val pt = t.translate(card.en)
            TranscriptRepository.setTranslation(card.id, pt, null)
            overlay?.updateTranslation(card.id, pt)
        } catch (e: Exception) {
            TranscriptRepository.setTranslation(card.id, null, e.message ?: "falhou")
        }
    }

    private suspend fun pickTranslator(settings: Settings): TranslationProvider {
        if (settings.libreUrl.isNotBlank()) {
            val libre = LibreTranslateProvider(settings.libreUrl, settings.libreApiKey)
            try {
                libre.prepare()
                TranscriptRepository.update { it.copy(translatorName = "LibreTranslate") }
                return CachedTranslationProvider(libre)
            } catch (e: Exception) {
                Log.w(TAG, "LibreTranslate indisponível: ${e.message}")
            }
        }
        val mlkit = MlKitTranslator()
        try {
            mlkit.prepare { msg -> TranscriptRepository.update { it.copy(translatorName = msg) } }
            TranscriptRepository.update { it.copy(translatorName = "ML Kit (no aparelho)") }
        } catch (e: Exception) {
            TranscriptRepository.update { it.copy(translatorName = "ML Kit: ${e.message}") }
        }
        return CachedTranslationProvider(mlkit)
    }

    private fun openInternalCapture(intent: Intent): AudioRecord {
        val code = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
        @Suppress("DEPRECATION")
        val data = intent.getParcelableExtra<Intent>(EXTRA_RESULT_DATA) ?: throw IllegalStateException("sem consentimento de captura")
        val mpm = getSystemService(MediaProjectionManager::class.java)
        val mp = mpm.getMediaProjection(code, data) ?: throw IllegalStateException("MediaProjection negada")
        mp.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() { stopSelf() }
        }, null)
        projection = mp
        val config = AudioPlaybackCaptureConfiguration.Builder(mp)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            .build()
        val format = AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build()
        val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = AudioRecord.Builder().setAudioFormat(format).setBufferSizeInBytes(maxOf(minBuf * 4, SAMPLE_RATE * 2)).setAudioPlaybackCaptureConfig(config).build()
        if (rec.state != AudioRecord.STATE_INITIALIZED) throw IllegalStateException("AudioRecord não inicializou (captura interna)")
        return rec
    }

    private fun openMicrophone(): AudioRecord {
        val minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuf * 4, SAMPLE_RATE * 2))
        if (rec.state != AudioRecord.STATE_INITIALIZED) throw IllegalStateException("microfone não inicializou")
        return rec
    }

    private fun startReading(rec: AudioRecord, vad: AudioSegmenter, agc: Agc?) {
        reading = true
        rec.startRecording()
        readThread = Thread({
            try {
                val buf = ShortArray(1024)
                while (reading) {
                    val n = rec.read(buf, 0, buf.size)
                    if (n <= 0) {
                        if (n < 0) { reportError("Leitura do áudio parou", IllegalStateException("AudioRecord.read devolveu $n")); break }
                        continue
                    }
                    val f = FloatArray(n) { buf[it] / 32768f }
                    vad.push(agc?.process(f) ?: f)
                }
            } catch (e: Throwable) {
                if (reading) reportError("Erro na thread de áudio", e)
            }
        }, "audio-read").also { it.start() }
    }

    override fun onDestroy() {
        running = false
        reading = false
        readThread?.join(500)
        runCatching { record?.stop() }
        record?.release(); record = null
        projection?.stop(); projection = null
        scope.cancel()
        // close() espera um transcribe em curso terminar (sincronizado): fora da thread principal.
        val rec = recognizer; recognizer = null
        val tr = translator; translator = null
        Thread({ runCatching { rec?.close() }; runCatching { tr?.close() } }, "capture-close").start()
        overlay?.hide(); overlay = null
        CrashLog.sessionEnded(this)
        TranscriptRepository.update { it.copy(capture = CaptureState.IDLE, statusText = "Parado", partial = "", level = 0f, progress = null) }
        super.onDestroy()
    }
}
