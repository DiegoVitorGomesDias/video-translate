import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agc, normalizePeak } from '../src/lib/audio/agc.ts';

const tone = (amp: number, n = 1024) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((i / 16000) * 2 * Math.PI * 220));
const peak = (a: Float32Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

test('AGC amplifica sinal baixo até o alvo, sem passar do ganho máximo', () => {
  const agc = new Agc({ target: 0.5, maxGain: 4 });
  let out = tone(0.05);
  for (let i = 0; i < 150; i++) out = agc.process(tone(0.05)); // ~10 s: o ganho sobe devagar
  assert.ok(agc.currentGain > 3.9 && agc.currentGain <= 4, `ganho ${agc.currentGain}`);
  assert.ok(peak(out) > 0.19 && peak(out) <= 0.2001);
});

test('AGC não amplifica sinal já alto e reduz o ganho na hora quando o som sobe', () => {
  const agc = new Agc({ target: 0.5, maxGain: 4 });
  for (let i = 0; i < 150; i++) agc.process(tone(0.05));
  const loud = agc.process(tone(0.8));
  assert.ok(agc.currentGain < 1.01);
  assert.ok(peak(loud) <= 1);
});

test('normalizePeak sobe trecho baixo e deixa o alto em paz', () => {
  const low = normalizePeak(tone(0.05), 0.9, 8);
  assert.ok(Math.abs(peak(low) - 0.4) < 0.01); // ganho máximo 8
  const high = tone(0.95);
  assert.equal(normalizePeak(high), high);
});
