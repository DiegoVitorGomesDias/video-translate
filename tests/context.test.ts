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

// ---- Assunto do vídeo: metadados da página, nomes em prosa, palavras-chave, prompt ----

import { pageContextFromMeta, extractNamesFromText, extractKeywords, cleanDescription, buildVideoContext, topicPrompt, contextPhrases } from '../src/lib/context.ts';

const HOUSE_DESCRIPTION =
  'Dr. Gregory House is a brilliant but misanthropic doctor who leads a team of diagnosticians at Princeton-Plainsboro Teaching Hospital. In this episode, a kindergarten teacher collapses.';

test('metadados da página: descrição mais longa, canal do DOM, tags de og:video:tag e keywords', () => {
  const page = pageContextFromMeta({
    metas: [
      { key: 'description', content: 'Dr. Gregory House is a brilliant but misanthropic doctor...' },
      { key: 'og:description', content: HOUSE_DESCRIPTION },
      { key: 'og:site_name', content: 'YouTube' },
      { key: 'og:video:tag', content: 'house md' },
      { key: 'og:video:tag', content: 'Hugh Laurie' },
      { key: 'keywords', content: 'medical drama, lupus, house md' },
    ],
    ldJson: ['{"@type":"VideoObject","description":"short","author":"House M.D. Official"}', 'não é json'],
    domChannel: 'House M.D.',
  });
  assert.equal(page.description, HOUSE_DESCRIPTION);
  assert.equal(page.channel, 'House M.D.');
  assert.equal(page.siteName, 'YouTube');
  assert.deepEqual(page.tags, ['house md', 'Hugh Laurie', 'medical drama', 'lupus']);
});

test('metadados: autor do JSON-LD (objeto) quando o DOM não tem canal; sem metas dá vazio', () => {
  const page = pageContextFromMeta({ metas: [], ldJson: ['{"@graph":[{"@type":"Movie","description":"A heist.","author":{"name":"Studio X"},"genre":["Crime","Thriller"]}]}'] });
  assert.equal(page.description, 'A heist.');
  assert.equal(page.channel, 'Studio X');
  assert.deepEqual(page.tags, ['Crime', 'Thriller']);
  assert.deepEqual(pageContextFromMeta({ metas: [], ldJson: [] }), { description: '', channel: '', siteName: '', tags: [] });
});

test('nomes em prosa: honorífico no início, sequências no meio, nunca a maiúscula da frase sozinha', () => {
  assert.deepEqual(extractNamesFromText(HOUSE_DESCRIPTION), ['Dr. Gregory House', 'Gregory House', 'Gregory', 'Princeton-Plainsboro Teaching Hospital', 'Princeton-Plainsboro']);
  // "Paris" é palavra comum: sozinha no meio da frase não vale; no início da frase só uma sequência de 2+ incomuns.
  assert.deepEqual(extractNamesFromText('The team visits Paris and Gotham. Hugh Laurie stars as the doctor. Subscribe at https://x.y/z #house'), ['Gotham', 'Hugh Laurie']);
  assert.deepEqual(extractNamesFromText('Season 2 starts now. I think so. English is hard.'), []);
});

test('palavras-chave: fora das palavras comuns, por frequência, flexões juntas', () => {
  const kws = extractKeywords(['The eigenvalues of the matrix tell us the behaviour of the Markov chain.', 'An eigenvector is scaled by its eigenvalue.', 'The matrix is stochastic.'], 5);
  assert.deepEqual(kws.slice(0, 2).sort(), ['eigenvalue', 'matrix']);
  assert.ok(kws.includes('Markov') && kws.includes('eigenvector'));
  // Fala: só repetidas (minCount 2); "patient" é comum mas não está entre as ~800 mais frequentes.
  const spoken = extractKeywords(['The patient has a fever.', 'Yeah, the patient is okay now, I think.', 'Okay, yeah.'], 5, 2);
  assert.deepEqual(spoken, ['patient']);
});

