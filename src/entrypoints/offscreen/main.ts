// Documento offscreen: único contexto da extensão que pode usar getUserMedia com o
// stream da aba. Captura o áudio, mantém o som tocando, converte para 16 kHz mono,
// segmenta por silêncio e manda cada trecho para o provedor de transcrição.
// Os resultados são transmitidos por runtime.sendMessage para o background e o viewer.

import {
  type AppliedConfig,
  isOffscreenMessage,
  type BroadcastEvent,
  type GetTranscriptsResponse,
  type OffscreenMessage,
  type SttEngineId,
  type SttModelId,
  type SttStatusEvent,
  type VadProfileId,
  type TranscriptEvent,
} from '@/lib/messages';
import { PCM_WORKLET_NAME, TARGET_SAMPLE_RATE } from '@/lib/audio/constants';
import { SileroVad } from '@/lib/audio/silero-vad';
import { VAD_PROFILES } from '@/lib/audio/vad';
import { extractTermsFromTitle, mergeTerms, parseGlossary } from '@/lib/context';
import { watchOptions, type Options } from '@/lib/options';
import { ChromeSpeechProvider } from '@/lib/stt/chrome-speech';
import { LocalTransformersProvider } from '@/lib/stt/local-transformers';
import { candidatesFor } from '@/lib/stt/models';
import type { SpeechProvider, TranscriptResult } from '@/lib/stt/SpeechProvider';

/** Intervalo entre transcrições parciais de um trecho aberto. */
const PARTIAL_INTERVAL_MS = 1500;
/** Trecho precisa ter pelo menos isso de áudio para valer um parcial. */
const PARTIAL_MIN_MS = 1000;
const HISTORY_LIMIT = 500;

interface CaptureSession {
  stream: MediaStream;
  ctx: AudioContext;
  source: MediaStreamAudioSourceNode;
  worklet: AudioWorkletNode;
  vad: SileroVad;
  provider: SpeechProvider;
  tabId: number;
  partialTimer: number;
  /** Atualiza o glossário do provedor (título da aba + opções). */
  setTabTitle: (title: string) => void;
  /** Para de observar as opções. */
  unwatch: () => void;
}

let session: CaptureSession | null = null;
let workletLoaded: Promise<void> | null = null;

// Histórico para o viewer que abrir depois do início.
const finals: TranscriptEvent[] = [];
let lastPartial: TranscriptEvent | null = null;
let lastStatus: SttStatusEvent | null = null;
let applied: AppliedConfig | null = null;

const log = (...args: unknown[]) => console.log('[offscreen]', ...args);

function broadcast(event: BroadcastEvent): void {
  browser.runtime.sendMessage(event).catch(() => {
    /* ninguém escutando (viewer fechado, background dormindo); não é crítico */
  });
}

async function ensureWorklet(ctx: AudioContext): Promise<void> {
  workletLoaded ??= ctx.audioWorklet.addModule(browser.runtime.getURL('/pcm-worklet.js'));
  return workletLoaded;
}

function toEvent(r: TranscriptResult): TranscriptEvent {
  return {
    type: 'transcript',
    segmentId: r.segmentId,
    text: r.text,
    isFinal: r.isFinal,
    reason: r.reason,
    audioEndedAt: r.audioEndedAt,
    readyAt: Date.now(),
    latencyMs: r.latencyMs,
    inferenceMs: r.inferenceMs,
    audioMs: r.audioMs,
  };
}

function handleResult(r: TranscriptResult): void {
  const ev = toEvent(r);
  if (r.isFinal) {
    finals.push(ev);
    if (finals.length > HISTORY_LIMIT) finals.shift();
    if (lastPartial?.segmentId === r.segmentId) lastPartial = null;
    console.log(
      `%c[transcrição] %c${r.text || '(vazio)'}`,
      'color:#0a7;font-weight:bold',
      'color:inherit',
      `\n   áudio ${r.audioMs.toFixed(0)} ms | inferência ${r.inferenceMs.toFixed(0)} ms | latência total ${r.latencyMs.toFixed(0)} ms`,
    );
  } else {
    // Parcial atrasado de um trecho já fechado: descarta.
    if (finals.some((f) => f.segmentId === r.segmentId)) return;
    lastPartial = ev;
    console.log(`%c[parcial #${r.segmentId}] %c${r.text}`, 'color:#999', 'color:#999;font-style:italic', `(${r.inferenceMs.toFixed(0)} ms)`);
  }
  broadcast(ev);
}

