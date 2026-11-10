import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EnergyVad, SegmentBuilder, type AudioSegment } from '../src/lib/audio/vad.ts';

const SR = 16000;
const BLOCK = 512; // 32 ms, como as janelas do Silero

function blocks(ms: number): number {
  return Math.round((ms / 1000) * SR / BLOCK);
}

function feed(b: SegmentBuilder, ms: number, speech: boolean, level = speech ? 0.9 : 0.05): void {
  for (let i = 0; i < blocks(ms); i++) b.feed(new Float32Array(BLOCK).fill(speech ? 0.5 : 0), level, speech);
}

test('SegmentBuilder fecha o trecho após o silêncio e inclui o pré-rolo', () => {
  const b = new SegmentBuilder({ sampleRate: SR, silenceMs: 250, maxSegmentMs: 4000, preRollMs: 300 });
  const out: AudioSegment[] = [];
  const starts: number[] = [];
  b.onSegment = (s) => out.push(s);
  b.onSpeechStart = (id) => starts.push(id);
  feed(b, 1000, false); // silêncio inicial
  feed(b, 800, true);
  assert.equal(b.isSpeaking, true);
  assert.equal(b.currentSegmentId, 1);
  feed(b, 300, false);
  assert.equal(b.isSpeaking, false);
  assert.deepEqual(starts, [1]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.reason, 'silence');
  // ~300 ms de pré-rolo + 800 ms de fala + 250..300 ms de silêncio final.
  assert.ok(out[0]!.durationMs > 1300 && out[0]!.durationMs < 1500, `duração ${out[0]!.durationMs}`);
});

test('SegmentBuilder descarta fala curta demais', () => {
  const b = new SegmentBuilder({ sampleRate: SR, silenceMs: 250, minSpeechMs: 250 });
  const out: AudioSegment[] = [];
  b.onSegment = (s) => out.push(s);
  feed(b, 100, true);
  feed(b, 300, false);
  assert.equal(out.length, 0);
});

test('SegmentBuilder corta no ponto mais silencioso ao atingir o máximo e continua o trecho', () => {
  const b = new SegmentBuilder({ sampleRate: SR, silenceMs: 1000, maxSegmentMs: 2000, preRollMs: 0 });
  const out: AudioSegment[] = [];
  const starts: number[] = [];
  b.onSegment = (s) => out.push(s);
  b.onSpeechStart = (id) => starts.push(id);
  feed(b, 1500, true, 0.9);
  feed(b, 100, true, 0.4); // "vale" dentro da janela de corte
  feed(b, 400, true, 0.9);
  feed(b, 500, true, 0.9);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.reason, 'max-length');
  assert.ok(out[0]!.durationMs >= 1000 && out[0]!.durationMs <= 1700, `cortou em ${out[0]!.durationMs}`);
  assert.equal(b.isSpeaking, true);
  assert.deepEqual(starts, [1, 2]);
});

test('peek devolve o áudio acumulado do trecho aberto', () => {
  const b = new SegmentBuilder({ sampleRate: SR, preRollMs: 0 });
  assert.equal(b.peek(), null);
  feed(b, 500, true);
  const audio = b.peek();
  assert.ok(audio && Math.abs(audio.length - 0.5 * SR) < BLOCK);
});

test('EnergyVad detecta fala por RMS e adapta o piso de ruído', () => {
  const v = new EnergyVad({ sampleRate: SR, silenceMs: 250, preRollMs: 0 });
  const out: AudioSegment[] = [];
  v.onSegment = (s) => out.push(s);
  const quiet = new Float32Array(BLOCK).fill(0.001);
  const loud = new Float32Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) loud[i] = 0.3 * Math.sin(i / 3);
  for (let i = 0; i < blocks(500); i++) v.push(quiet);
  for (let i = 0; i < blocks(600); i++) v.push(loud);
  assert.equal(v.isSpeaking, true);
  for (let i = 0; i < blocks(400); i++) v.push(quiet);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.reason, 'silence');
});
