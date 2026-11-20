// Limpeza do texto do Whisper no modo música.
//
// Em trechos só instrumentais o Whisper não devolve vazio: "alucina" marcadores
// ("♪", "[Music]", "(instrumental)") ou frases decoradas de legendas de vídeo
// ("Thank you.", "Thanks for watching!", "Subtitles by the Amara.org community").
// Aqui esses marcadores são removidos e um resultado que fique só com isso vira vazio.
//
// Sem dependências do navegador, para poder ser testado em Node.

/** Frases inteiras (normalizadas: minúsculas, sem pontuação) que o Whisper inventa em silêncio/música. */
const HALLUCINATIONS = new Set(
  [
    'thank you',
    'thanks for watching',
    'thank you for watching',
    'thank you so much for watching',
    'thanks for listening',
    'thank you for listening',
    'please subscribe',
    'subscribe to my channel',
    'like and subscribe',
    'subtitles by the amaraorg community',
    'subtitles by amaraorg',
    'transcribed by esoorg',
    'transcription by castingwords',
    'copyright',
    'you',
    'bye',
    'the end',
    'music',
    'applause',
    'laughter',
    'instrumental',
    'silence',
    'so',
    'oh',
    'uh',
    'hmm',
    'mm',
  ].map(normalizeKey),
);

/** Marcadores de música/ruído entre colchetes/parênteses e símbolos musicais. */
const MARKERS = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫♬♩🎵🎶]+/g;

function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Remove marcadores e devolve '' quando o que sobra é uma alucinação conhecida ou nada. */
export function cleanLyrics(text: string): string {
  let t = text.replace(MARKERS, ' ').replace(/\s+/g, ' ').trim();
  // Pontuação solta que sobrou ("- ", ". ,").
  t = t.replace(/^[\s\-–—.,;:!?]+/, '').replace(/[\s\-–—,;:]+$/, '').trim();
  if (!/[\p{L}\p{N}]/u.test(t)) return '';
  if (HALLUCINATIONS.has(normalizeKey(t))) return '';
  return t;
}

/** O texto é só um marcador/alucinação (nada de letra)? */
export function isMusicHallucination(text: string): boolean {
  return cleanLyrics(text) === '';
}