const resolveUrl = (p: string) => browser.runtime.getURL(p as never);

function createProvider(model: SttModelId, engine: SttEngineId = 'local'): SpeechProvider {
  const provider: SpeechProvider =
    engine === 'chrome'
      ? new ChromeSpeechProvider()
      : new LocalTransformersProvider({
          candidates: candidatesFor(model),
          resolveUrl,
        });
  provider.onStatus = (s) => {
    lastStatus = { type: 'stt-status', ...s };
    if (s.state === 'loading' && s.progress !== undefined) log(`modelo: ${s.message} ${s.progress.toFixed(0)}%`);
    else log(`modelo [${s.state}]: ${s.message ?? ''}`);
    broadcast(lastStatus);
  };
  provider.onResult = handleResult;
  return provider;
}

async function startCapture(streamId: string, tabId: number, model: SttModelId, engine: SttEngineId, profile: VadProfileId, tabTitle: string): Promise<void> {
  if (session) {
    log('já capturando; parando a sessão anterior');
    await stopCapture();
  }
  log(`iniciando captura da aba ${tabId} (motor ${engine}, modelo ${model}, separação ${profile})`);
  finals.length = 0;
  lastPartial = null;
  applied = { sttModel: model, vadProfile: profile, sttEngine: engine, activeEngine: engine };

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

  // 4. VAD (Silero, com reserva por energia) + provedor.
  const vp = VAD_PROFILES[profile] ?? VAD_PROFILES.normal;
  const vad = new SileroVad({ sampleRate: TARGET_SAMPLE_RATE, silenceMs: vp.silenceMs, maxSegmentMs: vp.maxSegmentMs, resolveUrl });
  vad.onEngine = (vadEngine, message) => {
    log(`detector de fala: ${vadEngine}${message ? ` (${message})` : ''}`);
    if (applied) {
      applied = { ...applied, vadEngine };
      broadcast({ type: 'capture-status', status: 'started', applied });
    }
  };
  let provider = createProvider(model, engine);

  let providerReady = false;
  let pendingSegments = 0;
  const wrapResult = (p: SpeechProvider) => {
    const base = p.onResult;
    p.onResult = (r) => {
      if (r.isFinal) pendingSegments = Math.max(0, pendingSegments - 1);
      base?.(r);
    };
  };
  wrapResult(provider);
  vad.onSegment = (seg) => {
    if (provider.consumesStream) return;
    pendingSegments++;
    log(`trecho #${seg.id} fechado (${seg.reason}) ${seg.durationMs.toFixed(0)} ms, fila=${pendingSegments}`);
    provider.transcribe(seg);
  };

  // Parciais: a cada 1,5 s, se há um trecho aberto com áudio suficiente.
  let lastPartialAt = 0;
  let peeking = false;
  const partialTimer = window.setInterval(() => {
    if (!providerReady || provider.consumesStream || peeking) return;
    if (!vad.isSpeaking || vad.currentDurationMs < PARTIAL_MIN_MS) return;
    if (performance.now() - lastPartialAt < PARTIAL_INTERVAL_MS - 50) return;
    const segmentId = vad.currentSegmentId;
    peeking = true;
    void vad.peek().then((audio) => {
      peeking = false;
      if (!audio || !session) return;
      lastPartialAt = performance.now();
      provider.transcribePartial(segmentId, audio, TARGET_SAMPLE_RATE);
    });
  }, 250);
  vad.onSpeechStart = () => {
    lastPartialAt = performance.now(); // primeiro parcial só depois do intervalo
  };

  worklet.port.onmessage = (e: MessageEvent<Float32Array>) => vad.push(e.data);

  // Glossário (título da aba + opções) para o reconhecimento do Chrome.
  let currentTitle = tabTitle;
  let currentOptions: Options | null = null;
  const applyPhrases = () => {
    if (!provider.setPhrases) return;
    const auto = currentOptions?.useTabContext === false ? [] : extractTermsFromTitle(currentTitle);
    const terms = mergeTerms(parseGlossary(currentOptions?.glossary ?? ''), auto);
    provider.setPhrases(terms);
    log(`glossário do reconhecimento: ${terms.join(', ') || '(vazio)'}`);
  };
  const unwatchOptions = watchOptions((o) => {
    currentOptions = o;
    applyPhrases();
  });
  const setTabTitle = (title: string) => {
    currentTitle = title;
    applyPhrases();
  };

  // Se a aba parar de compartilhar (fechou, mudou de página), encerra.
  const track = stream.getAudioTracks()[0];
  track?.addEventListener('ended', () => {
    log('track de áudio terminou; encerrando');
    void stopCapture();
  });

  session = { stream, ctx, source, worklet, vad, provider, tabId, partialTimer, setTabTitle, unwatch: unwatchOptions };

  if (ctx.state === 'suspended') await ctx.resume();
  log(`áudio ligado: contexto a ${ctx.sampleRate} Hz, som da aba restaurado`);
  broadcast({ type: 'capture-status', status: 'started', applied: applied ?? undefined });

  // O modelo carrega em paralelo; o áudio já está tocando e sendo segmentado.
  const startProvider = async (p: SpeechProvider): Promise<void> => {
    const t0 = performance.now();
    if (p.consumesStream && track) p.attachTrack?.(track);
    await p.start();
    providerReady = true;
    applyPhrases();
    log(`provedor ${p.name} pronto em ${(performance.now() - t0).toFixed(0)} ms`);
  };
  try {
    await startProvider(provider);
  } catch (err) {
    if (engine === 'chrome' && session) {
      // Reconhecimento do Chrome indisponível: cai para o modelo local sem parar a captura.
      console.warn('[offscreen] reconhecimento do Chrome indisponível, usando o modelo local:', err);
      await provider.stop().catch(() => undefined);
      provider = createProvider(model, 'local');
      wrapResult(provider);
      session.provider = provider;
      applied = { ...applied!, activeEngine: 'local' };
      broadcast({ type: 'capture-status', status: 'started', applied });
      try {
        await startProvider(provider);
      } catch (err2) {
        console.error('[offscreen] falha ao carregar o modelo:', err2);
        broadcast({ type: 'capture-status', status: 'error', error: String(err2) });
      }
      return;
    }
    console.error('[offscreen] falha ao carregar o modelo:', err);
    broadcast({ type: 'capture-status', status: 'error', error: String(err) });
  }
}

