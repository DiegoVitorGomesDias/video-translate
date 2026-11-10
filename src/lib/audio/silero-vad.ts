// Detector de fala com o modelo Silero VAD rodando num Web Worker, com a mesma
// interface do EnergyVad. Enquanto o modelo carrega os blocos ficam na fila do worker;
// se o modelo não carregar (sem rede na primeira vez, runtime indisponível), cai para
// o detector por energia sem interromper a captura.

import type { SileroInMessage, SileroOutMessage } from './silero-vad.worker';
import { EnergyVad, type AudioSegment, type SegmentBuilderOptions, type SpeechSegmenter } from './vad';

export type VadEngine = 'silero' | 'energy';

export interface SileroVadOptions extends SegmentBuilderOptions {
  /** Resolve a URL dos arquivos do runtime ONNX dentro do app/extensão. */
  resolveUrl: (path: string) => string;
}

export class SileroVad implements SpeechSegmenter {
  onSegment: ((segment: AudioSegment) => void) | null = null;
  onSpeechStart: ((segmentId: number) => void) | null = null;
  onLevel: ((level: number, isSpeech: boolean, threshold: number) => void) | null = null;
  /** Chamado quando o motor fica definido: 'silero' pronto ou 'energy' por falha. */
  onEngine: ((engine: VadEngine, message?: string) => void) | null = null;

  private worker: Worker | null = null;
  private fallback: EnergyVad | null = null;
  private readonly opts: SileroVadOptions;
  private speaking = false;
  private segmentId = 0;
  private durationMs = 0;
  private nextPeek = 1;
  private peeks = new Map<number, (audio: Float32Array | null) => void>();
  private disposed = false;
  private engineState: 'loading' | VadEngine = 'loading';

  constructor(opts: SileroVadOptions) {
    this.opts = opts;
    this.worker = new Worker(new URL('./silero-vad.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<SileroOutMessage>) => this.handle(e.data);
    this.worker.onerror = (e) => this.useFallback(`worker do Silero VAD falhou: ${e.message}`);
    const { resolveUrl, ...options } = opts;
    this.send({
      type: 'init',
      options,
      ortWasmPaths: {
        mjs: resolveUrl('/onnx/ort-wasm-simd-threaded.asyncify.mjs'),
        wasm: resolveUrl('/onnx/ort-wasm-simd-threaded.asyncify.wasm'),
      },
    });
  }

  get engine(): 'loading' | VadEngine {
    return this.engineState;
  }

  get isSpeaking(): boolean {
    return this.fallback ? this.fallback.isSpeaking : this.speaking;
  }

  get currentSegmentId(): number {
    return this.fallback ? this.fallback.currentSegmentId : this.segmentId;
  }

  get currentDurationMs(): number {
    return this.fallback ? this.fallback.currentDurationMs : this.durationMs;
  }

  push(block: Float32Array): void {
    if (this.fallback) {
      this.fallback.push(block);
      return;
    }
    // Estima a duração do trecho aberto entre as atualizações do worker.
    if (this.speaking) this.durationMs += (block.length / (this.opts.sampleRate ?? 16000)) * 1000;
    this.send({ type: 'push', audio: block }, [block.buffer]);
  }

  peek(): Promise<Float32Array | null> {
    if (this.fallback) return Promise.resolve(this.fallback.peek());
    if (!this.worker || !this.speaking) return Promise.resolve(null);
    return new Promise((resolve) => {
      const id = this.nextPeek++;
      this.peeks.set(id, resolve);
      this.send({ type: 'peek', id });
    });
  }

  flush(): void {
    if (this.fallback) {
      this.fallback.flush();
      return;
    }
    this.send({ type: 'flush' });
  }

  /** Encerra o worker (chamar depois de flush; o último trecho chega antes). */
  dispose(): void {
    this.disposed = true;
    this.send({ type: 'dispose' });
    this.worker = null;
    for (const resolve of this.peeks.values()) resolve(null);
    this.peeks.clear();
  }

  private handle(msg: SileroOutMessage): void {
    if (this.fallback) return;
    switch (msg.type) {
      case 'status':
        if (msg.state === 'ready') {
          this.engineState = 'silero';
          this.onEngine?.('silero');
        } else if (msg.state === 'error') {
          this.useFallback(msg.message ?? 'erro no Silero VAD');
        }
        break;
      case 'speech-start':
        this.speaking = true;
        this.segmentId = msg.segmentId;
        this.durationMs = 0;
        this.onSpeechStart?.(msg.segmentId);
        break;
      case 'segment':
        // performance.now() do worker tem outra origem; o carimbo precisa ser o da página.
        msg.segment.endedAt = performance.now();
        if (msg.segment.id === this.segmentId) {
          this.speaking = false;
          this.durationMs = 0;
        }
        this.onSegment?.(msg.segment);
        break;
      case 'state':
        this.speaking = msg.isSpeaking;
        this.segmentId = msg.segmentId;
        this.durationMs = msg.durationMs;
        break;
      case 'level':
        this.onLevel?.(msg.level, msg.isSpeech, 0.5);
        break;
      case 'peek-result': {
        const resolve = this.peeks.get(msg.id);
        this.peeks.delete(msg.id);
        resolve?.(msg.segmentId === this.segmentId ? msg.audio : null);
        break;
      }
    }
  }

  private useFallback(message: string): void {
    if (this.fallback || this.disposed) return;
    console.warn(`[silero-vad] ${message}; usando o detector por energia`);
    const { resolveUrl: _ignored, ...options } = this.opts;
    const fb = new EnergyVad(options);
    fb.onSegment = (s) => this.onSegment?.(s);
    fb.onSpeechStart = (id) => this.onSpeechStart?.(id);
    fb.onLevel = (l, s, t) => this.onLevel?.(l, s, t);
    this.fallback = fb;
    this.send({ type: 'dispose' });
    this.worker = null;
    for (const resolve of this.peeks.values()) resolve(null);
    this.peeks.clear();
    this.engineState = 'energy';
    this.onEngine?.('energy', message);
  }

  private send(msg: SileroInMessage, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
  }
}
