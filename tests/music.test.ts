import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MUSIC_WINDOWS, MusicSegmenter } from '../src/lib/audio/music.ts';
import type { AudioSegment } from '../src/lib/audio/vad.ts';
import { cleanLyrics, isMusicHallucination } from '../src/lib/stt/lyrics.ts';

const SR = 16000;
const BLOCK = 1024; // 64 ms, como o worklet

function blocks(ms: number): number {
  return Math.round(((ms / 1000) * SR) / BLOCK);
}

/** Alimenta `ms` de áudio com amplitude constante (ruído determinístico). */
function feed(m: MusicSegmenter, ms: number, amplitude: number): void {
  for (let i = 0; i < blocks(ms); i++) {
    const b = new Float32Array(BLOCK);
    for (let j = 0; j < BLOCK; j++) b[j] = amplitude * ((j % 7) - 3) / 3;
    m.push(b);
  }
}

const SHORT = { windowMs: MUSIC_WINDOWS.short.windowMs, maxWindowMs: MUSIC_WINDOWS.short.maxWindowMs, searchMs: MUSIC_WINDOWS.short.searchMs };

test('MusicSegmenter (padrão, janela longa) corta a cada ~10 s sem pausa', () => {
  const m = new MusicSegmenter({ sampleRate: SR });
  const out: AudioSegment[] = [];
  m.onSegment = (s) => out.push(s);
  feed(m, 40000, 0.3);
  assert.ok(out.length >= 3 && out.length <= 4, `janelas: ${out.length}`);
  for (const s of out) assert.ok(s.durationMs >= 9000 && s.durationMs <= 12100, `duração ${s.durationMs}`);
});

test('MusicSegmenter corta a cada ~4 s (janela curta) mesmo sem pausa (instrumental contínuo)', () => {
  const m = new MusicSegmenter({ sampleRate: SR, ...SHORT });
  const out: AudioSegment[] = [];
  m.onSegment = (s) => out.push(s);
  feed(m, 20000, 0.3);
  // Janela alvo 4 s, máxima 5,5 s: em 20 s saem pelo menos 3 janelas.
  assert.ok(out.length >= 3, `janelas: ${out.length}`);
  for (const s of out) {
    assert.ok(s.durationMs >= 3500 && s.durationMs <= 5600, `duração ${s.durationMs}`);
    assert.equal(s.reason, 'silence'); // cada janela é um verso fechado para o segmentador
  }
  assert.equal(m.isSpeaking, true); // o resto continua aberto
});

test('MusicSegmenter corta no ponto mais silencioso perto do fim da janela', () => {
  const m = new MusicSegmenter({ sampleRate: SR, ...SHORT });
  const out: AudioSegment[] = [];
  m.onSegment = (s) => out.push(s);
  feed(m, 2800, 0.3); // verso
  feed(m, 200, 0.001); // respiração (quase silêncio) aos 2,8 s
  feed(m, 1500, 0.3); // próximo verso
  assert.equal(out.length, 1);
  // Cortou na respiração (~2,8 a 3,0 s), não aos 4 s.
  assert.ok(out[0]!.durationMs >= 2700 && out[0]!.durationMs <= 3100, `duração ${out[0]!.durationMs}`);
  // O resto (~1,5 s) ficou como começo da janela seguinte.
  assert.ok(m.currentDurationMs >= 1400 && m.currentDurationMs <= 1800, `resto ${m.currentDurationMs}`);
});

test('MusicSegmenter fecha na pausa longa e descarta janela só de silêncio', () => {
  const m = new MusicSegmenter({ sampleRate: SR, ...SHORT });
  const out: AudioSegment[] = [];
  const starts: number[] = [];
  m.onSegment = (s) => out.push(s);
  m.onSpeechStart = (id) => starts.push(id);
  feed(m, 3000, 0); // vídeo pausado: nada abre
  assert.equal(m.isSpeaking, false);
  feed(m, 2000, 0.3); // música
  feed(m, 1500, 0); // fim da música
  assert.equal(out.length, 1);
  assert.equal(out[0]!.reason, 'silence');
  assert.ok(out[0]!.durationMs >= 2900 && out[0]!.durationMs <= 3200, `duração ${out[0]!.durationMs}`);
  assert.equal(m.isSpeaking, false);
  assert.deepEqual(starts, [1]);
  // Um estalo curto seguido de silêncio não vira trecho.
  feed(m, 200, 0.3);
  feed(m, 1500, 0);
  assert.equal(out.length, 1);
});

test('MusicSegmenter: flush fecha o que está aberto e peek devolve o áudio acumulado', () => {
  const m = new MusicSegmenter({ sampleRate: SR });
  const out: AudioSegment[] = [];
  m.onSegment = (s) => out.push(s);
  feed(m, 2000, 0.3);
  const peek = m.peek();
  assert.ok(peek && Math.abs(peek.length - 2 * SR) <= BLOCK);
  m.flush();
  assert.equal(out.length, 1);
  assert.equal(out[0]!.reason, 'flush');
  assert.equal(m.peek(), null);
});

test('cleanLyrics remove marcadores e alucinações do Whisper', () => {
  assert.equal(cleanLyrics('♪ ♪ ♪'), '');
  assert.equal(cleanLyrics('[Music]'), '');
  assert.equal(cleanLyrics('(instrumental)'), '');
  assert.equal(cleanLyrics('Thank you.'), '');
  assert.equal(cleanLyrics('Thanks for watching!'), '');
  assert.equal(cleanLyrics('Subtitles by the Amara.org community'), '');
  assert.equal(cleanLyrics('♪ Is this the real life? ♪'), 'Is this the real life?');
  assert.equal(cleanLyrics('[Music] Caught in a landslide, no escape from reality'), 'Caught in a landslide, no escape from reality');
  assert.equal(cleanLyrics('Thank you for the music'), 'Thank you for the music');
  assert.equal(isMusicHallucination(' - '), true);
  assert.equal(isMusicHallucination('Mama, just killed a man'), false);
});
