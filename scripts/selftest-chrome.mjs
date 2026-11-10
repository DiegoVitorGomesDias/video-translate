#!/usr/bin/env node
// Autoteste sem interação: abre um Chrome headless com a extensão de .output/chrome-mv3,
// navega para offscreen.html?selftest (carrega o modelo sem capturar áudio) e imprime o
// console até o modelo responder ou falhar. Não testa o tabCapture, só o runtime ONNX,
// o download do modelo e a inferência.
//
// Uso: node scripts/selftest-chrome.mjs [caminho-do-chrome]
//      (ou defina CHROME_BIN). Precisa de `pnpm build` antes.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = process.argv[2] ?? process.env.CHROME_BIN ?? 'google-chrome';
const extDir = new URL('../.output/chrome-mv3', import.meta.url).pathname;
const port = 9333;
const profile = mkdtempSync(join(tmpdir(), 'vt-profile-'));
// O perfil guarda os modelos baixados (~700 MB); apaga ao sair para não encher o /tmp.
const cleanupProfile = () => { try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanupProfile);
process.on('SIGINT', () => { proc?.kill(); process.exit(130); });
process.on('SIGTERM', () => { proc?.kill(); process.exit(143); });
let proc;
proc = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--disable-gpu-sandbox', '--enable-unsafe-webgpu',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  `--load-extension=${extDir}`, `--disable-extensions-except=${extDir}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = ''; proc.stderr.on('data', (d) => (stderr += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() { return (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); }
let extId = null;
for (let i = 0; i < 50 && !extId; i++) {
  await sleep(300);
  try {
    const list = await targets();
    const sw = list.find((t) => t.url.startsWith('chrome-extension://') && t.url.endsWith('background.js'));
    if (sw) extId = new URL(sw.url).host;
  } catch {}
}
if (!extId) { console.error('extensão não carregou', stderr.slice(-2000)); proc.kill(); process.exit(1); }
console.log('extension id', extId);

const res = await fetch(`http://127.0.0.1:${port}/json/new?chrome-extension://${extId}/offscreen.html?selftest`, { method: 'PUT' });
const page = await res.json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
const fmt = (args) => args.map((a) => a.value ?? a.description ?? JSON.stringify(a)).join(' ');
let done = false;
ws.onopen = () => { send('Runtime.enable'); send('Log.enable'); };
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.consoleAPICalled') {
    const text = fmt(m.params.args);
    if (!/Baixando/.test(text) || /100%/.test(text)) console.log(`[${m.params.type}]`, text.slice(0, 600));
    if (/SELFTEST resultado|SELFTEST FALHOU|Nenhum modelo carregou/.test(text)) done = true;
  } else if (m.method === 'Runtime.exceptionThrown') {
    console.log('[exception]', m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  } else if (m.method === 'Log.entryAdded') {
    console.log(`[log:${m.params.entry.level}]`, m.params.entry.text.slice(0, 400), m.params.entry.url ?? '');
  }
};
const deadline = Date.now() + 8 * 60 * 1000;
while (!done && Date.now() < deadline) await sleep(500);
if (!done) console.log('TIMEOUT esperando o autoteste');
ws.close();

// Páginas de UI: abre cada uma por alguns segundos e falha se houver exceção ou console.error.
let uiErrors = 0;
for (const page of ['viewer.html', 'options.html']) {
  let pageErrors = 0;
  const res2 = await fetch(`http://127.0.0.1:${port}/json/new?chrome-extension://${extId}/${page}`, { method: 'PUT' });
  const t = await res2.json();
  const ws2 = new WebSocket(t.webSocketDebuggerUrl);
  let n = 0;
  await new Promise((resolve) => {
    ws2.onopen = () => { ws2.send(JSON.stringify({ id: ++n, method: 'Runtime.enable' })); ws2.send(JSON.stringify({ id: ++n, method: 'Log.enable' })); };
    ws2.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') { pageErrors++; console.log(`[${page} exception]`, m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); }
      else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') { pageErrors++; console.log(`[${page} console.error]`, fmt(m.params.args).slice(0, 400)); }
      // Falhas de rede (ex.: LibreTranslate não está rodando) são esperadas e não contam.
      else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && m.params.entry.source !== 'network') { pageErrors++; console.log(`[${page} log:error]`, m.params.entry.text.slice(0, 400)); }
    };
    setTimeout(resolve, 4000);
  });
  // Confere que o React renderizou algo.
  ws2.send(JSON.stringify({ id: ++n, method: 'Runtime.evaluate', params: { expression: 'document.querySelector("#root")?.children.length ?? 0', returnByValue: true } }));
  const rendered = await new Promise((resolve) => {
    const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === n) { ws2.removeEventListener('message', h); resolve(m.result?.result?.value); } };
    ws2.addEventListener('message', h);
    setTimeout(() => resolve(undefined), 3000);
  });
  console.log(`[${page}] renderizou: ${rendered ? 'sim' : 'NÃO'}; erros: ${pageErrors}`);
  if (!rendered) pageErrors++;
  uiErrors += pageErrors;
  ws2.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`).catch(() => {});
}

// Abre a janela do viewer a partir do service worker (mesma chamada que o clique no
// ícone faz) e confere que um novo target viewer.html aparece.
let windowOk = false;
{
  const list = await targets();
  const sw = list.find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extId}/`));
  if (!sw) console.log('[window] service worker não encontrado (pode estar dormindo)');
  else {
    const ws3 = new WebSocket(sw.webSocketDebuggerUrl);
    await new Promise((resolve) => {
      ws3.onopen = () => ws3.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
        expression: "chrome.windows.create({ url: chrome.runtime.getURL('/viewer.html?selftest-window'), type: 'popup', width: 480, height: 720 }).then(w => 'ok:' + w.id)",
        awaitPromise: true, returnByValue: true } }));
      ws3.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id === 1) { console.log('[window] windows.create →', JSON.stringify(m.result?.result?.value ?? m.result?.exceptionDetails?.text ?? m.error)); resolve(); } };
      setTimeout(resolve, 5000);
    });
    ws3.close();
    for (let i = 0; i < 20 && !windowOk; i++) {
      await sleep(250);
      windowOk = (await targets()).some((t) => t.url.includes('viewer.html?selftest-window'));
    }
    console.log(`[window] target viewer.html apareceu: ${windowOk ? 'sim' : 'NÃO'}`);
  }
}

