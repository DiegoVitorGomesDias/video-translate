// Service worker: ao clicar no ícone, pede o streamId da aba, garante o documento
// offscreen, manda ele começar a captura e abre a janela do viewer. Se já estiver
// capturando, o clique só foca a janela. Parar: botão no viewer ou fechar a janela.

import {
  CAPTURE_STATE_KEY,
  OFFSCREEN_TARGET,
  isBackgroundMessage,
  isBroadcastEvent,
  type CaptureState,
  type OffscreenMessage,
} from '@/lib/messages';
import { loadOptions } from '@/lib/options';

const OFFSCREEN_URL = '/offscreen.html';
const VIEWER_URL = '/viewer.html';

const EMPTY_STATE: CaptureState = { tabId: null, windowId: null };

async function getState(): Promise<CaptureState> {
  const data = await browser.storage.session.get(CAPTURE_STATE_KEY);
  return (data[CAPTURE_STATE_KEY] as CaptureState | undefined) ?? EMPTY_STATE;
}

async function setState(state: CaptureState): Promise<void> {
  await browser.storage.session.set({ [CAPTURE_STATE_KEY]: state });
  if (state.tabId !== null) {
    await browser.action.setBadgeText({ text: 'REC' });
    await browser.action.setBadgeBackgroundColor({ color: '#d33' });
  } else {
    await browser.action.setBadgeText({ text: '' });
  }
}

async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await browser.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
    documentUrls: [browser.runtime.getURL(OFFSCREEN_URL)],
  });
  return contexts.length > 0;
}

let creatingOffscreen: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  creatingOffscreen ??= browser.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ['USER_MEDIA' as chrome.offscreen.Reason],
      justification: 'Capturar o áudio da aba para transcrição local.',
    })
    .finally(() => {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Envia para o offscreen. Logo após createDocument o módulo da página pode ainda
 * não ter registrado o listener, então repete algumas vezes enquanto o Chrome
 * responder "Receiving end does not exist".
 */
async function sendToOffscreen(msg: OffscreenMessage, attempts = 5, delayMs = 200): Promise<unknown> {
  for (let i = 1; ; i++) {
    try {
      return await browser.runtime.sendMessage(msg);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      if (i >= attempts || !text.includes('Receiving end does not exist')) throw err;
      await sleep(delayMs);
    }
  }
}

async function openViewer(): Promise<number | null> {
  const win = await browser.windows.create({
    url: browser.runtime.getURL(VIEWER_URL),
    type: 'popup',
    width: 480,
    height: 720,
  });
  return win?.id ?? null;
}

async function focusViewer(state: CaptureState): Promise<void> {
  if (state.windowId != null) {
    try {
      await browser.windows.update(state.windowId, { focused: true, drawAttention: true });
      return;
    } catch {
      /* janela não existe mais; abre outra */
    }
  }
  const windowId = await openViewer();
  await setState({ ...state, windowId });
}

async function startCapture(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  // Precisa acontecer logo após o gesto do usuário (clique no ícone).
  const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  const options = await loadOptions();
  await ensureOffscreenDocument();
  await sendToOffscreen({ target: OFFSCREEN_TARGET, type: 'start-capture', streamId, tabId: tab.id, sttModel: options.sttModel });
  // Salva o estado antes de abrir a janela, para o viewer já achar o título.
  await setState({ tabId: tab.id, tabTitle: tab.title ?? '', windowId: null });
  const windowId = await openViewer();
  await setState({ tabId: tab.id, tabTitle: tab.title ?? '', windowId });
  console.log(`[background] captura iniciada na aba ${tab.id} (${tab.title ?? ''})`);
}

async function stopCapture(): Promise<void> {
  const state = await getState();
  if (await hasOffscreenDocument()) {
    try {
      await sendToOffscreen({ target: OFFSCREEN_TARGET, type: 'stop-capture' }, 1);
    } catch (err) {
      console.warn('[background] offscreen não respondeu ao stop:', err);
    }
    await browser.offscreen.closeDocument().catch(() => undefined);
  }
  await setState(EMPTY_STATE);
  if (state.windowId != null) {
    await browser.windows.remove(state.windowId).catch(() => undefined);
  }
  console.log('[background] captura encerrada');
}

export default defineBackground(() => {
  console.log(`[background] Video Translate v${browser.runtime.getManifest().version}`);
  browser.action.onClicked.addListener(async (tab) => {
    try {
      const state = await getState();
      if (state.tabId !== null) {
        await focusViewer(state);
      } else {
        await startCapture(tab);
      }
    } catch (err) {
      console.error('[background] erro:', err);
      await stopCapture();
    }
  });

  browser.runtime.onMessage.addListener((msg: unknown) => {
    if (isBackgroundMessage(msg) && msg.type === 'stop-capture-request') {
      void stopCapture();
      return;
    }
    if (isBroadcastEvent(msg) && msg.type === 'capture-status') {
      console.log(`[background] offscreen: ${msg.status}${msg.error ? ` (${msg.error})` : ''}`);
      if (msg.status === 'stopped') {
        // O offscreen encerrou sozinho (ex.: a aba parou de compartilhar).
        void getState().then((s) => {
          if (s.tabId !== null) void stopCapture();
        });
      }
    }
  });

  // Fechar a janela do viewer para a captura.
  browser.windows.onRemoved.addListener(async (windowId) => {
    const state = await getState();
    if (state.windowId === windowId) await stopCapture();
  });

  // Se a aba capturada fechar, limpa tudo.
  browser.tabs.onRemoved.addListener(async (tabId) => {
    const state = await getState();
    if (state.tabId === tabId) await stopCapture();
  });

  browser.runtime.onInstalled.addListener(() => {
    void setState(EMPTY_STATE);
  });
  browser.runtime.onStartup.addListener(() => {
    void setState(EMPTY_STATE);
  });
});
