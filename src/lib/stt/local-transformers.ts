// Provedor de transcrição local: delega ao Web Worker que roda transformers.js.

import type { AudioSegment } from '@/lib/audio/vad';
import type { SpeechProvider, SpeechProviderStatus, TranscriptResult } from './SpeechProvider';
import type { WorkerInMessage, WorkerOutMessage } from './local-stt.worker';
import { candidatesFor, type SttModelCandidate } from './models';

export interface LocalTransformersOptions {
  candidates?: SttModelCandidate[];
  /** Resolve uma URL pública da extensão (ex.: browser.runtime.getURL). */
  resolveUrl: (path: string) => string;
}

interface Pending {
  segmentId: number;
  isFinal: boolean;
  reason?: AudioSegment['reason'];
  audioEndedAt: number;
  audioMs: number;
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
  private terms: string[] = [];

  constructor(opts: LocalTransformersOptions) {
    this.candidates = opts.candidates ?? candidatesFor('moonshine-tiny');
    this.resolveUrl = opts.resolveUrl;
  }

  start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = this.startSequence();
    return this.ready;
  }

  /** Tenta cada candidato num worker novo; o primeiro que carregar fica. */
  private async startSequence(): Promise<void> {
    const errors: string[] = [];
    for (const candidate of this.candidates) {
      if (candidate.device === 'webgpu' && !('gpu' in navigator)) {
        errors.push(`${candidate.modelId} (webgpu): WebGPU indisponível neste contexto`);
        continue;
      }
      const worker = new Worker(new URL('./local-stt.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      try {
        await this.initWorker(worker, candidate);
        if (this.terms.length > 0) this.post({ type: 'set-terms', terms: this.terms });
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${candidate.modelId} (${candidate.device}): ${msg}`);
        if (this.worker === worker) this.worker = null;
        worker.terminate();
      }
    }
    const message = `Nenhum modelo carregou:\n${errors.join('\n')}`;
    this.onStatus?.({ state: 'error', message });
    throw new Error(message);
  }

  private initWorker(worker: Worker, candidate: SttModelCandidate): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
        const msg = event.data;
        switch (msg.type) {
          case 'status':
            // Erros de um candidato não vão para a UI: o próximo pode carregar.
            if (msg.state !== 'error') this.onStatus?.({ state: msg.state, message: msg.message, progress: msg.progress, device: msg.device, model: msg.model });
            if (msg.state === 'ready') resolve();
            if (msg.state === 'error') reject(new Error(msg.message));
            break;
          case 'result': {
            const p = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (!p) return;
            this.onResult?.({
              segmentId: p.segmentId,
              text: msg.text,
              isFinal: p.isFinal,
              reason: p.reason,
              latencyMs: performance.now() - p.audioEndedAt,
              inferenceMs: msg.inferenceMs,
              audioMs: p.audioMs,
              audioEndedAt: p.audioEndedAt,
            });
            break;
          }
          case 'dropped':
            this.pending.delete(msg.id);
            break;
          case 'error':
            if (msg.id !== undefined) this.pending.delete(msg.id);
            console.error('[stt] erro no worker:', msg.message);
            break;
        }
      };
      worker.onerror = (e) => {
        console.error('[stt] worker falhou:', e.message);
        reject(new Error(e.message));
      };
      const init: WorkerInMessage = {
        type: 'init',
        candidate,
        ortWasmPaths: {
          mjs: this.resolveUrl('/onnx/ort-wasm-simd-threaded.asyncify.mjs'),
          wasm: this.resolveUrl('/onnx/ort-wasm-simd-threaded.asyncify.wasm'),
        },
      };
      worker.postMessage(init);
    });
  }

  /** Glossário para o prompt do Whisper (Moonshine ignora). */
  setPhrases(terms: string[]): void {
    this.terms = terms;
    this.post({ type: 'set-terms', terms });
  }

  transcribe(segment: AudioSegment): void {
    this.send(segment.id, true, segment.audio, segment.sampleRate, segment.endedAt, segment.reason);
  }

  transcribePartial(segmentId: number, audio: Float32Array, sampleRate: number): void {
    this.send(segmentId, false, audio, sampleRate, performance.now());
  }

  private send(segmentId: number, isFinal: boolean, audio: Float32Array, sampleRate: number, audioEndedAt: number, reason?: AudioSegment['reason']): void {
    if (!this.worker) throw new Error('Provider não iniciado');
    const id = this.nextId++;
    this.pending.set(id, { segmentId, isFinal, reason, audioEndedAt, audioMs: (audio.length / sampleRate) * 1000 });
    // Transfere o buffer (zero-copy); o chamador não usa mais esse array.
    this.post({ type: 'transcribe', id, segmentId, isFinal, audio, sampleRate }, [audio.buffer]);
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