// Tradução: testa os dois fallbacks pela página de opções (botão "Testar fallback 2").
let mtOk = true;
for (const choice of ['google', 'local']) {
  const r = await fetch(`http://127.0.0.1:${port}/json/new?chrome-extension://${extId}/options.html`, { method: 'PUT' });
  const t = await r.json();
  const w = new WebSocket(t.webSocketDebuggerUrl);
  let n = 0;
  const evaluate = (expression, awaitPromise = false) => new Promise((resolve) => {
    const id = ++n;
    const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { w.removeEventListener('message', h); resolve(m.result?.result?.value); } };
    w.addEventListener('message', h);
    w.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise, returnByValue: true } }));
  });
  await new Promise((resolve) => { w.onopen = resolve; });
  await sleep(1500);
  await evaluate(`chrome.storage.local.get('options').then(d => chrome.storage.local.set({ options: { ...(d.options ?? {}), translationFallback: '${choice}' } }))`, true);
  await evaluate('location.reload()');
  await sleep(2000);
  await evaluate('document.querySelector("#test-fallback").click()');
  let result = '';
  const limit = Date.now() + (choice === 'local' ? 240000 : 20000);
  while (Date.now() < limit) {
    await sleep(1000);
    result = (await evaluate('document.querySelector("#fallback-result")?.textContent ?? ""')) ?? '';
    if (/^(OK|Falhou)/.test(result)) break;
  }
  console.log(`[translate:${choice}]`, result || 'TIMEOUT');
  const good = /^OK/.test(result) && /incr[íi]vel/i.test(result) && /segunda/i.test(result) && !/<</.test(result) && !/\b(el|les|est|une)\b/.test(result.replace(/"[^"]*" →/g, ''));
  if (!good) { mtOk = false; console.log(`[translate:${choice}] FALHOU na validação`); }
  w.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`).catch(() => {});
}

// Drawer: injeta o content script numa página simples (stub de chrome.runtime, já que
// o teste não consegue conceder permissão de host) e confere que o iframe do viewer carrega.
let drawerOk = false;
{
  const { readFileSync } = await import('node:fs');
  const { createServer } = await import('node:http');
  const code = readFileSync(`${extDir}/content-scripts/drawer.js`, 'utf8');
  // Página http de verdade: about:blank tem origem opaca e não casa com web_accessible_resources.
  const server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><h1>página de teste</h1><video></video>'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const pageUrl = `http://127.0.0.1:${server.address().port}/`;
  const r = await fetch(`http://127.0.0.1:${port}/json/new?${pageUrl}`, { method: 'PUT' });
  const t = await r.json();
  const w = new WebSocket(t.webSocketDebuggerUrl);
  let n = 0;
  const evaluate = (expression, awaitPromise = false) => new Promise((resolve) => {
    const id = ++n;
    const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { w.removeEventListener('message', h); resolve(m.result?.result?.value ?? m.result?.exceptionDetails?.text); } };
    w.addEventListener('message', h);
    w.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise, returnByValue: true } }));
  });
  await new Promise((resolve) => { w.onopen = resolve; });
  await sleep(1000);
  await evaluate(`window.chrome = { runtime: { id: '${extId}', getURL: (p) => 'chrome-extension://${extId}' + p, sendMessage: () => Promise.resolve(), onMessage: { addListener() {}, removeListener() {} } } }; 'ok'`);
  const injected = await evaluate(`try { ${code}; 'ok' } catch (e) { 'erro: ' + e.message }`);
  console.log('[drawer] injeção:', injected);
  for (let i = 0; i < 20 && !drawerOk; i++) {
    await sleep(250);
    const hasFrame = await evaluate(`!!document.querySelector('#video-translate-drawer')?.shadowRoot?.querySelector('iframe')`);
    const frameLoaded = (await targets()).some((x) => x.type === 'iframe' && x.url.includes('viewer.html?mode=drawer'));
    drawerOk = hasFrame && frameLoaded;
    if (i === 19 && !drawerOk) console.log('[drawer] debug: hasFrame=', hasFrame, 'targets=', (await targets()).map((x) => `${x.type}:${x.url.slice(0, 80)}`).join(' , '));
  }
  console.log(`[drawer] host com iframe do viewer carregado: ${drawerOk ? 'sim' : 'NÃO'}`);
  w.close();
  server.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`).catch(() => {});
}

proc.kill();
await sleep(1500);
process.exit(done && uiErrors === 0 && windowOk && mtOk && drawerOk ? 0 : 2);
