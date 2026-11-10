import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTermsFromTitle, cleanTitle, parseGlossary, mergeTerms } from '../src/lib/context.ts';
import { protectTerms } from '../src/lib/context.ts';
import { correctTranscript, editDistance } from '../src/lib/context.ts';

// ---- Título → termos ----

test('Prime Video: nome da série vira termo, mesmo sendo palavra comum', () => {
  assert.deepEqual(extractTermsFromTitle('Prime Video: House'), ['House']);
  assert.deepEqual(extractTermsFromTitle('Watch House - Season 1 | Prime Video'), ['House']);
  assert.deepEqual(extractTermsFromTitle('Amazon.com: House: Season 1'), ['House']);
});

test('honorífico entra com e sem o nome', () => {
  assert.deepEqual(extractTermsFromTitle('Prime Video: Dr. House'), ['Dr. House', 'House']);
});

test('YouTube: contador, nome do site e palavras comuns em Title Case ficam de fora', () => {
  assert.deepEqual(extractTermsFromTitle('(3) How To Bake A Cake - YouTube'), []);
  assert.deepEqual(extractTermsFromTitle('Linear Algebra Explained in 10 Minutes - YouTube'), []);
  assert.deepEqual(extractTermsFromTitle('Hugh Laurie Interview With Stephen Colbert - YouTube'), ['Hugh Laurie', 'Hugh', 'Laurie']);
  assert.deepEqual(extractTermsFromTitle('Dr. Wilson Explains Lupus In 5 Minutes - YouTube').slice(0, 2), ['Dr. Wilson', 'Wilson']);
});

test('nomes de pessoas em título em sentence case', () => {
  assert.deepEqual(extractTermsFromTitle('Why Hugh Laurie was perfect as House - YouTube'), ['Hugh Laurie', 'Hugh', 'Laurie', 'House']);
});

test('nomes compostos com conectores e metadados', () => {
  assert.deepEqual(extractTermsFromTitle('The Lord of the Rings: The Fellowship of the Ring - Netflix'), ['The Lord of the Rings', 'Rings', 'Fellowship of the Ring', 'Fellowship']);
  assert.deepEqual(extractTermsFromTitle('House M.D. - Everybody Lies | Prime Video'), ['House M.D.', 'House', 'Everybody Lies']);
  assert.deepEqual(extractTermsFromTitle('Minecraft Survival Ep. 12: The Nether - YouTube'), ['Minecraft Survival', 'Minecraft', 'The Nether']);
  assert.deepEqual(extractTermsFromTitle('Breaking Bad - S01E02 - Netflix'), ['Breaking Bad']);
  assert.deepEqual(extractTermsFromTitle('Stranger Things | Netflix Official Site'), ['Stranger Things']);
});

test('título só com site não gera termos', () => {
  assert.deepEqual(extractTermsFromTitle('Netflix'), []);
  assert.deepEqual(extractTermsFromTitle('YouTube'), []);
  assert.deepEqual(cleanTitle('(1) YouTube'), []);
});

test('glossário manual e união', () => {
  assert.deepEqual(parseGlossary('Cuddy, Wilson\nDr. House;cuddy'), ['Cuddy', 'Wilson', 'Dr. House']);
  assert.deepEqual(mergeTerms(['House'], ['Dr. House', 'house', 'Wilson']), ['Dr. House', 'Wilson', 'House']);
});

// ---- Proteção na tradução ----

test('protege só a palavra inteira com maiúscula e restaura', () => {
  const p = protectTerms('House said the house is empty. Dr. House agreed.', ['Dr. House', 'House']);
  assert.equal(p.text, '702 said the house is empty. 701 agreed.');
  assert.deepEqual(p.hits, ['Dr. House', 'House']);
  assert.equal(p.restore('702 disse que a casa está vazia. 701 concordou.'), 'House disse que a casa está vazia. Dr. House concordou.');
});

test('restore devolve null quando o tradutor estragou um marcador', () => {
  const p = protectTerms('House is here.', ['House']);
  assert.equal(p.restore('Casa está aqui.'), null);
  assert.equal(p.restore('701 e 701 estão aqui.'), null);
  assert.equal(p.restore('7011 está aqui.'), null);
});

test('sem termos no texto não há marcadores', () => {
  const p = protectTerms('Nothing to see here.', ['House']);
  assert.equal(p.text, 'Nothing to see here.');
  assert.deepEqual(p.hits, []);
  assert.equal(p.restore('Nada para ver aqui.'), 'Nada para ver aqui.');
});

test('possessivo e pontuação colada', () => {
  const p = protectTerms("That's House's idea, Wilson.", ['Wilson', 'House']);
  assert.equal(p.text, "That's 702's idea, 701.");
  assert.equal(p.restore('Essa é a ideia de 702, 701.'), 'Essa é a ideia de House, Wilson.');
});

// ---- Correção da transcrição ----

test('distância de edição', () => {
  assert.equal(editDistance('cutty', 'cuddy'), 2);
  assert.equal(editDistance('wilson', 'willson'), 1);
  assert.equal(editDistance('abc', 'abc'), 0);
  assert.equal(editDistance('abc', 'xyz', 1), 2);
});

test('corrige nomes parecidos e mantém pontuação', () => {
  assert.equal(correctTranscript('Tell Willson and Cutty, now.', ['Wilson', 'Cuddy']), 'Tell Wilson and Cuddy, now.');
  assert.equal(correctTranscript('Dr. Foreman and Dr. Chace.', ['Foreman', 'Chase']), 'Dr. Foreman and Dr. Chase.');
});

test('não mexe em palavras comuns nem em flexões', () => {
  assert.equal(correctTranscript('Get out of my house.', ['House']), 'Get out of my house.');
  assert.equal(correctTranscript('My buddy is here.', ['Cuddy']), 'My buddy is here.');
  assert.equal(correctTranscript('The houses are big.', ['House']), 'The houses are big.');
  assert.equal(correctTranscript('The mouse ran.', ['House']), 'The mouse ran.');
  assert.equal(correctTranscript('Wilsons are here.', ['Wilson']), 'Wilsons are here.');
});

test('termo composto casa exatamente e ajusta capitalização', () => {
  assert.equal(correctTranscript('I saw dr. house yesterday.', ['Dr. House']), 'I saw Dr. House yesterday.');
  assert.equal(correctTranscript('we need hugh lauri here', ['Hugh Laurie']), 'we need Hugh Laurie here');
  assert.equal(correctTranscript('It was Hugh. Laurie came later.', ['Hugh Laurie']), 'It was Hugh. Laurie came later.');
});

test('termos curtos só casam exatamente', () => {
  assert.equal(correctTranscript('Bob and Rob.', ['Bob']), 'Bob and Rob.');
});
