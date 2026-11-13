import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collapseCharRuns, collapseRepetitions, checkRepetition, maxNewTokensFor } from '../src/lib/stt/repetition.ts';

test('grito "HHHHHH..." some e o trecho é marcado como alucinação', () => {
  const r = checkRepetition('H'.repeat(300));
  assert.equal(r.text, '');
  assert.ok(r.looped);
});

test('run de caracteres no meio da frase é reduzido; "AHAHAHAH" longo some', () => {
  assert.equal(collapseCharRuns('Nooooooooooo! Stop.'), 'Nooo! Stop.');
  assert.equal(collapseCharRuns('He said ' + 'AH'.repeat(40) + ' and left'), 'He said and left');
  assert.equal(collapseCharRuns('Well... yes'), 'Well... yes');
  assert.equal(collapseCharRuns('Mississippi 1000000'), 'Mississippi 1000000');
});


test('laço de 3 palavras é colapsado e marcado como alucinação', () => {
  const loop = 'I\'m going to do a little bit of a little bit ' + 'of a bit '.repeat(80) + 'of a bit of';
  const r = checkRepetition(loop);
  assert.equal(r.text, "I'm going to do a little bit of a little bit of a bit of a bit of");
  assert.ok(r.looped);
  assert.ok(r.removed > 0.9);
});

test('tradução repetida também é colapsada', () => {
  assert.equal(collapseRepetitions('de um pouco '.repeat(50).trim()), 'de um pouco de um pouco');
});

test('fala normal não muda', () => {
  const t = 'How am I supposed to do a lumbar puncture in a patient with intractable hiccups?';
  const r = checkRepetition(t);
  assert.equal(r.text, t);
  assert.equal(r.removed, 0);
  assert.equal(r.looped, false);
});

test('repetição curta e legítima vira duas ocorrências, sem marcar laço', () => {
  const r = checkRepetition('No, no, no, no. Wait.');
  assert.equal(r.text, 'No, no, Wait.');
  assert.equal(r.looped, false);
});

test('duas ocorrências ficam intactas', () => {
  assert.equal(collapseRepetitions('very very good'), 'very very good');
  assert.equal(collapseRepetitions('bye bye'), 'bye bye');
});

test('n-grama maior prevalece sobre o menor', () => {
  assert.equal(collapseRepetitions('go go go go go go'), 'go go');
  assert.equal(collapseRepetitions('I said no. I said no. I said no. I said no.'), 'I said no. I said no.');
});

test('limite de tokens cresce com a duração', () => {
  assert.equal(maxNewTokensFor(6), 84);
  assert.equal(maxNewTokensFor(0.4), 17);
  assert.ok(maxNewTokensFor(15) < 448);
});
