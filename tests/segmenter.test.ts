import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SentenceSegmenter, splitSentences, normalize } from '../src/lib/segmenter.ts';

test('divide em frases por . ? !', () => {
  const r = splitSentences('Hello there. How are you? Great! Still going');
  assert.deepEqual(r.sentences, ['Hello there.', 'How are you?', 'Great!']);
  assert.equal(r.rest, 'Still going');
});

test('preserva abreviações, iniciais e decimais', () => {
  const r = splitSentences('Mr. Smith met Dr. J. K. Rowling at 3.14 p.m. today. Then he left.');
  assert.deepEqual(r.sentences, ['Mr. Smith met Dr. J. K. Rowling at 3.14 p.m. today.', 'Then he left.']);
  assert.equal(r.rest, '');
});

test('e.g. e reticências não quebram a frase no meio', () => {
  const r = splitSentences('Use fruits, e.g. apples... and pears. Done.');
  assert.deepEqual(r.sentences, ['Use fruits, e.g. apples... and pears.', 'Done.']);
});

test('pontuação seguida de aspas fica na frase', () => {
  const r = splitSentences('He said "stop." Then silence.');
  assert.deepEqual(r.sentences, ['He said "stop."', 'Then silence.']);
});

test('junta restos sem pontuação com o próximo final', () => {
  const seg = new SentenceSegmenter();
  assert.deepEqual(seg.push('and my goal is for you to come away', 1000), []);
  assert.equal(seg.pending, 'and my goal is for you to come away');
  const out = seg.push('feeling like you could have invented calculus yourself. Next', 2000);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.text, 'and my goal is for you to come away feeling like you could have invented calculus yourself.');
  assert.equal(out[0]!.forced, false);
  assert.equal(seg.pending, 'Next');
});

test('força fechamento por tamanho', () => {
  const seg = new SentenceSegmenter({ maxChars: 40 });
  const out = seg.push('this is a long run on sentence without any punctuation at all', 0);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.forced, true);
  assert.equal(seg.pending, '');
});

test('força fechamento por tempo sem pontuação', () => {
  const seg = new SentenceSegmenter({ maxWaitMs: 5000 });
  assert.deepEqual(seg.push('waiting for more', 0), []);
  assert.deepEqual(seg.flushIfStale(3000), []);
  const out = seg.flushIfStale(5000);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.text, 'waiting for more');
  assert.equal(out[0]!.forced, true);
});

test('o relógio do resto reinicia quando uma frase fecha', () => {
  const seg = new SentenceSegmenter({ maxWaitMs: 5000 });
  seg.push('first part', 0);
  const out = seg.push('done. second part', 4000);
  assert.equal(out.length, 1);
  assert.equal(seg.pending, 'second part');
  assert.deepEqual(seg.flushIfStale(8000), []); // só 4 s desde 4000
  assert.equal(seg.flushIfStale(9000).length, 1);
});

test('ignora vazios e só pontuação', () => {
  assert.equal(normalize('   '), '');
  assert.equal(normalize('...'), '');
  assert.equal(normalize('  hello   world '), 'hello world');
  const seg = new SentenceSegmenter();
  assert.deepEqual(seg.push('.', 0), []);
  assert.equal(seg.pending, '');
});

test('ids são sequenciais e flush fecha o resto', () => {
  const seg = new SentenceSegmenter();
  const a = seg.push('One. Two.', 0);
  assert.deepEqual(a.map((s) => s.id), [1, 2]);
  seg.push('three', 0);
  const b = seg.flush(10);
  assert.equal(b[0]!.id, 3);
  assert.equal(b[0]!.text, 'three');
});