test('descrição limpa: sem links, hashtags, chamadas e marcas de tempo; cortada em frase', () => {
  const d = cleanDescription('Subscribe to my channel! https://x.y/z\nIn this video we explore the eigenvalues of a matrix and why they matter for Markov chains. 🔥\n0:00 Intro\nHelp fund future projects:\nFollow me @me #math');
  assert.equal(d, 'In this video we explore the eigenvalues of a matrix and why they matter for Markov chains.');
  const long = cleanDescription(`${HOUSE_DESCRIPTION} ${HOUSE_DESCRIPTION}`, 160);
  assert.ok(long.length <= 161 && long.endsWith('.'), long);
  assert.equal(cleanDescription('Dr. House returns. Short.'), 'Dr. House returns.');
});

test('contexto completo: nomes do título, descrição e tags; palavras-chave da página e da fala; prompt', () => {
  const page = { description: HOUSE_DESCRIPTION, channel: 'House M.D.', siteName: 'YouTube', tags: ['house md', 'Hugh Laurie', 'medical drama', 'lupus'] };
  const spoken = ['The patient has a fever and the MRI shows nothing.', 'Run the blood test again, Cuddy wants results.', 'It is not lupus.', 'The patient is seizing!', 'Lupus would explain the fever.'];
  const ctx = buildVideoContext({ tabTitle: 'House M.D. - Everybody Lies | Prime Video', page, useTabContext: true, glossary: 'Cuddy', ignoredTerms: ['everybody lies'], spokenTexts: spoken });
  assert.equal(ctx.title, 'House M.D. - Everybody Lies');
  assert.equal(ctx.channel, 'House M.D.');
  for (const n of ['Cuddy', 'House', 'House M.D.', 'Dr. Gregory House', 'Hugh Laurie', 'Princeton-Plainsboro Teaching Hospital']) assert.ok(ctx.names.includes(n), n);
  assert.ok(!ctx.names.includes('Everybody Lies'), 'ignorado');
  assert.ok(ctx.keywords.includes('lupus') && ctx.keywords.includes('diagnosticians'), ctx.keywords.join(','));
  assert.ok(!ctx.keywords.some((k) => k.toLowerCase() === 'gregory'), 'palavra de nome não vira palavra-chave');
  assert.deepEqual(ctx.spoken, ['fever', 'patient']);
  const prompt = topicPrompt(ctx);
  assert.ok(prompt.startsWith('House M.D. - Everybody Lies. Dr. Gregory House is a brilliant'), prompt);
  assert.ok(prompt.endsWith('fever, patient.'), prompt);
  assert.ok(prompt.length <= 360, String(prompt.length));
  const phrases = contextPhrases(ctx);
  assert.ok(phrases.includes('Cuddy') && phrases.includes('lupus') && phrases.includes('patient'));
  // Sem contexto da aba: só glossário e assunto digitado.
  const off = buildVideoContext({ tabTitle: 'House M.D. | Prime Video', page, useTabContext: false, glossary: 'Cuddy', ignoredTerms: [], topic: 'A medical drama.' });
  assert.deepEqual(off.names, ['Cuddy']);
  assert.deepEqual(off.keywords, []);
  assert.equal(topicPrompt(off), 'A medical drama.');
  assert.equal(topicPrompt(buildVideoContext({ tabTitle: '', useTabContext: true, glossary: '', ignoredTerms: [] })), '');
});

test('prompt do assunto: canal entra quando não está no título; descrição é cortada antes das palavras-chave', () => {
  const ctx = buildVideoContext({
    tabTitle: 'Essence of linear algebra, chapter 14: Eigenvectors and eigenvalues - YouTube',
    page: { description: 'A visual understanding of eigenvectors, eigenvalues, and the usefulness of an eigenbasis. '.repeat(6), channel: '3Blue1Brown', siteName: 'YouTube', tags: ['linear algebra', 'eigenvectors'] },
    useTabContext: true,
    glossary: '',
    ignoredTerms: [],
  });
  const prompt = topicPrompt(ctx, 200);
  assert.ok(prompt.includes('(3Blue1Brown)'), prompt);
  assert.ok(prompt.length <= 200, String(prompt.length));
  assert.ok(/eigenvalues\.$/i.test(prompt) || /Eigenvectors.*\.$/.test(prompt), prompt);
});
