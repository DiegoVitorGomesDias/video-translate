// Provedor de transcrição com o reconhecimento de voz nativo do Chrome rodando no
// próprio computador (Web Speech API com processLocally; mesmo motor do Live Caption).
// Não pesa na extensão: o Chrome baixa um pacote de idioma (~60 MB) uma vez.
// Requisitos: Chrome 139+ (processLocally), 133+ (start com MediaStreamTrack),
// 140+ (phrases para glossário). Só o Chrome da Google recebe o pacote; Chromium,
// Brave e afins respondem "unavailable".

import type { SpeechProvider, SpeechProviderStatus, TranscriptResult } from './SpeechProvider';

export const CHROME_SPEECH_LANG = 'en-US';
/** Peso dos termos do glossário (faixa 0 a 10). */
const PHRASE_BOOST = 3;

export type ChromeSpeechAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported';

interface RecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  phrases?: unknown[];
  start(track?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: RecognitionResultEvent) => void) | null;
  onerror: ((ev: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string; confidence: number } }>;
}

interface RecognitionStatic {
  new (): RecognitionLike;
  available?(opts: { langs: string[]; processLocally?: boolean; quality?: string }): Promise<string>;
  install?(opts: { langs: string[]; processLocally?: boolean; quality?: string }): Promise<boolean>;
}

interface PhraseStatic {
  new (phrase: string, boost?: number): unknown;
}

function speechCtor(): RecognitionStatic | null {
  const g = globalThis as unknown as { SpeechRecognition?: RecognitionStatic; webkitSpeechRecognition?: RecognitionStatic };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null;
}

function phraseCtor(): PhraseStatic | null {
  return (globalThis as unknown as { SpeechRecognitionPhrase?: PhraseStatic }).SpeechRecognitionPhrase ?? null;
}

/** O navegador tem a API nova (available/install + processLocally)? */
export function chromeSpeechSupported(): boolean {
  const ctor = speechCtor();
  return !!ctor && typeof ctor.available === 'function' && 'processLocally' in new ctor();
}

/** Situação do pacote de idioma no dispositivo. */
export async function chromeSpeechAvailability(lang = CHROME_SPEECH_LANG): Promise<ChromeSpeechAvailability> {
  const ctor = speechCtor();
  if (!ctor || typeof ctor.available !== 'function') return 'unsupported';
  try {
    const r = await ctor.available({ langs: [lang], processLocally: true });
    if (r === 'available' || r === 'downloadable' || r === 'downloading' || r === 'unavailable') return r;
    return 'unavailable';
  } catch {
    return 'unsupported';
  }
}

/** Baixa o pacote de idioma (precisa de gesto do usuário; chamar da tela de opções). */
export async function chromeSpeechInstall(lang = CHROME_SPEECH_LANG): Promise<boolean> {
  const ctor = speechCtor();
  if (!ctor || typeof ctor.install !== 'function') return false;
  try {
    return await ctor.install({ langs: [lang], processLocally: true, quality: 'conversation' });
  } catch {
    return await ctor.install({ langs: [lang], processLocally: true });
  }
}

export class ChromeSpeechProvider implements SpeechProvider {
  readonly name = 'chrome-speech';
  readonly consumesStream = true;
  onResult: ((result: TranscriptResult) => void) | null = null;
  onStatus: ((status: SpeechProviderStatus) => void) | null = null;

  private rec: RecognitionLike | null = null;
  private track: MediaStreamTrack | null = null;
  private terms: string[] = [];
  private active = false;
  private nextSegmentId = 1;
  private partialStartedAt = 0;
  private restartTimer = 0;

