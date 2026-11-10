// Web Worker que roda o modelo de transcrição local com @huggingface/transformers.
// Recebe trechos de áudio Float32 a 16 kHz e devolve o texto.
//
// Fila com prioridade: finais são atendidos antes de parciais; de parciais só o mais
// recente de cada trecho é mantido, e parciais de trechos já fechados são descartados.
//
// Cada worker carrega UM candidato (modelo + dispositivo). Se falhar, o provedor encerra
// o worker e cria outro para o próximo candidato: uma falha no WebGPU (ex.: shader f16
// indisponível) deixa o runtime ONNX inutilizável no mesmo contexto, inclusive para WASM.

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
      /** Candidato (modelo, dispositivo, dtype) que este worker deve carregar. */
      candidate: SttModelCandidate;
      /** URLs absolutas dos arquivos do runtime ONNX dentro da extensão. */
      ortWasmPaths: { mjs: string; wasm: string };
    }
  | TranscribeRequest
  /** Termos do glossário (nomes, siglas) para o prompt do Whisper. */
  | { type: 'set-terms'; terms: string[] }
  | { type: 'dispose' };

export type WorkerOutMessage =
  | { type: 'status'; state: 'loading' | 'ready' | 'error'; message?: string; progress?: number; device?: string; model?: string }
  | { type: 'result'; id: number; segmentId: number; isFinal: boolean; text: string; inferenceMs: number }
  | { type: 'dropped'; id: number }
  | { type: 'error'; id?: number; message: string };

const post = (msg: WorkerOutMessage) => self.postMessage(msg);

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let generateOptions: Record<string, unknown> = {};
/** Modelo Whisper: aceita prompt com o texto anterior (contexto) via decoder_input_ids. */
let promptable = false;
let multilingual = false;
/** Ids dos tokens especiais que abrem a geração (sot, idioma, tarefa, sem timestamps). */
let initTokenIds: number[] = [];
let prevSotId: number | null = null;
let terms: string[] = [];
/** Últimas frases finais, usadas como contexto no prompt do Whisper. */
const recentFinals: string[] = [];
const RECENT_LIMIT = 3;
/** Tamanho máximo do prompt em tokens (o Whisper aceita até 224). */
const PROMPT_MAX_TOKENS = 96;
/** Inferência de um final acima disso: os parciais são pulados (o modelo é pesado demais para dois passes). */
const PARTIAL_SKIP_MS = 1000;
let lastFinalInferenceMs = 0;
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

/** A GPU tem o recurso "shader-f16" (necessário para pesos q4f16/fp16)? */
async function gpuSupportsF16(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
  if (!gpu) return false;
  try {
    const adapter = await gpu.requestAdapter();
    return !!adapter && adapter.features.has('shader-f16');
  } catch {
    return false;
  }
}

async function tryLoad(candidate: SttModelCandidate): Promise<AutomaticSpeechRecognitionPipeline> {
  const label = `${candidate.modelId} (${candidate.device})`;
  if (candidate.device === 'webgpu' && !('gpu' in navigator)) throw new Error('WebGPU indisponível neste contexto');
  if (candidate.requiresF16 && !(await gpuSupportsF16())) throw new Error('a GPU não tem shader-f16 (necessário para os pesos f16)');
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
  multilingual = !!candidate.multilingual;
  generateOptions = multilingual ? { language: 'en', task: 'transcribe' } : {};
  promptable = /whisper/i.test(candidate.modelId);
  if (promptable) setupPrompt(pipe);

  // Aquecimento: a primeira inferência compila shaders / inicializa o runtime.
  const warmStart = performance.now();
  await pipe(new Float32Array(16000), generateOptions as never); // 1 s de silêncio
  console.log(`[stt-worker] ${label} carregado em ${Math.round(warmStart - started)} ms, aquecimento ${Math.round(performance.now() - warmStart)} ms`);
  return pipe;
}

