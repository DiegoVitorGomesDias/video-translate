package com.videotranslate.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings as SysSettings
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.videotranslate.app.audio.VadProfile
import com.videotranslate.app.stt.SttModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val dark = androidx.compose.foundation.isSystemInDarkTheme()
            MaterialTheme(colorScheme = if (dark) darkColorScheme(primary = Color(0xFF3FC1A9)) else lightColorScheme(primary = Color(0xFF0A7C6A))) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { MainScreen() }
            }
        }
    }
}

@Composable
fun MainScreen() {
    val context = LocalContext.current
    val activity = context as Activity
    val state by TranscriptRepository.state.collectAsStateWithLifecycle()
    var settings by remember { mutableStateOf(Settings.load(context)) }
    var showSettings by remember { mutableStateOf(false) }
    var pendingStart by remember { mutableStateOf(false) }
    val version = remember { runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: "" }

    fun startService(resultCode: Int = 0, data: Intent? = null) {
        val i = Intent(context, CaptureService::class.java).setAction(CaptureService.ACTION_START)
            .putExtra(CaptureService.EXTRA_USE_MIC, settings.audioSource == AudioSource.MICROPHONE)
        if (data != null) i.putExtra(CaptureService.EXTRA_RESULT_CODE, resultCode).putExtra(CaptureService.EXTRA_RESULT_DATA, data)
        ContextCompat.startForegroundService(context, i)
    }

    val projectionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        if (res.resultCode == Activity.RESULT_OK && res.data != null) startService(res.resultCode, res.data)
        else TranscriptRepository.update { it.copy(error = "Captura do áudio do aparelho não autorizada.") }
    }
    val audioPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) { TranscriptRepository.update { it.copy(error = "Permissão de microfone/áudio negada.") }; return@rememberLauncherForActivityResult }
        if (settings.audioSource == AudioSource.MICROPHONE) startService()
        else projectionLauncher.launch(context.getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent())
    }
    val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { pendingStart = true }

    fun start() {
        TranscriptRepository.update { it.copy(error = null) }
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS); return
        }
        audioPermission.launch(Manifest.permission.RECORD_AUDIO)
    }
    LaunchedEffect(pendingStart) { if (pendingStart) { pendingStart = false; audioPermission.launch(Manifest.permission.RECORD_AUDIO) } }

    val running = state.capture != CaptureState.IDLE && state.capture != CaptureState.ERROR
    val overlayOk = SysSettings.canDrawOverlays(context)
    val listState = rememberLazyListState()
    LaunchedEffect(state.cards.size, state.partial) { if (state.cards.isNotEmpty()) listState.animateScrollToItem(state.cards.size) }

    Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 10.dp)) {
            Text("Video Translate", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.width(6.dp))
            Text("v$version", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.weight(1f))
            TextButton(onClick = { showSettings = true }) { Text("⚙ Configurações") }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            val dotColor = when (state.capture) { CaptureState.LISTENING -> MaterialTheme.colorScheme.primary; CaptureState.ERROR -> Color(0xFFE0533E); CaptureState.IDLE -> Color.Gray; else -> Color(0xFFFFB347) }
            Box(Modifier.size(9.dp).background(dotColor, CircleShape))
            Spacer(Modifier.width(8.dp))
            Text(state.statusText, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
            if (state.translatorName.isNotEmpty()) Text(state.translatorName, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        state.progress?.let { LinearProgressIndicator(progress = { it }, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) }
        if (state.capture == CaptureState.LISTENING) LinearProgressIndicator(progress = { state.level }, modifier = Modifier.fillMaxWidth().height(3.dp))
        state.error?.let { Text(it, color = Color(0xFFE0533E), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(vertical = 4.dp)) }
        if (!overlayOk) {
            TextButton(onClick = { context.startActivity(Intent(SysSettings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))) }) {
                Text("Permitir painel flutuante sobre outros apps (para ler as legendas no YouTube)")
            }
        }

        LazyColumn(state = listState, modifier = Modifier.weight(1f).fillMaxWidth(), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 90.dp)) {
            if (state.cards.isEmpty() && state.partial.isEmpty()) item {
                Text(
                    if (running) "Ouvindo… toque o vídeo em outro app (YouTube, Chrome). As frases aparecem aqui e no painel flutuante."
                    else "Toque em Iniciar, autorize a captura do áudio e abra o vídeo. Funciona com fone de ouvido: o app lê o áudio que o aparelho está tocando. Prime Video e Netflix bloqueiam a captura (saem mudos).",
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 40.dp, start = 8.dp, end = 8.dp),
                )
            }
            items(state.cards, key = { it.id }) { c ->
                Card(Modifier.fillMaxWidth().padding(vertical = 5.dp), shape = RoundedCornerShape(10.dp)) {
                    Column(Modifier.padding(10.dp)) {
                        Text(c.en, fontSize = settings.fontSp.sp, lineHeight = (settings.fontSp * 1.35).sp)
                        Text(c.pt ?: c.error?.let { "tradução falhou: $it" } ?: "…", fontSize = (settings.fontSp * 0.95).sp, lineHeight = (settings.fontSp * 1.3).sp, color = if (c.error != null) Color(0xFFE0533E) else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
                    }
                }
            }
            if (state.partial.isNotEmpty()) item {
                Text(state.partial, fontSize = settings.fontSp.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, fontStyle = androidx.compose.ui.text.font.FontStyle.Italic, modifier = Modifier.padding(6.dp))
            }
        }
    }
    Box(Modifier.fillMaxSize().padding(bottom = 24.dp), contentAlignment = Alignment.BottomCenter) {
        Button(
            onClick = { if (running) CaptureService.stop(context) else start() },
            colors = ButtonDefaults.buttonColors(containerColor = if (running) Color(0xFFC0392B) else MaterialTheme.colorScheme.primary),
            modifier = Modifier.width(200.dp).height(52.dp),
        ) { Text(if (running) "Parar" else "Iniciar", fontSize = 17.sp) }
    }

    if (showSettings) SettingsDialog(settings, onDismiss = { showSettings = false }) { s ->
        settings = s; Settings.save(context, s); showSettings = false
    }
    activity.hashCode() // mantém a referência (evita warning de variável não usada)
}

