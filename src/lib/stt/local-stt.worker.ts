// Web Worker que roda o modelo de transcrição local com @huggingface/transformers.
// Recebe trechos de áudio Float32 a 16 kHz e devolve o texto.
//
// Fila com prioridade: finais são atendidos antes de parciais; de parciais só o mais
// recente de cada trecho é mantido, e parciais de trechos já fechados são descartados.

import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

import type { SttModelCandidate } from './models';

export interface TranscribeRequest {
  type: 'transcribe';
  id: number;
  segmentId: number;
  isFinal: boolean;
  audio: Float32Array;
  sampleRate: number;
}

export type WorkerInMessage =
  | {
      type: 'init';
      /** Lista de (modelo, dispositivo) para tentar em ordem; o primeiro que carregar é usado. */
      candidates: SttModelCandidate[];
      /** URLs absolutas dos arquivos do runtime ONNX dentro da extensão. */
      ortWasmPaths: { mjs: string; wasm: string };
    }
  | TranscribeRequest
  | { type: 'dispose' };

export type WorkerOutMessage =
  | { type: 'status'; state: 'loading' | 'ready' | 'error'; message?: string; progress?: number; device?: string; model?: string }
  | { type: 'result'; id: number; segmentId: number; isFinal: boolean; text: string; inferenceMs: number }
  | { type: 'dropped'; id: number }
  | { type: 'error'; id?: number; message: string };

const post = (msg: WorkerOutMessage) => self.postMessage(msg);

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let generateOptions: Record<string, unknown> = {};
let activeModel: string | null = null;
let activeDevice: string | null = null;
let initPromise: Promise<void> | null = null;

const finals: TranscribeRequest[] = [];
/** Um parcial pendente por trecho (o mais recente substitui o anterior). */
const partials = new Map<number, TranscribeRequest>();
const closedSegments = new Set<number>();
let busy = false;

function configureEnv(ortWasmPaths: { mjs: string; wasm: string }): void {
  // Modelos vêm do Hugging Face Hub e ficam no Cache API do navegador.
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  // O runtime ONNX precisa ser servido pela própria extensão (CSP não permite CDN).
  env.backends.onnx.wasm!.wasmPaths = ortWasmPaths;
  // Com useWasmCache o transformers.js baixa o .mjs do runtime e o reimporta como
  // blob: URL, que a CSP da extensão bloqueia (dentro de um Web Worker não existe
  // `chrome.runtime`, então ele não detecta que está numa extensão). Sem o cache,
  // o .mjs e o .wasm são carregados direto das URLs chrome-extension://, que são 'self'.
  env.useWasmCache = false;
  // SharedArrayBuffer exige cross-origin isolation, que não temos; 1 thread evita surpresas.
  env.backends.onnx.wasm!.numThreads = 1;
}

async function tryLoad(candidate: SttModelCandidate): Promise<AutomaticSpeechRecognitionPipeline> {
  const label = `${candidate.modelId} (${candidate.device})`;
  post({ type: 'status', state: 'loading', message: `Carregando ${label}`, progress: 0, model: candidate.modelId, device: candidate.device });
  const started = performance.now();
  const files = new Map<string, { loaded: number; total: number }>();
  let lastProgressPost = 0;

  const pipe = await pipeline('automatic-speech-recognition', candidate.modelId, {
    device: candidate.device,
    dtype: candidate.dtype as never,
    progress_callback: (info: unknown) => {
      const p = info as { status?: string; progress?: number; file?: string; loaded?: number; total?: number };
      if (!p.file) return;
      // Progresso agregado de todos os arquivos (encoder, decoder, tokenizer...), em bytes.
      if (p.status === 'progress' && typeof p.loaded === 'number' && typeof p.total === 'number') files.set(p.file, { loaded: p.loaded, total: p.total });
      else if (p.status === 'done' && files.has(p.file)) files.set(p.file, { loaded: files.get(p.file)!.total, total: files.get(p.file)!.total });
      else return;
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      const progress = total > 0 ? (loaded / total) * 100 : (p.progress ?? 0);
      // Arquivos grandes disparam milhares de callbacks; limita a ~5 mensagens por segundo
      // (e sempre que um arquivo termina) para não inundar o canal da extensão.
      const now = performance.now();
      if (p.status !== 'done' && now - lastProgressPost < 200 && progress < 100) return;
      lastProgressPost = now;
      post({ type: 'status', state: 'loading', message: `Baixando ${p.file} (${(loaded / 1048576).toFixed(0)} de ${(total / 1048576).toFixed(0)} MB)`, progress, model: candidate.modelId, device: candidate.device });
    },
  });

  // Whisper multilíngue: fixa inglês e transcrição (sem detecção de idioma por trecho).
  generateOptions = candidate.multilingual ? { language: 'en', task: 'transcribe' } : {};

  // Aquecimento: a primeira inferência compila shaders / inicializa o runtime.
  const warmStart = performance.now();
  await pipe(new Float32Array(16000), generateOptions as never); // 1 s de silêncio
  console.log(`[stt-worker] ${label} carregado em ${Math.round(warmStart - started)} ms, aquecimento ${Math.round(performance.now() - warmStart)} ms`);
  return pipe;
}

