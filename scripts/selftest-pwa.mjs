#!/usr/bin/env node
// Autoteste do PWA: serve pwa/dist, abre no Chrome headless com um arquivo WAV de fala em
// inglês como microfone falso, clica em Iniciar e espera uma frase transcrita e traduzida.
//
// Uso: node scripts/selftest-pwa.mjs [caminho-do-chrome]   (precisa de `pnpm pwa:build` antes)

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

const chrome = process.argv[2] ?? process.env.CHROME_BIN ?? 'google-chrome';
const dist = new URL('../pwa/dist', import.meta.url).pathname;
const base = '/video-translate/';
if (!existsSync(join(dist, 'index.html'))) { console.error('rode pnpm pwa:build antes'); process.exit(1); }

// Áudio de fala em inglês (JFK, 11 s, 16 kHz mono) dos exemplos do transformers.js.
const WAV_URL = 'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav';
const work = mkdtempSync(join(tmpdir(), 'vt-pwa-'));
const wav = join(work, 'speech.wav');
const res = await fetch(WAV_URL);
if (!res.ok) { console.error('não baixou o wav de teste', res.status); process.exit(1); }
writeFileSync(wav, Buffer.from(await res.arrayBuffer()));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.png': 'image/png' };
const server = createServer((req, res2) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!p.startsWith(base)) { res2.statusCode = 404; return res2.end(); }
  p = p.slice(base.length) || 'index.html';
  const file = join(dist, p);
  if (!existsSync(file) || statSync(file).isDirectory()) { res2.statusCode = 404; return res2.end('404'); }
  res2.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(res2);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}${base}`;

const port = 9334;
const profile = join(work, 'profile');
const proc = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--enable-unsafe-webgpu',
  '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`,
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore'] });
const cleanup = () => { try { proc.kill(); } catch {} try { server.close(); } catch {} try { rmSync(work, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let page;
for (let i = 0; i < 50 && !page; i++) {
  await sleep(300);
  try { page = await (await fetch(`http://127.0.0.1:${port}/json/new?${url}`, { method: 'PUT' })).json(); } catch {}
}
if (!page) { console.error('Chrome não respondeu'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
let n = 0;
const evaluate = (expression, awaitPromise = false) => new Promise((resolve) => {
  const id = ++n;
  const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', h); resolve(m.result?.result?.value ?? m.result?.exceptionDetails?.text); } };
  ws.addEventListener('message', h);
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise, returnByValue: true } }));
});
const fmt = (args) => args.map((a) => a.value ?? a.description ?? '').join(' ');
let errors = 0;
await new Promise((resolve) => { ws.onopen = () => { ws.send(JSON.stringify({ id: ++n, method: 'Runtime.enable' })); ws.send(JSON.stringify({ id: ++n, method: 'Log.enable' })); resolve(); }; });
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') { errors++; console.log('[exception]', m.params.exceptionDetails.exception?.description?.slice(0, 300)); }
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') { errors++; console.log('[console.error]', fmt(m.params.args).slice(0, 300)); }
  else if (m.method === 'Runtime.consoleAPICalled' && /stt-worker|mt-worker/.test(fmt(m.params.args))) console.log('[log]', fmt(m.params.args).slice(0, 200));
});
await sleep(2500);
console.log('título:', await evaluate('document.title'), '| versão:', await evaluate('document.querySelector(".version")?.textContent'));
console.log('clique em Iniciar:', await evaluate('(document.querySelector("#toggle")?.click(), "ok")'));

// O arquivo de 11 s toca em loop no microfone falso; espera modelo + frase + tradução.
let en = '', pt = '', status = '';
const deadline = Date.now() + 8 * 60 * 1000;
while (Date.now() < deadline) {
  await sleep(2000);
  status = (await evaluate('document.querySelector(".header .grow")?.textContent ?? ""')) ?? '';
  en = (await evaluate('document.querySelector(".card .en")?.textContent ?? ""')) ?? '';
  pt = (await evaluate('[...document.querySelectorAll(".card .pt")].map(e => e.textContent).find(t => t && t !== "…" && !/baixando/.test(t)) ?? ""')) ?? '';
  if (en && pt) break;
  if (/^Erro/.test(status)) break;
}
const cfg = (await evaluate('document.querySelector(".config-line")?.textContent ?? ""')) ?? '';
console.log('configuração:', cfg);
console.log('status:', status);
console.log('frase EN:', en || '(nenhuma)');
console.log('frase PT:', pt || '(nenhuma)');
const ok = /\p{L}{3,}/u.test(en) && /\p{L}{3,}/u.test(pt) && !/falhou/.test(pt) && errors === 0 && /Moonshine tiny/.test(cfg) && /Normal/.test(cfg);
console.log(ok ? 'PWA OK' : `PWA FALHOU (erros de console: ${errors})`);
ws.close();
cleanup();
await sleep(1000);
process.exit(ok ? 0 : 2);
