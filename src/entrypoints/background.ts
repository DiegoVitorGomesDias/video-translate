// Service worker: ao clicar no ícone, pede o streamId da aba, garante o documento
// offscreen e manda ele começar a captura. Um segundo clique para a captura.

import { OFFSCREEN_TARGET, type BackgroundMessage, type OffscreenMessage } from '@/lib/messages';

const OFFSCREEN_URL = '/offscreen.html';
const STATE_KEY = 'captureState';

interface CaptureState {
  tabId: number | null;
}

async function getState(): Promise<CaptureState> {
  const data = await browser.storage.session.get(STATE_KEY);
  return (data[STATE_KEY] as CaptureState | undefined) ?? { tabId: null };
}

async function setState(state: CaptureState): Promise<void> {
  await browser.storage.session.set({ [STATE_KEY]: state });
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

async function sendToOffscreen(msg: OffscreenMessage): Promise<unknown> {
  return browser.runtime.sendMessage(msg);
}

async function startCapture(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  // Precisa acontecer logo após o gesto do usuário (clique no ícone).
  const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  await ensureOffscreenDocument();
  await sendToOffscreen({ target: OFFSCREEN_TARGET, type: 'start-capture', streamId, tabId: tab.id });
  await setState({ tabId: tab.id });
  console.log(`[background] captura iniciada na aba ${tab.id} (${tab.title ?? ''})`);
}

async function stopCapture(): Promise<void> {
  if (await hasOffscreenDocument()) {
    try {
      await sendToOffscreen({ target: OFFSCREEN_TARGET, type: 'stop-capture' });
    } catch (err) {
      console.warn('[background] offscreen não respondeu ao stop:', err);
    }
    await browser.offscreen.closeDocument().catch(() => undefined);
  }
  await setState({ tabId: null });
  console.log('[background] captura encerrada');
}

export default defineBackground(() => {
  browser.action.onClicked.addListener(async (tab) => {
    try {
      const state = await getState();
      if (state.tabId !== null) {
        await stopCapture();
      } else {
        await startCapture(tab);
      }
    } catch (err) {
      console.error('[background] erro:', err);
      await setState({ tabId: null });
      await browser.offscreen.closeDocument().catch(() => undefined);
    }
  });

  browser.runtime.onMessage.addListener((msg: unknown) => {
    const m = msg as Partial<BackgroundMessage>;
    if (m?.type !== 'capture-status') return;
    console.log(`[background] offscreen: ${m.status}${m.error ? ` (${m.error})` : ''}`);
    if (m.status === 'stopped' || m.status === 'error') {
      void setState({ tabId: null });
    }
  });

  // Se a aba capturada fechar, limpa o estado.
  browser.tabs.onRemoved.addListener(async (tabId) => {
    const state = await getState();
    if (state.tabId === tabId) await stopCapture();
  });

  browser.runtime.onInstalled.addListener(() => {
    void setState({ tabId: null });
  });
});