async function init(candidates: SttModelCandidate[], ortWasmPaths: { mjs: string; wasm: string }): Promise<void> {
  configureEnv(ortWasmPaths);
  const errors: string[] = [];
  for (const c of candidates) {
    if (c.device === 'webgpu' && !('gpu' in navigator)) {
      errors.push(`${c.modelId} (webgpu): WebGPU indisponível neste contexto`);
      continue;
    }
    try {
      transcriber = await tryLoad(c);
      activeModel = c.modelId;
      activeDevice = c.device;
      post({ type: 'status', state: 'ready', message: `Pronto: ${c.modelId} em ${c.device}`, model: c.modelId, device: c.device });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[stt-worker] falha ao carregar ${c.modelId} (${c.device}):`, err);
      errors.push(`${c.modelId} (${c.device}): ${msg}`);
    }
  }
  post({ type: 'status', state: 'error', message: `Nenhum modelo carregou:\n${errors.join('\n')}` });
}

function enqueue(req: TranscribeRequest): void {
  if (req.isFinal) {
    closedSegments.add(req.segmentId);
    const stale = partials.get(req.segmentId);
    if (stale) {
      partials.delete(req.segmentId);
      post({ type: 'dropped', id: stale.id });
    }
    finals.push(req);
  } else {
    if (closedSegments.has(req.segmentId)) {
      post({ type: 'dropped', id: req.id });
      return;
    }
    const prev = partials.get(req.segmentId);
    if (prev) post({ type: 'dropped', id: prev.id });
    partials.set(req.segmentId, req);
  }
  void pump();
}

function next(): TranscribeRequest | undefined {
  if (finals.length > 0) return finals.shift();
  // Parcial mais recente (maior id) entre os trechos abertos.
  let best: TranscribeRequest | undefined;
  for (const p of partials.values()) if (!best || p.id > best.id) best = p;
  if (best) partials.delete(best.segmentId);
  return best;
}

async function pump(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    await initPromise;
    for (let req = next(); req; req = next()) {
      await transcribe(req);
    }
  } finally {
    busy = false;
  }
}

async function transcribe(req: TranscribeRequest): Promise<void> {
  if (!transcriber) {
    post({ type: 'error', id: req.id, message: 'Modelo ainda não carregado' });
    return;
  }
  if (req.sampleRate !== 16000) {
    post({ type: 'error', id: req.id, message: `Esperado 16 kHz, recebido ${req.sampleRate}` });
    return;
  }
  const started = performance.now();
  try {
    const output = await transcriber(req.audio, generateOptions as never);
    const text = (Array.isArray(output) ? output.map((o) => o.text).join(' ') : output.text).trim();
    post({ type: 'result', id: req.id, segmentId: req.segmentId, isFinal: req.isFinal, text, inferenceMs: performance.now() - started });
  } catch (err) {
    post({ type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      initPromise = init(msg.candidates, msg.ortWasmPaths);
      break;
    case 'transcribe':
      enqueue(msg);
      break;
    case 'dispose':
      void (async () => {
        await initPromise;
        await transcriber?.dispose();
        transcriber = null;
        console.log(`[stt-worker] modelo ${activeModel} (${activeDevice}) liberado`);
        self.close();
      })();
      break;
  }
};
