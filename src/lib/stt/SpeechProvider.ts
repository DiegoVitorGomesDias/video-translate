import type { AudioSegment } from '@/lib/audio/vad';

export interface TranscriptResult {
  text: string;
  /** Resultado fechado (não muda mais) ou provisório. Na fase 0 só há finais. */
  isFinal: boolean;
  /** Latência total (ms) entre o fechamento do trecho de áudio e a chegada do texto. */
  latencyMs: number;
  /** Tempo (ms) só da inferência do modelo. */
  inferenceMs: number;
  /** Duração do áudio transcrito (ms). */
  audioMs: number;
  /** performance.now() do fechamento do trecho de áudio. */
  segmentEndedAt: number;
}

export interface SpeechProviderStatus {
  state: 'idle' | 'loading' | 'ready' | 'error';
  message?: string;
  /** Progresso do download do modelo, 0 a 100. */
  progress?: number;
  /** Backend efetivamente em uso (ex.: "webgpu", "wasm"). */
  device?: string;
  model?: string;
}

/**
 * Interface comum para provedores de transcrição (local, Deepgram, etc.).
 */
export interface SpeechProvider {
  readonly name: string;
  /** Carrega modelo / abre conexão. Resolve quando pronto para transcrever. */
  start(): Promise<void>;
  /** Envia um trecho de áudio (16 kHz mono) para transcrição. */
  transcribe(segment: AudioSegment): void;
  /** Encerra e libera recursos. */
  stop(): Promise<void>;

  onResult: ((result: TranscriptResult) => void) | null;
  onStatus: ((status: SpeechProviderStatus) => void) | null;
}
