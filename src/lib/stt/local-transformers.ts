// Provedor de transcrição local: delega ao Web Worker que roda transformers.js.

import type { AudioSegment } from '@/lib/audio/vad';
import type { SpeechProvider, SpeechProviderStatus, TranscriptResult } from './SpeechProvider';
import type { SttModelCandidate, WorkerInMessage, WorkerOutMessage } from './local-stt.worker';

export const MOONSHINE_TINY = 'onnx-community/moonshine-tiny-ONNX';
export const WHISPER_TINY_EN = 'onnx-community/whisper-tiny.en';

/** Ordem de tentativa: Moonshine (WebGPU → WASM), depois Whisper tiny.en (WebGPU → WASM). */
export const DEFAULT_CANDIDATES: SttModelCandidate[] = [
  { modelId: MOONSHINE_TINY, device: 'webgpu', dtype: 'fp32' },
  { modelId: MOONSHINE_TINY, device: 'wasm', dtype: 'q8' },
  { modelId: WHISPER_TINY_EN, device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'fp32' } },
  { modelId: WHISPER_TINY_EN, device: 'wasm', dtype: 'q8' },
];

export interface LocalTransformersOptions {
  candidates?: SttModelCandidate[];
  /** Resolve uma URL pública da extensão (ex.: browser.runtime.getURL). */
  resolveUrl: (path: string) => string;
}

interface Pending {
  segment: AudioSegment;
  sentAt: number;
}

export class LocalTransformersProvider implements SpeechProvider {
  readonly name = 'local-transformers';
  onResult: ((result: TranscriptResult) => void) | null = null;
  onStatus: ((status: SpeechProviderStatus) => void) | null = null;

  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private ready: Promise<void> | null = null;
  private readonly candidates: SttModelCandidate[];
  private readonly resolveUrl: (path: string) => string;

  constructor(opts: LocalTransformersOptions) {
    this.candidates = opts.candidates ?? DEFAULT_CANDIDATES;
    this.resolveUrl = opts.resolveUrl;
  }

  start(): Promise<void> {
    if (this.ready) return this.ready;

    this.worker = new Worker(new URL('./local-stt.worker.ts', import.meta.url), { type: 'module' });

    this.ready = new Promise<void>((resolve, reject) => {
      this.worker!.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
        const msg = event.data;
        switch (msg.type) {
          case 'status':
            this.onStatus?.({ state: msg.state, message: msg.message, progress: msg.progress, device: msg.device, model: msg.model });
            if (msg.state === 'ready') resolve();
            if (msg.state === 'error') reject(new Error(msg.message));
            break;
          case 'result': {
            const p = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (!p) return;
            const now = performance.now();
            this.onResult?.({
              text: msg.text,
              isFinal: true,
              latencyMs: now - p.segment.endedAt,
              inferenceMs: msg.inferenceMs,
              audioMs: p.segment.durationMs,
              segmentEndedAt: p.segment.endedAt,
            });
            break;
          }
          case 'error':
            if (msg.id !== undefined) this.pending.delete(msg.id);
            console.error('[stt] erro no worker:', msg.message);
            break;
        }
      };
      this.worker!.onerror = (e) => {
        console.error('[stt] worker falhou:', e.message);
        this.onStatus?.({ state: 'error', message: e.message });
        reject(new Error(e.message));
      };
    });

    this.post({
      type: 'init',
      candidates: this.candidates,
      ortWasmPaths: {
        mjs: this.resolveUrl('/onnx/ort-wasm-simd-threaded.asyncify.mjs'),
        wasm: this.resolveUrl('/onnx/ort-wasm-simd-threaded.asyncify.wasm'),
      },
    });

    return this.ready;
  }

  transcribe(segment: AudioSegment): void {
    if (!this.worker) throw new Error('Provider não iniciado');
    const id = this.nextId++;
    this.pending.set(id, { segment, sentAt: performance.now() });
    // Transfere o buffer (zero-copy); o segmento não é mais usado aqui.
    this.post({ type: 'transcribe', id, audio: segment.audio, sampleRate: segment.sampleRate }, [segment.audio.buffer]);
  }

  async stop(): Promise<void> {
    if (!this.worker) return;
    this.post({ type: 'dispose' });
    this.worker = null;
    this.ready = null;
    this.pending.clear();
  }

  private post(msg: WorkerInMessage, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
  }
}
