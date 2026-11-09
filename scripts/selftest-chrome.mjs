#!/usr/bin/env node
// Autoteste sem interação: abre um Chrome headless com a extensão de .output/chrome-mv3,
// navega para offscreen.html?selftest (carrega o modelo sem capturar áudio) e imprime o
// console até o modelo responder ou falhar. Não testa o tabCapture, só o runtime ONNX,
// o download do modelo e a inferência.
//
// Uso: node scripts/selftest-chrome.mjs [caminho-do-chrome]
//      (ou defina CHROME_BIN). Precisa de `pnpm build` antes.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = process.argv[2] ?? process.env.CHROME_BIN ?? 'google-chrome';
const extDir = new URL('../.output/chrome-mv3', import.meta.url).pathname;
const port = 9333;
const profile = mkdtempSync(join(tmpdir(), 'vt-profile-'));
const proc = spawn(chrome, [
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

proc.kill();
process.exit(done && uiErrors === 0 ? 0 : 2);
