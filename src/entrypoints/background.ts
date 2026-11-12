// Service worker: ao clicar no ícone, pede o streamId da aba, garante o documento
// offscreen, manda ele começar a captura e abre a janela do viewer. Se já estiver
// capturando, o clique só foca a janela. Parar: botão no viewer ou fechar a janela.

import {
  CAPTURE_STATE_KEY,
  DRAWER_TARGET,
  OFFSCREEN_TARGET,
  isBackgroundMessage,
  isBroadcastEvent,
  type CaptureState,
  type DisplayMode,
  type OffscreenMessage,
} from '@/lib/messages';
import { loadOptions, saveOptions, watchOptions } from '@/lib/options';

const OFFSCREEN_URL = '/offscreen.html';
const VIEWER_URL = '/viewer.html';
const DRAWER_SCRIPT = '/content-scripts/drawer.js';

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
  const url = browser.runtime.getURL(VIEWER_URL);
  try {
    const win = await browser.windows.create({ url, type: 'popup', width: 480, height: 720 });
    console.log(`[background] janela do viewer aberta (id ${win?.id})`);
    return win?.id ?? null;
  } catch (err) {
    console.error('[background] windows.create falhou, abrindo o viewer numa aba:', err);
    try {
      const tab = await browser.tabs.create({ url });
      return tab.windowId ?? null;
    } catch (err2) {
      console.error('[background] tabs.create também falhou:', err2);
      await browser.action.setTitle({ title: `Video Translate: não consegui abrir a janela (${String(err2)})` });
      return null;
    }
  }
}

// ---- Painel lateral (content script injetado sob demanda) ----

async function drawerPresent(tabId: number): Promise<boolean> {
  try {
    const res = (await browser.tabs.sendMessage(tabId, { target: DRAWER_TARGET, type: 'ping' })) as { ok?: boolean } | undefined;
    return res?.ok === true;
  } catch {
    return false;
  }
}

/** Injeta o drawer na aba. Devolve false se a página não aceitar (ex.: chrome://). */
async function openDrawer(tabId: number): Promise<boolean> {
  if (await drawerPresent(tabId)) return true;
  try {
    await browser.scripting.executeScript({ target: { tabId }, files: [DRAWER_SCRIPT] });
    console.log(`[background] drawer injetado na aba ${tabId}`);
    return true;
  } catch (err) {
    console.error('[background] não foi possível injetar o drawer:', err);
    return false;
  }
}

async function closeDrawer(tabId: number): Promise<void> {
  await browser.tabs.sendMessage(tabId, { target: DRAWER_TARGET, type: 'close' }).catch(() => undefined);
}

/** Abre a superfície escolhida (drawer ou janela) para a captura atual. */
async function showViewer(state: CaptureState, mode: DisplayMode): Promise<CaptureState> {
  if (mode === 'drawer' && state.tabId !== null) {
    if (await openDrawer(state.tabId)) {
      const next = { ...state, mode: 'drawer' as const, windowId: null };
      await setState(next);
      return next;
    }
    console.warn('[background] caindo para a janela separada');
  }
  const windowId = await openViewer();
  const next = { ...state, mode: 'window' as const, windowId };
  await setState(next);
  return next;
}

async function hideViewer(state: CaptureState): Promise<void> {
  if (state.mode === 'drawer' && state.tabId !== null) await closeDrawer(state.tabId);
  if (state.windowId != null) await browser.windows.remove(state.windowId).catch(() => undefined);
}

async function focusViewer(state: CaptureState): Promise<void> {
  if (state.mode === 'drawer' && state.tabId !== null) {
    if (!(await drawerPresent(state.tabId))) await showViewer(state, 'drawer');
    return;
  }
  if (state.windowId != null) {
    try {
      await browser.windows.update(state.windowId, { focused: true, drawAttention: true });
      return;
    } catch {
      /* janela não existe mais; abre outra */
    }
  }
  await showViewer(state, 'window');
}

async function switchDisplay(mode: DisplayMode): Promise<void> {
  const state = await getState();
  if (state.tabId === null) return;
  if (state.mode === mode) {
    await focusViewer(state);
    return;
  }
  // Solta a referência da janela antes de fechá-la: senão windows.onRemoved acha que o
  // usuário fechou o viewer e encerra a captura inteira (era o que acontecia ao
  // "voltar para o painel"). Abre a superfície nova antes de fechar a antiga, para
  // não ficar sem viewer se a nova falhar.
  const prevWindowId = state.windowId ?? null;
  const cleared: CaptureState = { ...state, windowId: null };
  await setState(cleared);
  const next = await showViewer(cleared, mode);
  console.log(`[background] viewer trocado de ${state.mode ?? '?'} para ${next.mode}`);
  if (next.mode !== 'drawer' && state.mode === 'drawer') await closeDrawer(state.tabId);
  if (prevWindowId != null && prevWindowId !== next.windowId) await browser.windows.remove(prevWindowId).catch(() => undefined);
  const options = await loadOptions();
  await saveOptions({ ...options, displayMode: next.mode ?? mode });
}