@Composable
fun SettingsDialog(initial: Settings, onDismiss: () -> Unit, onSave: (Settings) -> Unit) {
    var s by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = { onSave(s) }) { Text("Salvar") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar") } },
        title = { Text("Configurações") },
        text = {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Fonte de áudio", style = MaterialTheme.typography.labelLarge)
                RadioRow("Áudio do aparelho (funciona com fone; YouTube, Chrome)", s.audioSource == AudioSource.INTERNAL) { s = s.copy(audioSource = AudioSource.INTERNAL) }
                RadioRow("Microfone", s.audioSource == AudioSource.MICROPHONE) { s = s.copy(audioSource = AudioSource.MICROPHONE) }

                Text("Modelo de transcrição (vale na próxima captura)", style = MaterialTheme.typography.labelLarge)
                SttModel.entries.forEach { m -> RadioRow("${m.label} · ~${m.sizeMb} MB", s.sttModel == m) { s = s.copy(sttModel = m) } }

                Text("Separação de frases", style = MaterialTheme.typography.labelLarge)
                VadProfile.entries.forEach { p -> RadioRow("${p.label}: pausa ${p.silenceMs} ms, até ${p.maxSegmentMs / 1000} s", s.vadProfile == p) { s = s.copy(vadProfile = p) } }

                Text("Tamanho da fonte: ${s.fontSp}", style = MaterialTheme.typography.labelLarge)
                Slider(value = s.fontSp.toFloat(), onValueChange = { s = s.copy(fontSp = it.toInt()) }, valueRange = 12f..32f)

                Text("Tradução", style = MaterialTheme.typography.labelLarge)
                Text("Padrão: ML Kit no aparelho (baixa ~30 MB uma vez, offline). Opcional: LibreTranslate na sua rede (use o IP do computador).", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(s.libreUrl, { s = s.copy(libreUrl = it) }, label = { Text("URL do LibreTranslate (opcional)") }, placeholder = { Text("http://192.168.0.10:5000") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(s.libreApiKey, { s = s.copy(libreApiKey = it) }, label = { Text("Chave (opcional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())

                Text("Painel flutuante", style = MaterialTheme.typography.labelLarge)
                Row(verticalAlignment = Alignment.CenterVertically) { Switch(s.overlayEnabled, { s = s.copy(overlayEnabled = it) }); Spacer(Modifier.width(8.dp)); Text("Mostrar sobre outros apps") }
                Text("Opacidade: ${(s.overlayOpacity * 100).toInt()}%"); Slider(s.overlayOpacity, { s = s.copy(overlayOpacity = it) }, valueRange = 0.3f..1f)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Frases no painel: "); listOf(1, 2, 3).forEach { n -> RadioButton(s.overlayLines == n, { s = s.copy(overlayLines = n) }); Text("$n ") }
                }
            }
        },
    )
}

@Composable
private fun RadioRow(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) { RadioButton(selected, onClick); Text(label, style = MaterialTheme.typography.bodyMedium) }
}