async function init(candidate: SttModelCandidate, ortWasmPaths: { mjs: string; wasm: string }): Promise<void> {
  configureEnv(ortWasmPaths);
  try {
    transcriber = await tryLoad(candidate);
    activeModel = candidate.modelId;
    activeDevice = candidate.device;
    post({ type: 'status', state: 'ready', message: `Pronto: ${candidate.modelId} em ${candidate.device}`, model: candidate.modelId, device: candidate.device });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[stt-worker] falha ao carregar ${candidate.modelId} (${candidate.device}):`, err);
    post({ type: 'status', state: 'error', message: msg, model: candidate.modelId, device: candidate.device });
  }
}

interface TokenizerLike {
  encode(text: string, opts?: { add_special_tokens?: boolean }): number[];
  convert_tokens_to_ids(tokens: string[]): number[];
}

/** Descobre os ids dos tokens especiais do Whisper para montar o prompt. */
function setupPrompt(pipe: AutomaticSpeechRecognitionPipeline): void {
  const tok = (pipe as unknown as { tokenizer: TokenizerLike }).tokenizer;
  const names = multilingual ? ['<|startoftranscript|>', '<|en|>', '<|transcribe|>', '<|notimestamps|>'] : ['<|startoftranscript|>', '<|notimestamps|>'];
  const ids = tok.convert_tokens_to_ids(names);
  const [prev] = tok.convert_tokens_to_ids(['<|startofprev|>']);
  if (ids.some((id) => id === undefined || id === null) || prev === undefined || prev === null) {
    console.warn('[stt-worker] tokens especiais do Whisper não encontrados; sem prompt de contexto');
    promptable = false;
    return;
  }
  initTokenIds = ids;
  prevSotId = prev;
}

/** Texto do prompt: glossário + últimas frases (o Whisper o trata como transcrição anterior). */
function promptText(): string {
  const parts: string[] = [];
  if (terms.length > 0) parts.push(`${terms.slice(0, 30).join(', ')}.`);
  parts.push(...recentFinals);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** decoder_input_ids = <|startofprev|> + prompt + tokens iniciais; null quando não há contexto. */
function promptIds(): { ids: number[]; text: string } | null {
  if (!promptable || prevSotId === null || !transcriber) return null;
  const text = promptText();
  if (!text) return null;
  const tok = (transcriber as unknown as { tokenizer: TokenizerLike }).tokenizer;
  let tokens = tok.encode(' ' + text, { add_special_tokens: false });
  if (tokens.length > PROMPT_MAX_TOKENS) tokens = tokens.slice(tokens.length - PROMPT_MAX_TOKENS);
  return { ids: [prevSotId, ...tokens, ...initTokenIds], text };
}

/** O texto decodificado inclui o prompt; remove esse prefixo. */
function stripPrompt(text: string, prompt: string): string {
  const t = text.trim();
  const p = prompt.trim();
  if (p && t.startsWith(p)) return t.slice(p.length).trim();
  // Tokenização pode mudar espaços/pontuação: compara sem espaços.
  const norm = (x: string) => x.replace(/\s+/g, '');
  const np = norm(p);
  if (np && norm(t).startsWith(np)) {
    let seen = 0;
    for (let i = 0; i < t.length; i++) {
      if (!/\s/.test(t[i]!)) seen++;
      if (seen === np.length) return t.slice(i + 1).trim();
    }
  }
  return t;
}

function rememberFinal(text: string): void {
  if (!text) return;
  recentFinals.push(text);
  while (recentFinals.length > RECENT_LIMIT) recentFinals.shift();
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
    if (closedSegments.has(req.segmentId) || lastFinalInferenceMs > PARTIAL_SKIP_MS) {
      // Trecho já fechado, ou modelo pesado: um parcial custaria tanto quanto um final.
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
    const prompt = promptIds();
    const opts = prompt ? { ...generateOptions, decoder_input_ids: prompt.ids } : generateOptions;
    const output = await transcriber(req.audio, opts as never);
    let text = (Array.isArray(output) ? output.map((o) => o.text).join(' ') : output.text).trim();
    if (prompt) text = stripPrompt(text, prompt.text);
    const inferenceMs = performance.now() - started;
    if (req.isFinal) {
      lastFinalInferenceMs = inferenceMs;
      rememberFinal(text);
    }
    post({ type: 'result', id: req.id, segmentId: req.segmentId, isFinal: req.isFinal, text, inferenceMs });
  } catch (err) {
    post({ type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      initPromise = init(msg.candidate, msg.ortWasmPaths);
      break;
    case 'transcribe':
      enqueue(msg);
      break;
    case 'set-terms':
      terms = msg.terms;
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
