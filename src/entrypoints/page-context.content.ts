// Content script leve, injetado na aba capturada (scripting.executeScript, com activeTab) no
// início da captura, no botão "limpar" e quando a página termina de carregar. Lê os
// metadados do vídeo (título, descrição, canal, tags) e manda ao background, que os guarda
// no estado da captura e repassa ao offscreen (prompt do Whisper, phrases do Chrome) e ao
// viewer (nomes e assunto). Acompanha mudanças do título (navegação SPA: próximo vídeo ou
// episódio) e relê os metadados pouco depois, quando o site já os atualizou.

import { pageContextFromMeta, type RawPageMeta } from '@/lib/context';
import { BACKGROUND_TARGET } from '@/lib/messages';

declare global {
  interface Window {
    __videoTranslatePageContext?: { refresh: () => void };
  }
}

/** Texto visível de um elemento, limitado (descrições do YouTube podem ser longas). */
function textOf(selector: string, max = 2000): string {
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t) return t.slice(0, max);
  }
  return '';
}

function readPage(): RawPageMeta {
  const metas: RawPageMeta['metas'] = [];
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[content]')) {
    const key = m.getAttribute('property') || m.getAttribute('name') || m.getAttribute('itemprop') || '';
    if (key) metas.push({ key, content: m.content.slice(0, 3000) });
  }
  const ldJson: string[] = [];
  for (const s of document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')) {
    if (s.textContent && s.textContent.length < 200_000) ldJson.push(s.textContent);
  }
  return {
    metas,
    ldJson,
    // YouTube: descrição (expandida ou não) e canal do vídeo em exibição.
    domDescription: textOf('ytd-watch-metadata #description-inline-expander, ytd-watch-metadata #description, #description.ytd-video-secondary-info-renderer'),
    domChannel: textOf('ytd-watch-metadata ytd-channel-name #text, ytd-video-owner-renderer ytd-channel-name #text, #owner #channel-name #text', 120),
  };
}

export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  main() {
    if (window !== window.top) return; // só no documento principal
    if (window.__videoTranslatePageContext) {
      window.__videoTranslatePageContext.refresh();
      return;
    }

    let lastSent = '';
    const send = (force = false) => {
      const title = document.title.trim();
      const page = pageContextFromMeta(readPage());
      const key = JSON.stringify([title, location.href, page]);
      if (!force && key === lastSent) return;
      lastSent = key;
      browser.runtime.sendMessage({ target: BACKGROUND_TARGET, type: 'page-context', title, url: location.href, page }).catch(() => undefined);
    };

    // Título mudou (SPA): os metadados vêm um pouco depois; relê algumas vezes.
    let lastTitle = document.title;
    let timers: number[] = [];
    const scheduleReads = () => {
      for (const t of timers) window.clearTimeout(t);
      timers = [500, 2000, 5000].map((ms) => window.setTimeout(() => send(), ms));
    };
    const check = () => {
      if (document.title !== lastTitle) {
        lastTitle = document.title;
        scheduleReads();
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(document.head ?? document.documentElement, { childList: true, subtree: true, characterData: true });
    const timer = window.setInterval(check, 2000);

    window.__videoTranslatePageContext = {
      refresh: () => {
        send(true);
        scheduleReads();
      },
    };
    window.addEventListener('pagehide', () => {
      observer.disconnect();
      window.clearInterval(timer);
    });
    send(true);
    scheduleReads();
  },
});
