// Web Worker de tradução local com @huggingface/transformers (Marian opus-mt).
// Modelo: Xenova/opus-mt-en-ROMANCE (inglês → línguas românicas; o alvo vai no prefixo
// ">>pt_br<<"). ~113 MB em q8. Roda em WASM (q8 não é confiável em WebGPU).

import { pipeline, env, type TranslationPipeline } from '@huggingface/transformers';

export type MtWorkerIn =
  | { type: 'init'; modelId: string; ortWasmPaths: { mjs: string; wasm: string } }
  | { type: 'translate'; id: number; text: string; targetToken: string }
  | { type: 'dispose' };

export type MtWorkerOut =
  | { type: 'status'; state: 'loading' | 'ready' | 'error'; message?: string; progress?: number }
  | { type: 'result'; id: number; text: string; ms: number }
  | { type: 'error'; id?: number; message: string };

const post = (m: MtWorkerOut) => self.postMessage(m);

let translator: TranslationPipeline | null = null;
let initPromise: Promise<void> | null = null;
let chain: Promise<void> = Promise.resolve();

async function init(modelId: string, ortWasmPaths: { mjs: string; wasm: string }): Promise<void> {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  env.backends.onnx.wasm!.wasmPaths = ortWasmPaths;
  env.useWasmCache = false; // ver local-stt.worker.ts: blob: é bloqueado pela CSP
  env.backends.onnx.wasm!.numThreads = 1;

  post({ type: 'status', state: 'loading', message: `Carregando ${modelId}`, progress: 0 });
  try {
    const t0 = performance.now();
    translator = await pipeline('translation', modelId, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: (info: unknown) => {
        const p = info as { status?: string; progress?: number; file?: string };
        if (p.status === 'progress' && typeof p.progress === 'number') {
          post({ type: 'status', state: 'loading', message: `Baixando ${p.file ?? ''}`, progress: p.progress });
        }
      },
    });
    console.log(`[mt-worker] ${modelId} carregado em ${Math.round(performance.now() - t0)} ms`);
    post({ type: 'status', state: 'ready', message: `Pronto: ${modelId}` });
  } catch (err) {
    post({ type: 'status', state: 'error', message: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

async function translate(id: number, text: string, targetToken: string): Promise<void> {
  if (!translator) {
    post({ type: 'error', id, message: 'modelo de tradução não carregado' });
    return;
  }
  const t0 = performance.now();
  try {
    const out = await translator(`${targetToken} ${text}`, { max_new_tokens: 256 } as never);
    const first = Array.isArray(out) ? out[0] : out;
    const raw = (first as { translation_text?: string })?.translation_text ?? '';
    // O modelo às vezes ecoa o token de idioma (">>pt_br<<") no início; remove.
    const result = raw.replace(/^\s*(>>\s*[\w-]+\s*<+\s*)+/, '').trim();
    post({ type: 'result', id, text: result, ms: performance.now() - t0 });
  } catch (err) {
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (e: MessageEvent<MtWorkerIn>) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      initPromise = init(m.modelId, m.ortWasmPaths).catch(() => undefined);
      break;
    case 'translate':
      chain = chain.then(async () => {
        await initPromise;
        await translate(m.id, m.text, m.targetToken);
      });
      break;
    case 'dispose':
      chain = chain.then(async () => {
        await translator?.dispose();
        translator = null;
        self.close();
      });
      break;
  }
};
