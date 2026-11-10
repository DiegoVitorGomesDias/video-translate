// Captura pelo microfone: getUserMedia → AudioWorklet (mono 16 kHz) → VAD → STT local.
// Mesmo pipeline do documento offscreen da extensão, sem chrome.*.

import workletUrl from '@/lib/audio/pcm-worklet.ts?worker&url';
import { PCM_WORKLET_NAME, TARGET_SAMPLE_RATE } from '@/lib/audio/constants';
import { EnergyVad } from '@/lib/audio/vad';
import { LocalTransformersProvider } from '@/lib/stt/local-transformers';
import { candidatesFor } from '@/lib/stt/models';
import type { SpeechProvider, SpeechProviderStatus, TranscriptResult } from '@/lib/stt/SpeechProvider';
import type { SttModelId } from '@/lib/messages';

const PARTIAL_INTERVAL_MS = 1500;
const PARTIAL_MIN_MS = 1000;

export interface MicCaptureHandlers {
  onStatus: (s: SpeechProviderStatus) => void;
  onResult: (r: TranscriptResult) => void;
  onLevel?: (rms: number, isSpeech: boolean) => void;
  onError: (message: string) => void;
}

export function resolveAsset(path: string): string {
  // Base do Vite (ex.: /video-translate/) + caminho público sem a barra inicial.
  return new URL(import.meta.env.BASE_URL + path.replace(/^\//, ''), location.href).href;
}

export class MicCapture {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private vad: EnergyVad | null = null;
  private provider: SpeechProvider | null = null;
  private partialTimer = 0;
  private wakeLock: { release(): Promise<void> } | null = null;

  get running(): boolean {
    return this.stream !== null;
  }

  async start(model: SttModelId, h: MicCaptureHandlers): Promise<void> {
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    });

    const ctx = new AudioContext();
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(workletUrl);
    const source = ctx.createMediaStreamSource(this.stream);
    const worklet = new AudioWorkletNode(ctx, PCM_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { targetSampleRate: TARGET_SAMPLE_RATE, blockSize: 1024 },
    });
    source.connect(worklet);
    worklet.connect(ctx.destination); // saída é silêncio; só garante que process() rode
    this.worklet = worklet;

    const vad = new EnergyVad({ sampleRate: TARGET_SAMPLE_RATE, silenceMs: 400, maxSegmentMs: 6000 });
    this.vad = vad;
    const provider = new LocalTransformersProvider({ candidates: candidatesFor(model), resolveUrl: resolveAsset });
    this.provider = provider;
    provider.onStatus = h.onStatus;
    provider.onResult = h.onResult;
    vad.onLevel = (rms, isSpeech) => h.onLevel?.(rms, isSpeech);

    let ready = false;
    vad.onSegment = (seg) => {
      if (ready) provider.transcribe(seg);
    };
    let lastPartialAt = 0;
    vad.onSpeechStart = () => {
      lastPartialAt = performance.now();
    };
    this.partialTimer = window.setInterval(() => {
      if (!ready || !vad.isSpeaking || vad.currentDurationMs < PARTIAL_MIN_MS) return;
      if (performance.now() - lastPartialAt < PARTIAL_INTERVAL_MS - 50) return;
      const audio = vad.peek();
      if (!audio) return;
      lastPartialAt = performance.now();
      provider.transcribePartial(vad.currentSegmentId, audio, TARGET_SAMPLE_RATE);
    }, 250);
    worklet.port.onmessage = (e: MessageEvent<Float32Array>) => vad.push(e.data);

    if (ctx.state === 'suspended') await ctx.resume();
    void this.requestWakeLock();

    try {
      await provider.start();
      ready = true;
    } catch (err) {
      h.onError(err instanceof Error ? err.message : String(err));
    }
  }

  async stop(): Promise<void> {
    window.clearInterval(this.partialTimer);
    this.vad?.flush();
    if (this.worklet) this.worklet.port.onmessage = null;
    this.worklet?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => undefined);
    await this.provider?.stop();
    await this.wakeLock?.release().catch(() => undefined);
    this.stream = null;
    this.ctx = null;
    this.worklet = null;
    this.vad = null;
    this.provider = null;
    this.wakeLock = null;
  }

  private async requestWakeLock(): Promise<void> {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    if (!nav.wakeLock) return;
    try {
      this.wakeLock = await nav.wakeLock.request('screen');
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.running && !this.wakeLock) void this.requestWakeLock();
      });
      this.wakeLock.release = ((orig) => async () => {
        await orig();
        this.wakeLock = null;
      })(this.wakeLock.release.bind(this.wakeLock));
    } catch {
      /* sem wake lock */
    }
  }
}
