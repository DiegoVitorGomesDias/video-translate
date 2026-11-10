// Captura pelo microfone: getUserMedia → AudioWorklet (mono 16 kHz) → VAD → STT local.
// Mesmo pipeline do documento offscreen da extensão, sem chrome.*.

import workletUrl from '@/lib/audio/pcm-worklet.ts?worker&url';
import { PCM_WORKLET_NAME, TARGET_SAMPLE_RATE } from '@/lib/audio/constants';
import { EnergyVad, VAD_PROFILES, type VadProfile } from '@/lib/audio/vad';
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
  /** Microfone em uso mudou (início ou troca automática ao conectar/desconectar fone). */
  onDevice?: (device: MicDevice | null) => void;
}

export interface MicDevice {
  deviceId: string;
  label: string;
  /** Parece um fone/headset (Bluetooth, com fio, USB) e não o microfone do aparelho. */
  isHeadset: boolean;
}

const HEADSET_RE = /bluetooth|headset|headphone|earphone|fone|airpod|buds|wired|usb|hands-?free|sco|hfp|external/i;
const BUILTIN_RE = /built-?in|internal|interno|integrad|phone|bottom|front|back|top|speaker|default|padr/i;

/** Lista os microfones (rótulos só aparecem depois da permissão). */
export async function listMicrophones(): Promise<MicDevice[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microfone ${i + 1}`, isHeadset: HEADSET_RE.test(d.label) && !BUILTIN_RE.test(d.label) }));
}

/**
 * Escolhe o microfone: o pedido nas configurações, se existir; senão o microfone do
 * próprio aparelho (evita o microfone do fone Bluetooth/com fio, que fica longe do som
 * e, no Bluetooth, derruba a qualidade do áudio).
 */
export function pickMicrophone(devices: MicDevice[], preferredId: string): MicDevice | null {
  if (devices.length === 0) return null;
  if (preferredId) {
    const chosen = devices.find((d) => d.deviceId === preferredId);
    if (chosen) return chosen;
  }
  const builtin = devices.find((d) => !d.isHeadset && d.deviceId !== 'default' && d.deviceId !== 'communications');
  return builtin ?? devices.find((d) => !d.isHeadset) ?? devices[0]!;
}

export function resolveAsset(path: string): string {
  // Base do Vite (ex.: /video-translate/) + caminho público sem a barra inicial.
  return new URL(import.meta.env.BASE_URL + path.replace(/^\//, ''), location.href).href;
}

export class MicCapture {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private handlers: MicCaptureHandlers | null = null;
  private preferredId = '';
  private current: MicDevice | null = null;
  private onDeviceChange: (() => void) | null = null;
  private vad: EnergyVad | null = null;
  private provider: SpeechProvider | null = null;
  private partialTimer = 0;
  private wakeLock: { release(): Promise<void> } | null = null;

  get running(): boolean {
    return this.stream !== null;
  }

  get device(): MicDevice | null {
    return this.current;
  }

  async start(model: SttModelId, h: MicCaptureHandlers, preferredMicId = '', profile: VadProfile = 'normal'): Promise<void> {
    if (this.running) return;
    this.handlers = h;
    this.preferredId = preferredMicId;
    this.stream = await this.openStream();

    const ctx = new AudioContext();
    this.ctx = ctx;
    await ctx.audioWorklet.addModule(workletUrl);
    const source = ctx.createMediaStreamSource(this.stream);
    this.source = source;
    const worklet = new AudioWorkletNode(ctx, PCM_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { targetSampleRate: TARGET_SAMPLE_RATE, blockSize: 1024 },
    });
    source.connect(worklet);
    worklet.connect(ctx.destination); // saída é silêncio; só garante que process() rode
    this.worklet = worklet;

    const vp = VAD_PROFILES[profile] ?? VAD_PROFILES.normal;
    const vad = new EnergyVad({ sampleRate: TARGET_SAMPLE_RATE, silenceMs: vp.silenceMs, maxSegmentMs: vp.maxSegmentMs });
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

    // Fone conectado/desconectado: refaz a escolha do microfone sem parar a transcrição.
    this.onDeviceChange = () => void this.reopenIfDeviceChanged();
    navigator.mediaDevices.addEventListener('devicechange', this.onDeviceChange);

    try {
      await provider.start();
      ready = true;
    } catch (err) {
      h.onError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Troca o microfone durante a captura (ou volta ao automático com ''). */
  async switchMicrophone(deviceId: string): Promise<void> {
    this.preferredId = deviceId;
    if (this.running) await this.reopenIfDeviceChanged(true);
  }

  private async openStream(): Promise<MediaStream> {
    const base: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    // Primeiro pedido genérico: libera os rótulos dos dispositivos para poder escolher.
    let devices = await listMicrophones();
    const labelsKnown = devices.some((d) => d.label && !/^Microfone \d+$/.test(d.label));
    if (!labelsKnown) {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: base, video: false });
      devices = await listMicrophones();
      const wanted = pickMicrophone(devices, this.preferredId);
      const probeId = probe.getAudioTracks()[0]?.getSettings().deviceId;
      if (!wanted || wanted.deviceId === probeId) {
        this.setCurrent(devices, probeId);
        return probe;
      }
      probe.getTracks().forEach((t) => t.stop());
    }
    const wanted = pickMicrophone(devices, this.preferredId);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: wanted ? { ...base, deviceId: { exact: wanted.deviceId } } : base,
      video: false,
    });
    this.setCurrent(devices, stream.getAudioTracks()[0]?.getSettings().deviceId);
    return stream;
  }

  private setCurrent(devices: MicDevice[], deviceId: string | undefined): void {
    this.current = devices.find((d) => d.deviceId === deviceId) ?? (deviceId ? { deviceId, label: 'Microfone', isHeadset: false } : null);
    this.handlers?.onDevice?.(this.current);
  }

  private async reopenIfDeviceChanged(force = false): Promise<void> {
    if (!this.running || !this.ctx || !this.worklet) return;
    try {
      const devices = await listMicrophones();
      const wanted = pickMicrophone(devices, this.preferredId);
      const currentId = this.stream?.getAudioTracks()[0]?.getSettings().deviceId;
      const trackAlive = this.stream?.getAudioTracks()[0]?.readyState === 'live';
      if (!force && trackAlive && wanted && wanted.deviceId === currentId) return;
      const stream = await this.openStream();
      this.source?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = stream;
      this.source = this.ctx.createMediaStreamSource(stream);
      this.source.connect(this.worklet);
    } catch (err) {
      this.handlers?.onError(`não consegui trocar o microfone: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async stop(): Promise<void> {
    if (this.onDeviceChange) navigator.mediaDevices.removeEventListener('devicechange', this.onDeviceChange);
    this.onDeviceChange = null;
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
    this.source = null;
    this.worklet = null;
    this.current = null;
    this.handlers?.onDevice?.(null);
    this.handlers = null;
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
