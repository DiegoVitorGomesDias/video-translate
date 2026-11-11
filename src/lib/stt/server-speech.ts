// Provedor de transcrição por um servidor local (Docker) na mesma máquina ou na rede:
// cada trecho do VAD vira um WAV (16 kHz, mono, PCM16) enviado por HTTP. Dois formatos:
//   - whisper.cpp: POST /inference (whisper-server; aceita --audio-ctx para janela menor)
//   - OpenAI: POST /v1/audio/transcriptions (Speaches, ScribeCrate, LocalAI, OpenAI real)
// Mantém a mesma fila com prioridade do worker local: finais antes de parciais, um
// pedido por vez, parciais descartados quando o servidor demora mais de 1 s por final.

import type { AudioSegment } from '@/lib/audio/vad';
import type { SpeechProvider, SpeechProviderStatus, TranscriptResult } from './SpeechProvider';

export type ServerSpeechFormat = 'whispercpp' | 'openai';

export interface ServerSpeechConfig {
  url: string;
  format: ServerSpeechFormat;
  /** Nome do modelo (só no formato OpenAI; whisper.cpp usa o modelo carregado no servidor). */
  model: string;
  apiKey: string;
}

export const DEFAULT_SERVER_SPEECH: ServerSpeechConfig = { url: 'http://localhost:8080', format: 'whispercpp', model: 'whisper-1', apiKey: '' };

/** Inferência de um final acima disso: parciais são pulados. */
const PARTIAL_SKIP_MS = 1000;
const RECENT_LIMIT = 3;
const REQUEST_TIMEOUT_MS = 60000;

interface Job {
  id: number;
  segmentId: number;
  isFinal: boolean;
  reason?: AudioSegment['reason'];
  audio: Float32Array;
  sampleRate: number;
  audioEndedAt: number;
}

