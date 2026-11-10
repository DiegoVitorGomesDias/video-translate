// Junta os resultados finais do STT em frases completas.
//
// Regras:
// - divide em ".", "?" e "!" (um ou mais), ignorando abreviações comuns ("Mr.", "e.g."),
//   iniciais ("J. K.") e números decimais ("3.14");
// - o que sobra sem pontuação fica guardado e é juntado ao próximo final;
// - um final que veio de um trecho fechado por silêncio (pausa na fala) encerra a frase
//   mesmo sem pontuação; só restos de trechos cortados por tamanho máximo são juntados;
// - frases coladas sem pontuação ("...in a row You froze") são separadas antes de palavras
//   iniciadoras comuns em maiúscula precedidas por minúscula;
// - o resto é fechado à força se passar de `maxChars` caracteres (cortando na vírgula ou
//   conjunção mais próxima) ou se ficar `maxWaitMs` sem receber pontuação.
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

/** Por que o trecho de áudio que gerou o final foi fechado. */
export type EndReason = 'silence' | 'max-length' | 'flush';

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
    this.maxChars = opts.maxChars ?? 90;
    this.maxWaitMs = opts.maxWaitMs ?? 5000;
  }

  /** Texto acumulado ainda sem frase fechada. */
  get pending(): string {
    return this.rest;
  }

  /**
   * Recebe um final do STT e devolve as frases completas resultantes.
   * `reason` diz como o trecho de áudio terminou: em pausa ('silence') ou parada
   * ('flush') a frase em aberto é fechada mesmo sem pontuação; só quando o trecho foi
   * cortado por tamanho ('max-length') o resto fica esperando o próximo final.
   */
  push(text: string, now: number = Date.now(), reason: EndReason = 'max-length'): Sentence[] {
    const cleaned = normalize(text);
    if (!cleaned) return reason === 'max-length' ? this.flushIfStale(now) : this.flush(now);

    const out: Sentence[] = [];
    if (!this.rest) this.restSince = now;
    const combined = this.rest ? `${this.rest} ${cleaned}` : cleaned;
    const { sentences, rest } = splitSentences(combined);
    for (const s of sentences) out.push(this.make(s, now, false));
    this.rest = rest;
    if (sentences.length > 0) this.restSince = now;

    if (this.rest && reason !== 'max-length') {
      out.push(this.make(this.rest, now, false));
      this.rest = '';
    } else {
      while (this.rest.length >= this.maxChars) {
        const [head, tail] = cutAt(this.rest, this.maxChars);
        out.push(this.make(head, now, true));
        this.rest = tail;
        this.restSince = now;
      }
      if (this.rest && now - this.restSince >= this.maxWaitMs) {
        out.push(this.make(this.rest, now, true));
        this.rest = '';
      }
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
  const byPunct = splitByPunctuation(text);
  const sentences: string[] = [];
  for (const s of byPunct.sentences) sentences.push(...splitGlued(s));
  const restParts = splitGlued(byPunct.rest);
  const rest = restParts.pop() ?? '';
  sentences.push(...restParts);
  return { sentences, rest };
}

/** Corta `text` perto de `max` caracteres, na vírgula/ponto-e-vírgula ou conjunção mais próxima antes do limite. */
export function cutAt(text: string, max: number): [string, string] {
  const limit = Math.min(text.length, max);
  const min = Math.floor(max * 0.4);
  let cut = -1;
  // 1) vírgula / ponto-e-vírgula / dois-pontos
  for (let i = limit; i >= min; i--) {
    if (/[,;:]/.test(text[i]!) && text[i + 1] === ' ') {
      cut = i + 1;
      break;
    }
  }
  // 2) conjunção
  if (cut < 0) {
    const re = /\s(and|but|so|because|or|then|which|while|when|that)\s/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) && m.index <= limit) if (m.index >= min) cut = m.index;
  }
  // 3) último espaço antes do limite
  if (cut < 0) {
    const sp = text.lastIndexOf(' ', limit);
    cut = sp > min ? sp : limit;
  }
  return [text.slice(0, cut).trim(), text.slice(cut).trim()];
}

/** Palavras que costumam começar uma frase falada; usadas para separar frases coladas. */
const STARTERS = new Set(
  (
    'what why how when where who whose which and but so well okay ok yes yeah no nope he she they we you it that this there here ' +
    'do did does is are was were can could would should will let\'s maybe now then please thanks thank sorry look listen wait hey oh ' +
    'anyway actually because if just come go get give tell take stop don\'t'
  ).split(' '),
);
const TITLES = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'doctor', 'mister', 'miss', 'president', 'captain', 'professor', 'uncle', 'aunt']);

/**
 * Separa frases coladas sem pontuação: quebra antes de uma palavra iniciadora em
 * maiúscula (ver STARTERS) precedida por uma palavra em minúscula, exceto "I", exceto
 * após título ("Doctor House") e sem deixar fragmentos com menos de 2 palavras.
 */
export function splitGlued(text: string): string[] {
  const words = text.split(' ').filter(Boolean);
  if (words.length < 4) return text ? [text] : [];
  const out: string[] = [];
  let start = 0;
  for (let i = 2; i < words.length - 1; i++) {
    const w = words[i]!;
    const prev = words[i - 1]!;
    const bare = w.replace(/[^\p{L}']/gu, '');
    if (!bare || bare === 'I' || !/^\p{Lu}/u.test(bare)) continue;
    if (!STARTERS.has(bare.toLowerCase())) continue;
    const prevBare = prev.replace(/[^\p{L}']/gu, '');
    if (!prevBare || !/^\p{Ll}/u.test(prevBare)) continue; // anterior precisa ser minúscula
    if (/[,;:(\-–—"'“]$/.test(prev)) continue; // vírgula etc. indicam continuação
    if (TITLES.has(prevBare.toLowerCase())) continue;
    if (i - start < 2 || words.length - i < 2) continue;
    out.push(words.slice(start, i).join(' '));
    start = i;
  }
  out.push(words.slice(start).join(' '));
  return out;
}

function splitByPunctuation(text: string): { sentences: string[]; rest: string } {
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
