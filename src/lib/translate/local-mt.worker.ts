// Web Worker de tradução local com @huggingface/transformers (Marian opus-mt).
// Modelo: Xenova/opus-mt-en-ROMANCE (inglês → línguas românicas; o alvo vai no prefixo
// ">>pt_br<<"). ~113 MB em q8. Roda em WASM (q8 não é confiável em WebGPU).

import { AutoModelForSeq2SeqLM, AutoTokenizer, Tensor, env, type PreTrainedModel, type PreTrainedTokenizer } from '@huggingface/transformers';

export type MtWorkerIn =
  | { type: 'init'; modelId: string; ortWasmPaths: { mjs: string; wasm: string } }
  | { type: 'translate'; id: number; text: string; targetToken: string }
  | { type: 'dispose' };

export type MtWorkerOut =
  | { type: 'status'; state: 'loading' | 'ready' | 'error'; message?: string; progress?: number }
  | { type: 'result'; id: number; text: string; ms: number }
  | { type: 'error'; id?: number; message: string };

const post = (m: MtWorkerOut) => self.postMessage(m);

let tokenizer: PreTrainedTokenizer | null = null;
let model: PreTrainedModel | null = null;
const langIds = new Map<string, number>();
let initPromise: Promise<void> | null = null;
let chain: Promise<void> = Promise.resolve();

async function init(modelId: string, ortWasmPaths: { mjs: string; wasm: string }): Promise<void> {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  env.backends.onnx.wasm!.wasmPaths = ortWasmPaths;
  env.useWasmCache = false; // ver local-stt.worker.ts: blob: é bloqueado pela CSP
  env.backends.onnx.wasm!.numThreads = 1;

  // Só WASM: com pesos q8 em WebGPU o Marian gerou saída degradada (idiomas trocados,
  // "<<" no texto) na GPU do usuário. WebGPU exigiria fp16/fp32 (2 a 4x o download).
  const candidates: { device: 'webgpu' | 'wasm'; dtype: string }[] = [{ device: 'wasm', dtype: 'q8' }];

  const errors: string[] = [];
  for (const c of candidates) {
    post({ type: 'status', state: 'loading', message: `Carregando ${modelId} (${c.device})`, progress: 0 });
    try {
      const t0 = performance.now();
      const progress_callback = (info: unknown) => {
        const p = info as { status?: string; progress?: number; file?: string };
        if (p.status === 'progress' && typeof p.progress === 'number') {
          post({ type: 'status', state: 'loading', message: `Baixando ${p.file ?? ''}`, progress: p.progress });
        }
      };
      const tok = await AutoTokenizer.from_pretrained(modelId, { progress_callback });
      const mdl = await AutoModelForSeq2SeqLM.from_pretrained(modelId, { device: c.device, dtype: c.dtype as never, progress_callback });
      // Ids dos tokens de idioma-alvo (">>pt_br<<" etc.), que o tokenizador do
      // transformers.js 4.x não trata como token único ao codificar texto.
      const vocab = tok.get_vocab() as Map<string, number>;
      for (const [k, v] of vocab) if (/^>>[\w-]+<<$/.test(k)) langIds.set(k, v);
      if (langIds.size === 0) throw new Error('vocabulário sem tokens de idioma (>>xx<<)');
      tokenizer = tok;
      model = mdl;
      // Aquecimento e sanidade: a saída precisa ser português de verdade.
      const probeText = await run('Hello world.', '>>pt_br<<');
      if (!/mundo/i.test(probeText) || /<</.test(probeText)) throw new Error(`saída de teste inválida: "${probeText}"`);
      console.log(`[mt-worker] ${modelId} (${c.device}) carregado em ${Math.round(performance.now() - t0)} ms; teste: "${probeText}"`);
      post({ type: 'status', state: 'ready', message: `Pronto: ${modelId} em ${c.device}` });
      return;
    } catch (err) {
      tokenizer = null;
      model = null;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[mt-worker] falha em ${c.device}:`, err);
      errors.push(`${c.device}: ${msg}`);
    }
  }
  post({ type: 'status', state: 'error', message: `tradutor local não carregou: ${errors.join(' | ')}` });
  throw new Error(errors.join(' | '));
}

/** Codifica o texto, prefixa o id do token de idioma e gera a tradução. */
async function run(text: string, targetToken: string): Promise<string> {
  if (!tokenizer || !model) throw new Error('modelo de tradução não carregado');
  const langId = langIds.get(targetToken);
  if (langId === undefined) throw new Error(`token de idioma ${targetToken} não existe no modelo`);
  const enc = tokenizer(text, { add_special_tokens: true } as never) as { input_ids: Tensor };
  const body = Array.from(enc.input_ids.data as BigInt64Array);
  const ids = BigInt64Array.from([BigInt(langId), ...body]);
  const input_ids = new Tensor('int64', ids, [1, ids.length]);
  const attention_mask = new Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]);
  const out = (await model.generate({ input_ids, attention_mask, max_new_tokens: 256 } as never)) as Tensor;
  const [decoded] = tokenizer.batch_decode(out as never, { skip_special_tokens: true });
  return cleanOutput(decoded ?? '');
}

async function translate(id: number, text: string, targetToken: string): Promise<void> {
  const t0 = performance.now();
  try {
    const result = await run(text, targetToken);
    post({ type: 'result', id, text: result, ms: performance.now() - t0 });
  } catch (err) {
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
}

/** Remove resquícios do token de idioma (">>pt_br<<", "<<", "< <") e espaços duplicados. */
function cleanOutput(text: string): string {
  return text
    .replace(/>>\s*[\w-]+\s*<+/g, ' ')
    .replace(/(^|\s)(<\s*){2,}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
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
        await model?.dispose();
        model = null;
        tokenizer = null;
        self.close();
      });
      break;
  }
};
