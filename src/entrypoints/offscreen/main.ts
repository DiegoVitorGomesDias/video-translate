// Documento offscreen: único contexto da extensão que pode usar getUserMedia com o
// stream da aba. Captura o áudio, mantém o som tocando, converte para 16 kHz mono,
// segmenta por silêncio e manda cada trecho para o provedor de transcrição.

import { isOffscreenMessage, type BackgroundMessage, type OffscreenMessage } from '@/lib/messages';
import { PCM_WORKLET_NAME, TARGET_SAMPLE_RATE } from '@/lib/audio/constants';
import { EnergyVad } from '@/lib/audio/vad';
import { LocalTransformersProvider } from '@/lib/stt/local-transformers';
import type { SpeechProvider } from '@/lib/stt/SpeechProvider';

interface CaptureSession {
  stream: MediaStream;
  ctx: AudioContext;
  source: MediaStreamAudioSourceNode;
  worklet: AudioWorkletNode;
  vad: EnergyVad;
  provider: SpeechProvider;
  tabId: number;
}

let session: CaptureSession | null = null;
let workletLoaded: Promise<void> | null = null;

const log = (...args: unknown[]) => console.log('[offscreen]', ...args);

function notifyBackground(msg: BackgroundMessage): void {
  browser.runtime.sendMessage(msg).catch(() => {
    /* background pode estar dormindo; não é crítico na fase 0 */
  });
}

async function ensureWorklet(ctx: AudioContext): Promise<void> {
  workletLoaded ??= ctx.audioWorklet.addModule(browser.runtime.getURL('/pcm-worklet.js'));
  return workletLoaded;
}

async function startCapture(streamId: string, tabId: number): Promise<void> {
  if (session) {
    log('já capturando; parando a sessão anterior');
    await stopCapture();
  }
  log(`iniciando captura da aba ${tabId}`);

  // 1. Stream da aba a partir do streamId obtido no background.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  } as unknown as MediaStreamConstraints);

  // 2. Contexto de áudio na taxa nativa; o som volta para os alto-falantes.
  const ctx = new AudioContext();
  await ensureWorklet(ctx);
  const source = ctx.createMediaStreamSource(stream);
  source.connect(ctx.destination);

  // 3. Worklet: mono 16 kHz em blocos de ~64 ms.
  const worklet = new AudioWorkletNode(ctx, PCM_WORKLET_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { targetSampleRate: TARGET_SAMPLE_RATE, blockSize: 1024 },
  });
  source.connect(worklet);
  worklet.connect(ctx.destination); // saída é silêncio; só garante que process() rode

  // 4. VAD por energia + provedor local.
  const vad = new EnergyVad({ sampleRate: TARGET_SAMPLE_RATE, silenceMs: 400, maxSegmentMs: 8000 });
  const provider = new LocalTransformersProvider({ resolveUrl: (p) => browser.runtime.getURL(p as never) });

  provider.onStatus = (s) => {
    if (s.state === 'loading' && s.progress !== undefined) {
      log(`modelo: ${s.message} ${s.progress.toFixed(0)}%`);
    } else {
      log(`modelo [${s.state}]: ${s.message ?? ''}`);
    }
  };
  provider.onResult = (r) => {
    console.log(
      `%c[transcrição] %c${r.text || '(vazio)'}`,
      'color:#0a7;font-weight:bold',
      'color:inherit',
      `\n   áudio ${r.audioMs.toFixed(0)} ms | inferência ${r.inferenceMs.toFixed(0)} ms | latência total ${r.latencyMs.toFixed(0)} ms`,
    );
  };

  let pendingSegments = 0;
  vad.onSegment = (seg) => {
    pendingSegments++;
    log(`trecho fechado (${seg.reason}) ${seg.durationMs.toFixed(0)} ms, fila=${pendingSegments}`);
    provider.transcribe(seg);
  };
  const origOnResult = provider.onResult;
  provider.onResult = (r) => {
    pendingSegments = Math.max(0, pendingSegments - 1);
    origOnResult?.(r);
  };

  worklet.port.onmessage = (e: MessageEvent<Float32Array>) => vad.push(e.data);

  // Se a aba parar de compartilhar (fechou, mudou de página), encerra.
  stream.getAudioTracks()[0]?.addEventListener('ended', () => {
    log('track de áudio terminou; encerrando');
    void stopCapture();
  });

  session = { stream, ctx, source, worklet, vad, provider, tabId };

  if (ctx.state === 'suspended') await ctx.resume();
  log(`áudio ligado: contexto a ${ctx.sampleRate} Hz, som da aba restaurado`);
  notifyBackground({ type: 'capture-status', status: 'started' });

  // O modelo carrega em paralelo; o áudio já está tocando e sendo segmentado.
  try {
    const t0 = performance.now();
    await provider.start();
    log(`provedor pronto em ${(performance.now() - t0).toFixed(0)} ms`);
  } catch (err) {
    console.error('[offscreen] falha ao carregar o modelo:', err);
    notifyBackground({ type: 'capture-status', status: 'error', error: String(err) });
  }
}

async function stopCapture(): Promise<void> {
  if (!session) return;
  const s = session;
  session = null;
  log('parando captura');
  s.vad.flush();
  s.worklet.port.onmessage = null;
  s.source.disconnect();
  s.worklet.disconnect();
  s.stream.getTracks().forEach((t) => t.stop());
  await s.ctx.close();
  await s.provider.stop();
  notifyBackground({ type: 'capture-status', status: 'stopped' });
}

browser.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (!isOffscreenMessage(msg)) return;
  const m: OffscreenMessage = msg;
  const run = async () => {
    switch (m.type) {
      case 'start-capture':
        await startCapture(m.streamId, m.tabId);
        return { ok: true };
      case 'stop-capture':
        await stopCapture();
        return { ok: true };
    }
  };
  run()
    .then(sendResponse)
    .catch((err) => {
      console.error('[offscreen] erro:', err);
      notifyBackground({ type: 'capture-status', status: 'error', error: String(err) });
      sendResponse({ ok: false, error: String(err) });
    });
  return true; // resposta assíncrona
});

log('documento offscreen carregado');

// Modo de autoteste: abrir chrome-extension://<id>/offscreen.html?selftest numa aba
// carrega o modelo sem capturar áudio, para checar o runtime ONNX e o download.
if (new URLSearchParams(location.search).has('selftest')) {
  void (async () => {
    log('SELFTEST: carregando o modelo sem captura');
    const provider = new LocalTransformersProvider({ resolveUrl: (p) => browser.runtime.getURL(p as never) });
    provider.onStatus = (s) => log(`SELFTEST modelo [${s.state}]: ${s.message ?? ''}${s.progress !== undefined ? ` ${s.progress.toFixed(0)}%` : ''}`);
    provider.onResult = (r) => log(`SELFTEST resultado: "${r.text}" (inferência ${r.inferenceMs.toFixed(0)} ms)`);
    try {
      const t0 = performance.now();
      await provider.start();
      log(`SELFTEST OK: provedor pronto em ${(performance.now() - t0).toFixed(0)} ms`);
      // 1 s de tom de 440 Hz só para exercitar a inferência (deve dar texto vazio ou lixo).
      const audio = new Float32Array(TARGET_SAMPLE_RATE);
      for (let i = 0; i < audio.length; i++) audio[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / TARGET_SAMPLE_RATE);
      provider.transcribe({ audio, sampleRate: TARGET_SAMPLE_RATE, durationMs: 1000, endedAt: performance.now(), reason: 'flush' });
    } catch (err) {
      console.error('[offscreen] SELFTEST FALHOU:', err);
    }
  })();
}
