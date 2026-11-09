// Web Worker que roda o modelo de transcrição local com @huggingface/transformers.
// Recebe trechos de áudio Float32 a 16 kHz e devolve o texto.

import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

export type SttDevice = 'webgpu' | 'wasm';

export interface SttModelCandidate {
  modelId: string;
  device: SttDevice;
  dtype?: string | Record<string, string>;
}

export type WorkerInMessage =
  | {
      type: 'init';
      /** Lista de (modelo, dispositivo) para tentar em ordem; o primeiro que carregar é usado. */
      candidates: SttModelCandidate[];
      /** URLs absolutas dos arquivos do runtime ONNX dentro da extensão. */
      ortWasmPaths: { mjs: string; wasm: string };
    }
  | { type: 'transcribe'; id: number; audio: Float32Array; sampleRate: number }
  | { type: 'dispose' };

export type WorkerOutMessage =
  | { type: 'status'; state: 'loading' | 'ready' | 'error'; message?: string; progress?: number; device?: string; model?: string }
  | { type: 'result'; id: number; text: string; inferenceMs: number }
  | { type: 'error'; id?: number; message: string };

const post = (msg: WorkerOutMessage) => self.postMessage(msg);

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let activeModel: string | null = null;
let activeDevice: string | null = null;
// Fila: o runtime não suporta inferências simultâneas, então serializamos.
let chain: Promise<void> = Promise.resolve();

function configureEnv(ortWasmPaths: { mjs: string; wasm: string }): void {
  // Modelos vêm do Hugging Face Hub e ficam no Cache API do navegador.
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  // O runtime ONNX precisa ser servido pela própria extensão (CSP não permite CDN).
  env.backends.onnx.wasm!.wasmPaths = ortWasmPaths;
  // SharedArrayBuffer exige cross-origin isolation, que não temos; 1 thread evita surpresas.
  env.backends.onnx.wasm!.numThreads = 1;
}

async function tryLoad(candidate: SttModelCandidate): Promise<AutomaticSpeechRecognitionPipeline> {
  const label = `${candidate.modelId} (${candidate.device})`;
  post({ type: 'status', state: 'loading', message: `Carregando ${label}`, progress: 0, model: candidate.modelId, device: candidate.device });
  const started = performance.now();

  const pipe = await pipeline('automatic-speech-recognition', candidate.modelId, {
    device: candidate.device,
    dtype: candidate.dtype as never,
    progress_callback: (info: unknown) => {
      const p = info as { status?: string; progress?: number; file?: string };
      if (p.status === 'progress' && typeof p.progress === 'number') {
        post({ type: 'status', state: 'loading', message: `Baixando ${p.file ?? ''}`, progress: p.progress, model: candidate.modelId, device: candidate.device });
      }
    },
  });

  // Aquecimento: a primeira inferência compila shaders / inicializa o runtime.
  const warmStart = performance.now();
  await pipe(new Float32Array(16000)); // 1 s de silêncio
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

async function transcribe(id: number, audio: Float32Array, sampleRate: number): Promise<void> {
  if (!transcriber) {
    post({ type: 'error', id, message: 'Modelo ainda não carregado' });
    return;
  }
  if (sampleRate !== 16000) {
    post({ type: 'error', id, message: `Esperado 16 kHz, recebido ${sampleRate}` });
    return;
  }
  const started = performance.now();
  try {
    const output = await transcriber(audio);
    const text = (Array.isArray(output) ? output.map((o) => o.text).join(' ') : output.text).trim();
    post({ type: 'result', id, text, inferenceMs: performance.now() - started });
  } catch (err) {
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      chain = chain.then(() => init(msg.candidates, msg.ortWasmPaths));
      break;
    case 'transcribe':
      chain = chain.then(() => transcribe(msg.id, msg.audio, msg.sampleRate));
      break;
    case 'dispose':
      chain = chain.then(async () => {
        await transcriber?.dispose();
        transcriber = null;
        console.log(`[stt-worker] modelo ${activeModel} (${activeDevice}) liberado`);
        self.close();
      });
      break;
  }
};
