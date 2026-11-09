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
ws.close(); proc.kill();
process.exit(done ? 0 : 2);