/** Codifica PCM Float32 em WAV 16 bits mono. */
export function encodeWav(audio: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + audio.length * 2);
  const view = new DataView(buffer);
  const str = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  view.setUint32(4, 36 + audio.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, audio.length * 2, true);
  let offset = 44;
  for (let i = 0; i < audio.length; i++) {
    const v = Math.max(-1, Math.min(1, audio[i] ?? 0));
    view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function endpoint(cfg: ServerSpeechConfig): string {
  const base = cfg.url.replace(/\/+$/, '');
  return cfg.format === 'openai' ? `${base}/v1/audio/transcriptions` : `${base}/inference`;
}

function headers(cfg: ServerSpeechConfig): HeadersInit {
  return cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {};
}

/** Verifica se o servidor responde (whisper.cpp: GET /; OpenAI: GET /v1/models). */
export async function serverSpeechPing(cfg: ServerSpeechConfig): Promise<{ ok: true; info: string } | { ok: false; error: string }> {
  const base = cfg.url.replace(/\/+$/, '');
  const url = cfg.format === 'openai' ? `${base}/v1/models` : `${base}/`;
  try {
    const res = await fetch(url, { headers: headers(cfg), signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    if (cfg.format === 'openai') {
      const data = (await res.json().catch(() => null)) as { data?: { id?: string }[] } | null;
      const ids = data?.data?.map((m) => m.id).filter(Boolean) ?? [];
      return { ok: true, info: ids.length ? `modelos: ${ids.slice(0, 5).join(', ')}` : 'servidor respondeu' };
    }
    return { ok: true, info: 'whisper.cpp respondeu' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Transcreve um WAV de teste (1 s de silêncio) para validar o endpoint de inferência. */
export async function serverSpeechProbe(cfg: ServerSpeechConfig): Promise<{ ok: true; ms: number } | { ok: false; error: string }> {
  const t0 = performance.now();
  try {
    await requestTranscription(cfg, new Float32Array(16000), 16000, '');
    return { ok: true, ms: performance.now() - t0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function requestTranscription(cfg: ServerSpeechConfig, audio: Float32Array, sampleRate: number, prompt: string): Promise<string> {
  const form = new FormData();
  form.append('file', encodeWav(audio, sampleRate), 'segment.wav');
  form.append('response_format', 'json');
  form.append('language', 'en');
  form.append('temperature', '0');
  if (prompt) form.append('prompt', prompt);
  if (cfg.format === 'openai') form.append('model', cfg.model || 'whisper-1');
  const res = await fetch(endpoint(cfg), { method: 'POST', body: form, headers: headers(cfg), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const data = (await res.json()) as { text?: string; error?: unknown };
  if (typeof data.text !== 'string') throw new Error(`resposta sem "text": ${JSON.stringify(data).slice(0, 200)}`);
  return data.text.trim();
}

export class ServerSpeechProvider implements SpeechProvider {
  readonly name = 'server';
  onResult: ((result: TranscriptResult) => void) | null = null;
  onStatus: ((status: SpeechProviderStatus) => void) | null = null;

  private readonly cfg: ServerSpeechConfig;
  private nextId = 1;
  private finals: Job[] = [];
  private partials = new Map<number, Job>();
  private closed = new Set<number>();
  private busy = false;
  private active = false;
  private terms: string[] = [];
  private recent: string[] = [];
  private lastFinalMs = 0;

  constructor(cfg: ServerSpeechConfig) {
    this.cfg = cfg;
  }

  async start(): Promise<void> {
    this.onStatus?.({ state: 'loading', message: `Conectando ao servidor ${this.cfg.url}`, device: 'server', model: this.cfg.format === 'openai' ? this.cfg.model : 'whisper.cpp' });
    const ping = await serverSpeechPing(this.cfg);
    if (!ping.ok) throw new Error(`Servidor de transcrição (${this.cfg.url}) não respondeu: ${ping.error}`);
    this.active = true;
    this.onStatus?.({ state: 'ready', message: `Pronto: servidor ${this.cfg.url} (${ping.info})`, device: 'server', model: this.cfg.format === 'openai' ? this.cfg.model : 'whisper.cpp' });
  }

  setPhrases(terms: string[]): void {
    this.terms = terms;
  }

  transcribe(segment: AudioSegment): void {
    this.enqueue({ id: this.nextId++, segmentId: segment.id, isFinal: true, reason: segment.reason, audio: segment.audio, sampleRate: segment.sampleRate, audioEndedAt: segment.endedAt });
  }

  transcribePartial(segmentId: number, audio: Float32Array, sampleRate: number): void {
    this.enqueue({ id: this.nextId++, segmentId, isFinal: false, audio, sampleRate, audioEndedAt: performance.now() });
  }

  async stop(): Promise<void> {
    this.active = false;
    this.finals = [];
    this.partials.clear();
  }

  private enqueue(job: Job): void {
    if (!this.active) return;
    if (job.isFinal) {
      this.closed.add(job.segmentId);
      this.partials.delete(job.segmentId);
      this.finals.push(job);
    } else {
      if (this.closed.has(job.segmentId) || this.lastFinalMs > PARTIAL_SKIP_MS) return;
      this.partials.set(job.segmentId, job);
    }
    void this.pump();
  }

  private next(): Job | undefined {
    if (this.finals.length > 0) return this.finals.shift();
    let best: Job | undefined;
    for (const p of this.partials.values()) if (!best || p.id > best.id) best = p;
    if (best) this.partials.delete(best.segmentId);
    return best;
  }

  /** O Whisper às vezes "ecoa" o prompt em vez de transcrever (ruído, música): descarta repetições exatas. */
  private isEcho(text: string): boolean {
    const norm = (x: string) => x.replace(/[\s.,!?]+/g, '').toLowerCase();
    const n = norm(text);
    return n.length > 0 && this.recent.some((f) => norm(f) === n);
  }

  private prompt(): string {
    const parts: string[] = [];
    if (this.terms.length > 0) parts.push(`${this.terms.slice(0, 30).join(', ')}.`);
    parts.push(...this.recent);
    return parts.join(' ').replace(/\s+/g, ' ').trim().slice(-600);
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let job = this.next(); job && this.active; job = this.next()) {
        const started = performance.now();
        try {
          let text = await requestTranscription(this.cfg, job.audio, job.sampleRate, this.prompt());
          if (this.isEcho(text)) text = '';
          const inferenceMs = performance.now() - started;
          if (job.isFinal) {
            this.lastFinalMs = inferenceMs;
            if (text) {
              this.recent.push(text);
              while (this.recent.length > RECENT_LIMIT) this.recent.shift();
            }
          }
          this.onResult?.({
            segmentId: job.segmentId,
            text,
            isFinal: job.isFinal,
            reason: job.reason,
            latencyMs: performance.now() - job.audioEndedAt,
            inferenceMs,
            audioMs: (job.audio.length / job.sampleRate) * 1000,
            audioEndedAt: job.audioEndedAt,
          });
        } catch (err) {
          console.error('[stt-server] falha na transcrição:', err);
          if (job.isFinal) this.onStatus?.({ state: 'ready', message: `Servidor falhou num trecho: ${err instanceof Error ? err.message : String(err)}`, device: 'server' });
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
