// Tradução local no navegador (Marian opus-mt via transformers.js), num Web Worker.
// Funciona offline depois do download (~113 MB em q8) e nada sai do computador.

import { TranslationError, type TranslationProvider } from './TranslationProvider';
import type { MtWorkerIn, MtWorkerOut } from './local-mt.worker';

export const OPUS_MT_EN_ROMANCE = 'Xenova/opus-mt-en-ROMANCE';
export const LOCAL_MT_DOWNLOAD_MB = 113;

/** Tokens de idioma-alvo do opus-mt-en-ROMANCE. */
const TARGET_TOKENS: Record<string, string> = {
  pt: '>>pt_br<<',
  'pt-BR': '>>pt_br<<',
  'pt-PT': '>>pt_PT<<',
  es: '>>es<<',
  fr: '>>fr<<',
  it: '>>it<<',
};

export interface LocalOpusStatus {
  state: 'loading' | 'ready' | 'error';
  message?: string;
  progress?: number;
}

export class LocalOpusProvider implements TranslationProvider {
  readonly name = 'Local (opus-mt)';
  onStatus: ((s: LocalOpusStatus) => void) | null = null;

  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();

  constructor(private readonly resolveUrl: (path: string) => string) {}

  /** Inicia o download/carregamento do modelo. Resolve quando pronto. */
  start(): Promise<void> {
    if (this.ready) return this.ready;
    this.worker = new Worker(new URL('./local-mt.worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise<void>((resolve, reject) => {
      this.worker!.onmessage = (e: MessageEvent<MtWorkerOut>) => {
        const m = e.data;
        switch (m.type) {
          case 'status':
            this.onStatus?.({ state: m.state, message: m.message, progress: m.progress });
            if (m.state === 'ready') resolve();
            if (m.state === 'error') reject(new TranslationError(m.message ?? 'falha ao carregar', this.name));
            break;
          case 'result':
            this.pending.get(m.id)?.resolve(m.text);
            this.pending.delete(m.id);
            break;
          case 'error':
            if (m.id !== undefined) {
              this.pending.get(m.id)?.reject(new TranslationError(m.message, this.name));
              this.pending.delete(m.id);
            }
            break;
        }
      };
      this.worker!.onerror = (e) => reject(new TranslationError(e.message, this.name));
    });
    this.post({
      type: 'init',
      modelId: OPUS_MT_EN_ROMANCE,
      ortWasmPaths: {
        mjs: this.resolveUrl('/onnx/ort-wasm-simd-threaded.asyncify.mjs'),
        wasm: this.resolveUrl('/onnx/ort-wasm-simd-threaded.asyncify.wasm'),
      },
    });
    return this.ready;
  }

  async translate(text: string, _from: string, to: string): Promise<string> {
    await this.start();
    const targetToken = TARGET_TOKENS[to];
    if (!targetToken) throw new TranslationError(`idioma-alvo "${to}" não suportado pelo modelo local`, this.name);
    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ type: 'translate', id, text, targetToken });
    });
  }

  dispose(): void {
    this.post({ type: 'dispose' });
    this.worker = null;
    this.ready = null;
    for (const p of this.pending.values()) p.reject(new TranslationError('provedor encerrado', this.name));
    this.pending.clear();
  }

  private post(m: MtWorkerIn): void {
    this.worker?.postMessage(m);
  }
}