/** Título/URL da aba capturada mudaram (o viewer usa o título como contexto da tradução). */
async function updateTabTitle(title: string, url: string): Promise<void> {
  const state = await getState();
  if (state.tabId === null) return;
  if (state.tabTitle === title && (!url || state.tabUrl === url)) return;
  await setState({ ...state, tabTitle: title, tabUrl: url || state.tabUrl });
  if (await hasOffscreenDocument()) {
    sendToOffscreen({ target: OFFSCREEN_TARGET, type: 'set-context', context: { tabTitle: title } }, 1).catch(() => undefined);
  }
}

async function startCapture(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  // 1. O streamId precisa ser pedido logo após o gesto do usuário (clique no ícone).
  const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  const options = await loadOptions();

  // 2. Mostra o viewer já (drawer na página ou janela), antes de qualquer espera longa.
  const base: CaptureState = { tabId: tab.id, tabTitle: tab.title ?? '', tabUrl: tab.url ?? '', windowId: null };
  await setState(base);
  await showViewer(base, options.displayMode);

  // 3. Offscreen + captura (o modelo carrega lá dentro, em paralelo com a UI).
  try {
    await ensureOffscreenDocument();
    await sendToOffscreen({
      target: OFFSCREEN_TARGET,
      type: 'start-capture',
      streamId,
      tabId: tab.id,
      sttModel: options.sttModel,
      sttEngine: options.sttEngine,
      vadProfile: options.sentenceSplit,
      vadSensitivity: options.vadSensitivity,
      context: { tabTitle: tab.title ?? '', useTabContext: options.useTabContext, glossary: options.glossary },
      server: { url: options.sttServerUrl.trim(), format: options.sttServerFormat, model: options.sttServerModel.trim(), apiKey: options.sttServerApiKey.trim() },
    });
    console.log(`[background] captura iniciada na aba ${tab.id} (${tab.title ?? ''})`);
  } catch (err) {
    console.error('[background] falha ao iniciar a captura:', err);
    browser.runtime.sendMessage({ type: 'capture-status', status: 'error', error: String(err) }).catch(() => undefined);
  }
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
  await hideViewer(state);
  console.log('[background] captura encerrada');
}

export default defineBackground(() => {
  console.log(`[background] video-translate v${browser.runtime.getManifest().version}`);

  // Glossário das opções mudou durante a captura: repassa ao offscreen (que não lê o storage).
  watchOptions((o) => {
    void (async () => {
      const state = await getState();
      if (state.tabId === null || !(await hasOffscreenDocument())) return;
      sendToOffscreen({ target: OFFSCREEN_TARGET, type: 'set-context', context: { useTabContext: o.useTabContext, glossary: o.glossary } }, 1).catch(() => undefined);
    })();
  });
  browser.action.onClicked.addListener(async (tab) => {
    try {
      const state = await getState();
      if (state.tabId !== null) {
        await focusViewer(state);
      } else {
        await startCapture(tab);
      }
    } catch (err) {
      console.error('[background] erro no clique:', err);
      await browser.action.setTitle({ title: `Video Translate: erro (${String(err)})` });
      await stopCapture();
    }
  });

  browser.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
    if (isBackgroundMessage(msg)) {
      switch (msg.type) {
        case 'stop-capture-request':
        case 'drawer-closed':
          void stopCapture();
          break;
        case 'switch-display':
          switchDisplay(msg.mode).then(
            () => sendResponse({ ok: true }),
            (err) => {
              console.error('[background] falha ao trocar o viewer:', err);
              sendResponse({ ok: false, error: String(err) });
            },
          );
          return true; // resposta assíncrona
        case 'tab-title':
          void updateTabTitle(msg.title, msg.url);
          break;
      }
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

  // Navegação na aba capturada (recarga ou SPA): reinjeta o drawer quando o documento terminar.
  browser.tabs.onUpdated.addListener(async (tabId, info, tab) => {
    const state = await getState();
    if (state.tabId !== tabId) return;
    // Título/URL vêm aqui só quando a extensão ainda tem acesso à aba (activeTab); o
    // drawer também avisa por mensagem, cobrindo o resto.
    if (info.title !== undefined || info.url !== undefined) await updateTabTitle(tab.title ?? info.title ?? '', tab.url ?? info.url ?? '');
    if (info.status === 'complete' && state.mode === 'drawer') await openDrawer(tabId);
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