async function stopCapture(): Promise<void> {
  if (!session) return;
  const s = session;
  session = null;
  log('parando captura');
  window.clearInterval(s.partialTimer);
  s.unwatch();
  s.worklet.port.onmessage = null;
  // O provedor vai ser encerrado já; um último trecho não teria tempo de ser transcrito.
  s.vad.onSegment = null;
  s.vad.dispose();
  s.source.disconnect();
  s.worklet.disconnect();
  s.stream.getTracks().forEach((t) => t.stop());
  await s.ctx.close();
  await s.provider.stop();
  broadcast({ type: 'capture-status', status: 'stopped' });
}

browser.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (!isOffscreenMessage(msg)) return;
  const m: OffscreenMessage = msg;
  const run = async (): Promise<unknown> => {
    switch (m.type) {
      case 'start-capture':
        await startCapture(m.streamId, m.tabId, m.sttModel, m.sttEngine ?? 'local', m.vadProfile ?? 'normal', m.tabTitle ?? '');
        return { ok: true };
      case 'set-tab-title':
        session?.setTabTitle(m.title);
        return { ok: true };
      case 'stop-capture':
        await stopCapture();
        return { ok: true };
      case 'get-transcripts': {
        const res: GetTranscriptsResponse = { finals: [...finals], partial: lastPartial, status: lastStatus, applied };
        return res;
      }
    }
  };
  run()
    .then(sendResponse)
    .catch((err) => {
      console.error('[offscreen] erro:', err);
      broadcast({ type: 'capture-status', status: 'error', error: String(err) });
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
    const provider = createProvider('moonshine-tiny');
    provider.onResult = (r) => log(`SELFTEST resultado: "${r.text}" (inferência ${r.inferenceMs.toFixed(0)} ms)`);
    try {
      const t0 = performance.now();
      await provider.start();
      log(`SELFTEST OK: provedor pronto em ${(performance.now() - t0).toFixed(0)} ms`);
      // 1 s de tom de 440 Hz só para exercitar a inferência (deve dar texto vazio ou lixo).
      const audio = new Float32Array(TARGET_SAMPLE_RATE);
      for (let i = 0; i < audio.length; i++) audio[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / TARGET_SAMPLE_RATE);
      provider.transcribe({ id: 1, audio, sampleRate: TARGET_SAMPLE_RATE, durationMs: 1000, endedAt: performance.now(), reason: 'flush' });
    } catch (err) {
      console.error('[offscreen] SELFTEST FALHOU:', err);
    }
  })();
}
