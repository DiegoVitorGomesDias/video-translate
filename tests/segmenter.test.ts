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

test('força fechamento por tamanho, cortando num limite de palavra e guardando o resto', () => {
  const seg = new SentenceSegmenter({ maxChars: 40 });
  const out = seg.push('this is a long run on sentence without any punctuation at all', 0);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.forced, true);
  assert.ok(out[0]!.text.length <= 40);
  assert.equal(`${out[0]!.text} ${seg.pending}`, 'this is a long run on sentence without any punctuation at all');
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

// ---- Frases coladas e fechamento por pausa (v0.4.1) ----
import { splitGlued, cutAt } from '../src/lib/segmenter.ts';

test('separa frases coladas antes de iniciadores em maiúscula', () => {
  const a = splitSentences("I don't know who She and she is practically living together What did you just order?");
  assert.equal(a.sentences.at(-1), 'What did you just order?');
  assert.ok(!a.sentences.some((s) => s.includes('living together') && s.includes('What did')));
  const b = splitSentences("That's what leads you to sandpaper yes but i don't like eating the same thing two days in a row You froze nursing");
  assert.ok(b.sentences.some((s) => s.endsWith('two days in a row')));
  assert.equal(b.rest, 'You froze nursing');
});

test('não quebra em nomes próprios, títulos nem após vírgula', () => {
  assert.deepEqual(splitGlued('I talked to Doctor House yesterday'), ['I talked to Doctor House yesterday']);
  assert.deepEqual(splitGlued('We went to New York'), ['We went to New York']);
  assert.deepEqual(splitGlued('I think, So do I'), ['I think, So do I']);
  assert.deepEqual(splitGlued('so I said Yes'), ['so I said Yes']); // fragmento final de 1 palavra não quebra
});

test('fechamento por pausa encerra a frase sem pontuação', () => {
  const seg = new SentenceSegmenter();
  const out = seg.push('and my goal is for you to come away', 0, 'silence');
  assert.equal(out.length, 1);
  assert.equal(out[0]!.text, 'and my goal is for you to come away');
  assert.equal(out[0]!.forced, false);
  assert.equal(seg.pending, '');
  // Já com trecho cortado por tamanho, o resto espera o próximo final.
  assert.deepEqual(seg.push('feeling like you could', 0, 'max-length'), []);
  assert.equal(seg.pending, 'feeling like you could');
});

test('limite de 90 caracteres corta na vírgula ou conjunção', () => {
  const seg = new SentenceSegmenter();
  const text = 'the first part of this very long sentence goes on and on without any stop, and then the second part keeps going even further than that';
  const out = seg.push(text, 0, 'max-length');
  assert.ok(out.length >= 1);
  assert.ok(out[0]!.text.endsWith('without any stop,') || out[0]!.text.endsWith('without any stop'));
  const [head, tail] = cutAt('alpha beta gamma and delta epsilon zeta', 25);
  assert.equal(head, 'alpha beta gamma');
  assert.equal(tail, 'and delta epsilon zeta');
});
