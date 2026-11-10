// Painel lateral ("drawer") injetado sob demanda na aba capturada. Cria um host com
// Shadow DOM fixo à direita contendo um iframe com viewer.html (página da extensão,
// com todas as permissões). Só o invólucro mora na página.

import { BACKGROUND_TARGET, isDrawerMessage } from '@/lib/messages';

declare global {
  interface Window {
    __videoTranslateDrawer?: { close: () => void };
  }
}

const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 280;
const WIDTH_KEY = 'videoTranslate.drawerWidth';

export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  main() {
    if (window.__videoTranslateDrawer) return; // já injetado (reinjeção após navegação SPA)
    if (window !== window.top) return; // só no documento principal

    const params = new URLSearchParams(location.search);
    void params;

    const host = document.createElement('div');
    host.id = 'video-translate-drawer';
    host.setAttribute('data-video-translate', '');
    const shadow = host.attachShadow({ mode: 'open' });

    let width = DEFAULT_WIDTH;
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      if (saved >= MIN_WIDTH) width = saved;
    } catch {
      /* localStorage pode estar bloqueado */
    }

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .panel {
        position: fixed; top: 0; right: 0; height: 100vh; width: ${width}px;
        z-index: 2147483647; display: flex; flex-direction: row;
        background: #15171b; box-shadow: -4px 0 16px rgba(0,0,0,.35);
        font-family: system-ui, sans-serif; transition: transform .2s ease;
      }
      .panel.collapsed { transform: translateX(100%); box-shadow: none; }
      .handle {
        width: 6px; cursor: ew-resize; background: transparent; flex: none;
      }
      .handle:hover, .handle.dragging { background: rgba(63,193,169,.5); }
      .frame { flex: 1; border: 0; width: 100%; height: 100%; background: #15171b; color-scheme: light dark; }
      .bar {
        position: absolute; top: 8px; right: 100%; display: flex; flex-direction: column; gap: 6px;
        margin-right: 6px;
      }
      .btn {
        width: 28px; height: 28px; border-radius: 6px; border: 1px solid rgba(255,255,255,.2);
        background: rgba(21,23,27,.92); color: #e8e9ec; cursor: pointer; font-size: 14px; line-height: 26px;
        text-align: center; padding: 0; box-shadow: 0 1px 4px rgba(0,0,0,.3);
      }
      .btn:hover { background: #2c3037; }
      .tab {
        position: fixed; top: 40%; right: 0; z-index: 2147483647; display: none;
        writing-mode: vertical-rl; transform: rotate(180deg);
        background: #0a7c6a; color: #fff; padding: 10px 6px; border-radius: 0 8px 8px 0;
        font: 600 12px system-ui, sans-serif; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.35);
        letter-spacing: .3px;
      }
      .tab.visible { display: block; }
      .overlay { position: fixed; inset: 0; z-index: 2147483646; display: none; cursor: ew-resize; }
      .overlay.visible { display: block; }
    `;

    const panel = document.createElement('div');
    panel.className = 'panel';
    const handle = document.createElement('div');
    handle.className = 'handle';
    handle.title = 'Arraste para redimensionar';
    const frame = document.createElement('iframe');
    frame.className = 'frame';
    frame.allow = 'clipboard-write';
    frame.src = browser.runtime.getURL(`/viewer.html?mode=drawer&t=${Date.now()}` as never);

    const bar = document.createElement('div');
    bar.className = 'bar';
    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'btn';
    collapseBtn.textContent = '›';
    collapseBtn.title = 'Recolher (a captura continua)';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Fechar e parar a captura';
    bar.append(collapseBtn, closeBtn);

    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.textContent = 'Video Translate';
    tab.title = 'Reabrir o painel';

    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    panel.append(handle, frame, bar);
    shadow.append(style, panel, tab, overlay);
    document.documentElement.appendChild(host);

    // ---- Redimensionar arrastando a borda esquerda ----
    let dragging = false;
    let startX = 0;
    let startWidth = width;
    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      startX = e.clientX;
      startWidth = width;
      handle.classList.add('dragging');
      overlay.classList.add('visible'); // captura o mouse sobre o iframe
      e.preventDefault();
    });
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      width = Math.min(window.innerWidth - 80, Math.max(MIN_WIDTH, startWidth + (startX - e.clientX)));
      panel.style.width = `${width}px`;
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      overlay.classList.remove('visible');
      try {
        localStorage.setItem(WIDTH_KEY, String(width));
      } catch {
        /* ignora */
      }
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);

    // ---- Recolher / reabrir / fechar ----
    const collapse = () => {
      panel.classList.add('collapsed');
      tab.classList.add('visible');
    };
    const expand = () => {
      panel.classList.remove('collapsed');
      tab.classList.remove('visible');
    };
    collapseBtn.addEventListener('click', collapse);
    tab.addEventListener('click', expand);

    // ---- Título da página → contexto da tradução (muda em navegação SPA, próximo episódio) ----
    let lastTitle = '';
    const sendTitle = () => {
      const title = document.title.trim();
      if (!title || title === lastTitle) return;
      lastTitle = title;
      browser.runtime.sendMessage({ target: BACKGROUND_TARGET, type: 'tab-title', title, url: location.href }).catch(() => undefined);
    };
    const titleObserver = new MutationObserver(sendTitle);
    const watchTitle = () => {
      titleObserver.disconnect();
      const el = document.querySelector('title');
      if (el) titleObserver.observe(el, { childList: true, characterData: true, subtree: true });
      // Sites que trocam o <title> inteiro (ou o definem com document.title) sem mutação visível:
      titleObserver.observe(document.head ?? document.documentElement, { childList: true });
    };
    watchTitle();
    const titleTimer = window.setInterval(sendTitle, 2000);
    sendTitle();

    const remove = () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      browser.runtime.onMessage.removeListener(onMessage);
      titleObserver.disconnect();
      window.clearInterval(titleTimer);
      host.remove();
      delete window.__videoTranslateDrawer;
    };
    closeBtn.addEventListener('click', () => {
      remove();
      browser.runtime.sendMessage({ target: BACKGROUND_TARGET, type: 'drawer-closed' }).catch(() => undefined);
    });

    const onMessage = (msg: unknown, _sender: unknown, sendResponse: (r: unknown) => void) => {
      if (!isDrawerMessage(msg)) return;
      if (msg.type === 'ping') {
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === 'close') {
        remove();
        sendResponse({ ok: true });
      }
    };
    browser.runtime.onMessage.addListener(onMessage);

    window.__videoTranslateDrawer = { close: remove };
  },
});
