// Detecção e corte de repetições do Whisper ("of a bit of a bit of a bit..."): quando a
// decodificação entra em laço, o modelo repete o mesmo n-grama até o limite de tokens.
// Aqui a saída é reduzida a poucas ocorrências e o trecho é marcado como alucinação,
// para não entrar no prompt do próximo trecho (o que realimentaria o laço).

/** Maior n-grama (em palavras) procurado como laço. */
const MAX_NGRAM = 8;
/** Ocorrências consecutivas mantidas de um n-grama repetido ("no, no, no" fica "no, no"). */
const KEEP_REPEATS = 2;

const normWord = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/**
 * Colapsa runs de um mesmo n-grama (1 a 8 palavras) repetido 3+ vezes seguidas,
 * mantendo as duas primeiras ocorrências. Comparação ignora caixa e pontuação.
 */
export function collapseRepetitions(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 3) return text.trim();
  const keys = words.map(normWord);
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    let bestN = 0;
    let bestEnd = i;
    for (let n = 1; n <= MAX_NGRAM && i + n * 3 <= words.length; n++) {
      let j = i + n;
      while (j + n <= words.length && sameRun(keys, i, j, n)) j += n;
      const repeats = (j - i) / n;
      if (repeats >= 3 && j - i > bestEnd - i) {
        bestN = n;
        bestEnd = j;
      }
    }
    if (bestN === 0) {
      out.push(words[i]!);
      i++;
      continue;
    }
    out.push(...words.slice(i, i + bestN * KEEP_REPEATS));
    i = bestEnd;
  }
  return out.join(' ');
}

function sameRun(keys: string[], a: number, b: number, n: number): boolean {
  for (let k = 0; k < n; k++) {
    const x = keys[a + k]!;
    if (!x || x !== keys[b + k]) return false;
  }
  return true;
}

export interface RepetitionCheck {
  /** Texto com as repetições colapsadas. */
  text: string;
  /** Fração das palavras removidas (0 = nada repetido). */
  removed: number;
  /** Laço de decodificação: muitas palavras e a maioria era repetição. */
  looped: boolean;
}

/** Palavras mínimas para considerar um laço (frases curtas repetidas podem ser fala real). */
const LOOP_MIN_WORDS = 12;
/** Fração de palavras removidas a partir da qual o trecho é tratado como alucinação. */
const LOOP_REMOVED = 0.5;

export function checkRepetition(text: string): RepetitionCheck {
  const original = text.split(/\s+/).filter(Boolean).length;
  const collapsed = collapseRepetitions(text);
  const kept = collapsed.split(/\s+/).filter(Boolean).length;
  const removed = original > 0 ? 1 - kept / original : 0;
  return { text: collapsed, removed, looped: original >= LOOP_MIN_WORDS && removed >= LOOP_REMOVED };
}

/**
 * Limite de tokens novos para um trecho de áudio: inglês falado fica em ~3 palavras/s
 * (~8 tokens/s); 12 tokens/s + folga cobre fala rápida sem deixar o laço ir até 448.
 */
export function maxNewTokensFor(seconds: number): number {
  return Math.max(16, Math.ceil(seconds * 12) + 12);
}
