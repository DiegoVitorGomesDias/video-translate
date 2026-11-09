// Junta os resultados finais do STT em frases completas.
//
// Regras:
// - divide em ".", "?" e "!" (um ou mais), ignorando abreviações comuns ("Mr.", "e.g."),
//   iniciais ("J. K.") e números decimais ("3.14");
// - o que sobra sem pontuação fica guardado e é juntado ao próximo final;
// - o resto é fechado à força se passar de `maxChars` caracteres ou se ficar
//   `maxWaitMs` sem receber pontuação (checado em push() e em flushIfStale()).
//
// Sem dependências do navegador, para poder ser testado em Node.

export interface Sentence {
  id: number;
  text: string;
  /** Carimbo (ms, Date.now()) do final de STT que completou a frase. */
  endedAt: number;
  /** true quando foi fechada por limite de tamanho/tempo, sem pontuação. */
  forced: boolean;
}

export interface SegmenterOptions {
  maxChars?: number;
  maxWaitMs?: number;
}

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'mt', 'vs', 'etc', 'inc', 'ltd', 'co',
  'e.g', 'i.e', 'u.s', 'u.k', 'a.m', 'p.m', 'no', 'fig', 'approx', 'dept', 'est', 'gen', 'gov',
  'sen', 'rep', 'capt', 'col', 'lt', 'sgt', 'ave', 'blvd', 'rd',
]);

export class SentenceSegmenter {
  private readonly maxChars: number;
  private readonly maxWaitMs: number;
  private rest = '';
  /** Quando o resto atual começou a acumular (ms). */
  private restSince = 0;
  private nextId = 1;

  constructor(opts: SegmenterOptions = {}) {
    this.maxChars = opts.maxChars ?? 120;
    this.maxWaitMs = opts.maxWaitMs ?? 5000;
  }

  /** Texto acumulado ainda sem frase fechada. */
  get pending(): string {
    return this.rest;
  }

  /** Recebe um final do STT e devolve as frases completas resultantes. */
  push(text: string, now: number = Date.now()): Sentence[] {
    const cleaned = normalize(text);
    if (!cleaned) return this.flushIfStale(now);

    const out: Sentence[] = [];
    if (!this.rest) this.restSince = now;
    const combined = this.rest ? `${this.rest} ${cleaned}` : cleaned;
    const { sentences, rest } = splitSentences(combined);
    for (const s of sentences) out.push(this.make(s, now, false));
    this.rest = rest;
    if (sentences.length > 0) this.restSince = now;

    if (this.rest.length >= this.maxChars) {
      out.push(this.make(this.rest, now, true));
      this.rest = '';
    } else if (this.rest && now - this.restSince >= this.maxWaitMs) {
      out.push(this.make(this.rest, now, true));
      this.rest = '';
    }
    return out;
  }

  /** Fecha o resto se ele estiver esperando pontuação há mais de maxWaitMs. */
  flushIfStale(now: number = Date.now()): Sentence[] {
    if (this.rest && now - this.restSince >= this.maxWaitMs) return this.flush(now);
    return [];
  }

  /** Fecha o resto incondicionalmente (ex.: ao parar a captura). */
  flush(now: number = Date.now()): Sentence[] {
    if (!this.rest) return [];
    const s = this.make(this.rest, now, true);
    this.rest = '';
    return [s];
  }

  private make(text: string, endedAt: number, forced: boolean): Sentence {
    return { id: this.nextId++, text, endedAt, forced };
  }
}

/** Colapsa espaços e remove texto vazio ou só de pontuação. */
export function normalize(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return /[\p{L}\p{N}]/u.test(t) ? t : '';
}

/** Divide o texto em frases completas e um resto sem pontuação final. */
export function splitSentences(text: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '.' && ch !== '?' && ch !== '!') continue;
    // Consome pontuação repetida ("?!", "...") e aspas/parênteses de fechamento.
    let end = i + 1;
    while (end < text.length && /[.?!]/.test(text[end]!)) end++;
    while (end < text.length && /["'”’)\]]/.test(text[end]!)) end++;
    const next = text[end];
    const atEnd = end >= text.length;
    // Só fecha em fim de texto ou antes de espaço.
    if (!atEnd && next !== ' ') {
      i = end - 1;
      continue;
    }
    if (ch === '.' && !atEnd && isAbbreviationEnd(text, i)) {
      i = end - 1;
      continue;
    }
    // Reticências seguidas de palavra em minúscula são uma pausa, não fim de frase.
    if (!atEnd && end - i >= 2 && text.slice(i, end).startsWith('..') && /\p{Ll}/u.test(text[end + 1] ?? '')) {
      i = end - 1;
      continue;
    }
    const sentence = text.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
    i = end - 1;
  }
  return { sentences, rest: text.slice(start).trim() };
}

/** O ponto em `dotIndex` termina uma abreviação / inicial / decimal? */
function isAbbreviationEnd(text: string, dotIndex: number): boolean {
  // Decimal: "3.14"
  if (/\d/.test(text[dotIndex - 1] ?? '') && /\d/.test(text[dotIndex + 1] ?? '')) return true;
  // Palavra antes do ponto.
  let j = dotIndex - 1;
  while (j >= 0 && /[\p{L}.]/u.test(text[j]!)) j--;
  const word = text.slice(j + 1, dotIndex).toLowerCase();
  if (!word) return false;
  if (ABBREVIATIONS.has(word)) return true;
  // Inicial de uma letra ("J." em "J. K. Rowling"), desde que a próxima palavra comece em maiúscula.
  if (word.length === 1 && /\p{Lu}/u.test(text[dotIndex + 2] ?? '')) return true;
  return false;
}
