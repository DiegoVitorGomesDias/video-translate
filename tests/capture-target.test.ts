import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseCaptureTab, isCapturablePage } from '../src/lib/capture-target.ts';

test('aba com URL escondida (sem activeTab) é capturável; páginas da extensão e do Chrome não', () => {
  assert.ok(isCapturablePage({ id: 2 }));
  assert.ok(isCapturablePage({ id: 2, url: '' }));
  assert.ok(isCapturablePage({ id: 3, url: 'https://www.youtube.com/watch?v=x' }));
  assert.equal(isCapturablePage({ id: 4, url: 'chrome-extension://abc/viewer.html' }), false);
  assert.equal(isCapturablePage({ id: 5, url: 'chrome://extensions' }), false);
  assert.equal(isCapturablePage({ url: 'https://a.com' }), false);
  assert.equal(isCapturablePage(undefined), false);
});

test('regressão: a aba indicada pelo viewer vence mesmo sem URL visível, e não a da captura anterior', () => {
  const nova = { id: 20 }; // aba B, nunca recebeu clique no ícone: URL escondida
  const anterior = { id: 10, url: 'https://www.primevideo.com/' };
  assert.equal(chooseCaptureTab([nova, anterior]), nova);
});

test('candidatas vazias ou inválidas são puladas na ordem', () => {
  const drawer = { id: 7, url: 'https://site.com/video' };
  assert.equal(chooseCaptureTab([undefined, { id: 1, url: 'chrome-extension://x/viewer.html' }, drawer]), drawer);
  assert.equal(chooseCaptureTab([undefined, undefined]), undefined);
});
