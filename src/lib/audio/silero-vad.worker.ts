// Web Worker do Silero VAD: classifica janelas de 32 ms (512 amostras a 16 kHz) com o
// modelo onnx-community/silero-vad (~2 MB) e junta os blocos em trechos com o mesmo
// SegmentBuilder do detector por energia. O áudio fica aqui dentro; a página pede o
// trecho aberto com `peek` quando quer um parcial.

import { AutoModel, Tensor, env, type PreTrainedModel } from '@huggingface/transformers';

import { SegmentBuilder, type AudioSegment, type SegmentBuilderOptions } from './vad';

export const SILERO_MODEL_ID = 'onnx-community/silero-vad';
/** Tamanho da janela que o modelo espera a 16 kHz. */
const FRAME = 512;
/** Probabilidade para começar a fala. */
const START_THRESHOLD = 0.5;
/** Abaixo disso, durante a fala, o bloco conta como silêncio (histerese). */
const END_THRESHOLD = 0.35;

export type SileroInMessage =
  | { type: 'init'; options: SegmentBuilderOptions; ortWasmPaths: { mjs: string; wasm: string } }
  | { type: 'push'; audio: Float32Array }
  | { type: 'peek'; id: number }
  | { type: 'flush' }
  | { type: 'dispose' };

export type SileroOutMessage =
  | { type: 'status'; state: 'loading' | 'ready' | 'error'; message?: string }
  | { type: 'speech-start'; segmentId: number }
  | { type: 'segment'; segment: AudioSegment }
  | { type: 'peek-result'; id: number; segmentId: number; audio: Float32Array | null }
  | { type: 'state'; isSpeaking: boolean; segmentId: number; durationMs: number }
  | { type: 'level'; level: number; isSpeech: boolean };

const post = (msg: SileroOutMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

let model: PreTrainedModel | null = null;
let builder: SegmentBuilder | null = null;
let sr: Tensor | null = null;
let state: Tensor | null = null;
let initPromise: Promise<void> | null = null;
let sampleRate = 16000;

/** Resto de áudio que ainda não completou uma janela. */
let carry = new Float32Array(0);
/** Blocos recebidos antes de o modelo carregar (processados em ordem depois). */
const queue: Float32Array[] = [];
let processing = false;
let disposed = false;

function configureEnv(ortWasmPaths: { mjs: string; wasm: string }): void {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  env.backends.onnx.wasm!.wasmPaths = ortWasmPaths;
  // Mesmos motivos do worker de STT: sem cache do runtime (CSP) e sem threads (sem COOP/COEP).
  env.useWasmCache = false;
  env.backends.onnx.wasm!.numThreads = 1;
}

async function init(options: SegmentBuilderOptions, ortWasmPaths: { mjs: string; wasm: string }): Promise<void> {
  configureEnv(ortWasmPaths);
  sampleRate = options.sampleRate ?? 16000;
  builder = new SegmentBuilder(options);
  builder.onSpeechStart = (segmentId) => post({ type: 'speech-start', segmentId });
  builder.onSegment = (segment) => post({ type: 'segment', segment }, [segment.audio.buffer]);
  builder.onLevel = (level, isSpeech) => post({ type: 'level', level, isSpeech });
  post({ type: 'status', state: 'loading', message: `Carregando ${SILERO_MODEL_ID}` });
  const started = performance.now();
  model = await AutoModel.from_pretrained(SILERO_MODEL_ID, { config: { model_type: 'custom' } as never, dtype: 'fp32', device: 'wasm' });
  sr = new Tensor('int64', [BigInt(sampleRate)], []);
  resetState();
  // Aquecimento.
  await classify(new Float32Array(FRAME));
  resetState();
  console.log(`[silero-vad] modelo pronto em ${Math.round(performance.now() - started)} ms`);
  post({ type: 'status', state: 'ready' });
}

function resetState(): void {
  state = new Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
}

async function classify(frame: Float32Array): Promise<number> {
  const input = new Tensor('float32', frame, [1, frame.length]);
  const out = (await model!({ input, sr, state })) as { output: Tensor; stateN: Tensor };
  state = out.stateN;
  return Number(out.output.data[0]);
}

async function process(audio: Float32Array): Promise<void> {
  if (!builder) return;
  // Junta com o resto e corta em janelas de FRAME.
  let buf: Float32Array;
  if (carry.length > 0) {
    buf = new Float32Array(carry.length + audio.length);
    buf.set(carry, 0);
    buf.set(audio, carry.length);
  } else {
    buf = audio;
  }
  let offset = 0;
  while (offset + FRAME <= buf.length) {
    const frame = buf.subarray(offset, offset + FRAME);
    const prob = await classify(frame);
    const threshold = builder.isSpeaking ? END_THRESHOLD : START_THRESHOLD;
    builder.feed(frame.slice(), prob, prob >= threshold, threshold);
    offset += FRAME;
  }
  carry = buf.slice(offset);
}

async function pump(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    await initPromise;
    while (queue.length > 0 && !disposed) {
      // Se a fila acumulou (CPU ocupada), ainda assim processa em ordem: o VAD é barato.
      const block = queue.shift()!;
      await process(block);
    }
    if (builder) post({ type: 'state', isSpeaking: builder.isSpeaking, segmentId: builder.currentSegmentId, durationMs: builder.currentDurationMs });
  } catch (err) {
    post({ type: 'status', state: 'error', message: err instanceof Error ? err.message : String(err) });
  } finally {
    processing = false;
  }
}

self.onmessage = (event: MessageEvent<SileroInMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      initPromise = init(msg.options, msg.ortWasmPaths).catch((err) => {
        post({ type: 'status', state: 'error', message: err instanceof Error ? err.message : String(err) });
        throw err;
      });
      initPromise.catch(() => undefined);
      break;
    case 'push':
      queue.push(msg.audio);
      void pump();
      break;
    case 'peek': {
      const audio = builder?.peek() ?? null;
      post({ type: 'peek-result', id: msg.id, segmentId: builder?.currentSegmentId ?? 0, audio }, audio ? [audio.buffer] : []);
      break;
    }
    case 'flush':
      builder?.flush();
      break;
    case 'dispose':
      disposed = true;
      void (async () => {
        await initPromise?.catch(() => undefined);
        await model?.dispose();
        model = null;
        self.close();
      })();
      break;
  }
};
