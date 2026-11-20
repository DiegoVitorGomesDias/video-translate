package com.videotranslate.app

import android.content.Context
import android.os.Build
import android.os.Debug
import android.util.Log
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Registro de falhas visível no app. Guarda em `files/`:
 * - `crash.txt`: exceções Java não tratadas (handler global) e erros graves da pipeline;
 * - `session.txt`: "batimento" da captura em curso (tempo, memória, estado), apagado ao parar
 *   normalmente. Se existir na próxima abertura sem captura rodando, o processo morreu sem
 *   exceção Java (falta de memória, erro nativo do sherpa-onnx ou morte pelo sistema).
 * A tela principal mostra o relatório pendente com botão para copiar.
 */
object CrashLog {
    private const val TAG = "CrashLog"
    private const val CRASH_FILE = "crash.txt"
    private const val SESSION_FILE = "session.txt"
    private const val MAX_BYTES = 64 * 1024

    private fun crashFile(ctx: Context) = File(ctx.filesDir, CRASH_FILE)
    private fun sessionFile(ctx: Context) = File(ctx.filesDir, SESSION_FILE)
    private fun now() = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.ROOT).format(Date())

    fun install(ctx: Context) {
        val app = ctx.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, e ->
            runCatching { record(app, "Exceção não tratada na thread \"${thread.name}\"", e) }
            previous?.uncaughtException(thread, e)
        }
    }

    /** Anexa um erro ao relatório (chamado pelo handler global e pela pipeline de captura). */
    @Synchronized
    fun record(ctx: Context, title: String, e: Throwable?) {
        try {
            val sw = StringWriter()
            e?.printStackTrace(PrintWriter(sw))
            val session = runCatching { sessionFile(ctx).takeIf { it.exists() }?.readText() }.getOrNull()
            val text = buildString {
                append("=== ").append(now()).append(" · v").append(version(ctx)).append(" · Android ").append(Build.VERSION.RELEASE)
                append(" · ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append('\n')
                append(title).append('\n')
                if (sw.buffer.isNotEmpty()) append(sw.toString())
                if (!session.isNullOrBlank()) append("Captura no momento: ").append(session.trim()).append('\n')
                append('\n')
            }
            val f = crashFile(ctx)
            val old = if (f.exists()) f.readText() else ""
            f.writeText((old + text).takeLast(MAX_BYTES))
            Log.e(TAG, title, e)
        } catch (t: Throwable) {
            Log.e(TAG, "não consegui gravar o relatório", t)
        }
    }

    /** Batimento da captura: sobrescreve `session.txt` com o estado atual. */
    fun heartbeat(ctx: Context, uptimeMs: Long, status: String) {
        runCatching {
            val rt = Runtime.getRuntime()
            val javaMb = (rt.totalMemory() - rt.freeMemory()) / 1_048_576
            val maxMb = rt.maxMemory() / 1_048_576
            val nativeMb = Debug.getNativeHeapAllocatedSize() / 1_048_576
            sessionFile(ctx).writeText("${now()} · ${uptimeMs / 1000} s de captura · heap Java $javaMb/$maxMb MB · heap nativo $nativeMb MB · $status\n")
        }
    }

    fun sessionEnded(ctx: Context) { runCatching { sessionFile(ctx).delete() } }

    /**
     * Relatório pendente para mostrar ao abrir o app, ou null. `captureRunning` evita tratar
     * uma captura em andamento (usuário só voltou para a tela) como morte do processo.
     */
    fun pendingReport(ctx: Context, captureRunning: Boolean): String? {
        val crash = runCatching { crashFile(ctx).takeIf { it.exists() }?.readText() }.getOrNull()
        val session = if (captureRunning) null else runCatching { sessionFile(ctx).takeIf { it.exists() }?.readText() }.getOrNull()
        if (crash.isNullOrBlank() && session.isNullOrBlank()) return null
        return buildString {
            if (!session.isNullOrBlank()) {
                append("O app foi encerrado sem aviso durante a captura, sem exceção Java registrada: ")
                append("provavelmente falta de memória, erro nativo do reconhecedor ou encerramento pelo sistema.\n")
                append("Último estado: ").append(session.trim()).append("\n\n")
            }
            if (!crash.isNullOrBlank()) append(crash.trim())
        }
    }

    fun clear(ctx: Context) {
        runCatching { crashFile(ctx).delete() }
        sessionEnded(ctx)
    }

    private fun version(ctx: Context) = runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName }.getOrNull() ?: "?"
}
