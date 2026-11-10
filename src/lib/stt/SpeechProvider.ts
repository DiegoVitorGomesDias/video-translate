import type { AudioSegment } from '@/lib/audio/vad';

export interface TranscriptResult {
  /** Id do trecho de áudio a que o texto se refere. */
  segmentId: number;
  text: string;
  /** Resultado fechado (não muda mais) ou provisório (texto parcial de um trecho aberto). */
  isFinal: boolean;
  /** Como o trecho de áudio foi fechado (só em finais). */
  reason?: AudioSegment['reason'];
  /** Latência total (ms) entre o fim do áudio enviado e a chegada do texto. */
  latencyMs: number;
  /** Tempo (ms) só da inferência do modelo. */
  inferenceMs: number;
  /** Duração do áudio transcrito (ms). */
  audioMs: number;
  /** performance.now() do fim do áudio enviado. */
  audioEndedAt: number;
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
  /** Envia um trecho fechado (16 kHz mono) para transcrição final. */
  transcribe(segment: AudioSegment): void;
  /**
   * Envia o áudio acumulado de um trecho ainda aberto para um texto provisório.
   * Parciais têm prioridade menor que finais e podem ser descartados.
   */
  transcribePartial(segmentId: number, audio: Float32Array, sampleRate: number): void;
  /** Encerra e libera recursos. */
  stop(): Promise<void>;

  onResult: ((result: TranscriptResult) => void) | null;
  onStatus: ((status: SpeechProviderStatus) => void) | null;
}