  async start(): Promise<void> {
    const availability = await chromeSpeechAvailability();
    if (availability === 'unsupported') throw new Error('Este navegador não tem o reconhecimento de voz no dispositivo (Chrome 139+).');
    if (availability === 'downloadable' || availability === 'downloading') {
      throw new Error('O pacote de voz em inglês do Chrome ainda não foi instalado. Instale na tela de opções da extensão.');
    }
    if (availability === 'unavailable') throw new Error('O reconhecimento de voz no dispositivo não está disponível neste Chrome/sistema.');
    this.active = true;
    this.onStatus?.({ state: 'ready', message: 'Pronto: reconhecimento do Chrome no dispositivo', device: 'chrome', model: 'chrome-on-device' });
    if (this.track) this.startRecognition();
  }

  attachTrack(track: MediaStreamTrack): void {
    this.track = track;
    if (this.active) this.startRecognition();
  }

  setPhrases(terms: string[]): void {
    this.terms = terms;
    if (this.rec) this.applyPhrases(this.rec);
  }

  transcribe(): void {
    /* o stream inteiro já vai para o reconhecedor */
  }

  transcribePartial(): void {
    /* idem */
  }

  async stop(): Promise<void> {
    this.active = false;
    window.clearTimeout(this.restartTimer);
    const rec = this.rec;
    this.rec = null;
    try {
      rec?.abort();
    } catch {
      /* já parado */
    }
    this.track = null;
  }

  private startRecognition(): void {
    if (!this.active || !this.track || this.rec) return;
    const ctor = speechCtor();
    if (!ctor) return;
    const rec = new ctor();
    rec.lang = CHROME_SPEECH_LANG;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.processLocally = true;
    this.applyPhrases(rec);

    let interimOpen = false;
    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i]!;
        const text = (r[0]?.transcript ?? '').trim();
        if (r.isFinal) {
          if (interimOpen) interimOpen = false;
          if (!text) continue;
          const now = performance.now();
          this.onResult?.({
            segmentId: this.nextSegmentId++,
            text,
            isFinal: true,
            reason: 'silence',
            latencyMs: 0,
            inferenceMs: 0,
            audioMs: this.partialStartedAt ? now - this.partialStartedAt : 0,
            audioEndedAt: now,
          });
          this.partialStartedAt = 0;
        } else {
          interim += (interim ? ' ' : '') + text;
        }
      }
      if (interim) {
        if (!interimOpen) {
          interimOpen = true;
          this.partialStartedAt = performance.now();
        }
        const now = performance.now();
        this.onResult?.({ segmentId: this.nextSegmentId, text: interim, isFinal: false, latencyMs: 0, inferenceMs: 0, audioMs: now - this.partialStartedAt, audioEndedAt: now });
      }
    };
    rec.onerror = (ev) => {
      // "no-speech" e "aborted" são normais em pausas longas; o onend reinicia.
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      console.warn('[chrome-speech] erro:', ev.error, ev.message ?? '');
      if (ev.error === 'language-not-supported' || ev.error === 'not-allowed' || ev.error === 'service-not-allowed' || ev.error === 'audio-capture') {
        this.active = false;
        this.rec = null;
        this.onStatus?.({ state: 'error', message: `Reconhecimento do Chrome: ${ev.error}${ev.message ? ` (${ev.message})` : ''}`, device: 'chrome' });
      }
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.rec = null;
      // O reconhecimento contínuo termina sozinho de tempos em tempos; religa na mesma track.
      if (this.active && this.track && this.track.readyState === 'live') {
        this.restartTimer = window.setTimeout(() => this.startRecognition(), 50);
      }
    };
    try {
      // Clona a track: a original continua ligada ao AudioContext que toca o som.
      rec.start(this.track.clone());
      this.rec = rec;
    } catch (err) {
      this.onStatus?.({ state: 'error', message: `Reconhecimento do Chrome não iniciou: ${err instanceof Error ? err.message : String(err)}`, device: 'chrome' });
    }
  }

  private applyPhrases(rec: RecognitionLike): void {
    const Phrase = phraseCtor();
    if (!Phrase || !('phrases' in rec)) return;
    try {
      rec.phrases = this.terms.slice(0, 200).map((t) => new Phrase(t, PHRASE_BOOST));
    } catch (err) {
      console.warn('[chrome-speech] phrases não aceitas:', err);
    }
  }
}
