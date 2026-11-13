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
import { DEFAULT_OPTIONS, OPTIONS_KEY, loadOptions, saveOptions, watchOptions, type Options } from '@/lib/options';

const OFFSCREEN_URL = '/offscreen.html';
const VIEWER_URL = '/viewer.html';
const DRAWER_SCRIPT = '/content-scripts/drawer.js';
const SIDEPANEL_PATH = 'viewer.html?mode=sidepanel';

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

// ---- Painel lateral do Chrome (sidePanel) ----

/**
 * Abre o viewer no painel lateral do Chrome, que encolhe a página para caber ao lado
 * (um sidebar de verdade). sidePanel.open só funciona em resposta a um gesto do
 * usuário (clique no ícone ou num botão do viewer); fora disso devolve false.
 */
async function openSidePanel(tabId: number): Promise<boolean> {
  try {
    const tab = await browser.tabs.get(tabId);
    // Painel global (não por aba): assim ele continua aberto ao trocar de aba na janela.
    await browser.sidePanel.setOptions({ path: SIDEPANEL_PATH, enabled: true });
    await browser.sidePanel.open({ windowId: tab.windowId });
    console.log(`[background] painel lateral aberto na janela ${tab.windowId}`);
    return true;
  } catch (err) {
    console.error('[background] não foi possível abrir o painel lateral:', err);
    return false;
  }
}

/** Mantém o painel do Chrome habilitado só quando ele é o modo escolhido (o clique no ícone tenta abri-lo às cegas). */
async function syncSidePanel(displayMode: DisplayMode): Promise<void> {
  await browser.sidePanel.setOptions({ path: SIDEPANEL_PATH, enabled: displayMode === 'sidepanel' }).catch(() => undefined);
}

async function closeSidePanel(): Promise<void> {
  // Não há sidePanel.close(): desabilitar fecha o viewer que estiver nele; depois volta a
  // habilitar conforme as opções, para o próximo clique no ícone poder abri-lo.
  await browser.sidePanel.setOptions({ enabled: false }).catch(() => undefined);
  await syncSidePanel((await loadOptions()).displayMode);
}

/** Abre a superfície escolhida (painel do Chrome, drawer sobreposto ou janela) para a captura atual. */
async function showViewer(state: CaptureState, mode: DisplayMode, sidePanelOpened = false): Promise<CaptureState> {
  if (mode === 'sidepanel' && state.tabId !== null) {
    if (sidePanelOpened || (await openSidePanel(state.tabId))) {
      const next = { ...state, mode: 'sidepanel' as const, windowId: null };
      await setState(next);
      return next;
    }
    console.warn('[background] caindo para o painel sobreposto à página');
    mode = 'drawer';
  }
  if (mode === 'drawer' && state.tabId !== null) {
    if (await openDrawer(state.tabId)) {
      const next = { ...state, mode: 'drawer' as const, windowId: null };
      await setState(next);
      return next;
    }
    console.warn('[background] caindo para a janela separada');
  }
  // Janela da captura anterior ainda aberta (parou e vai iniciar de novo)? Reaproveita.
  if (state.lastWindowId != null) {
    try {
      await browser.windows.update(state.lastWindowId, { focused: true, drawAttention: true });
      const next = { ...state, mode: 'window' as const, windowId: state.lastWindowId };
      await setState(next);
      return next;
    } catch {
      /* já foi fechada */
    }
  }
  const windowId = await openViewer();
  const next = { ...state, mode: 'window' as const, windowId };
  await setState(next);
  return next;
}

async function hideViewer(state: CaptureState): Promise<void> {
  if (state.mode === 'sidepanel') await closeSidePanel();
  if (state.mode === 'drawer' && state.tabId !== null) await closeDrawer(state.tabId);
  if (state.windowId != null) await browser.windows.remove(state.windowId).catch(() => undefined);
}

async function focusViewer(state: CaptureState): Promise<void> {
  if (state.mode === undefined) {
    // Capturando sem viewer (a janela foi fechada): abre o da preferência.
    await showViewer(state, (await loadOptions()).displayMode);
    return;
  }
  if (state.mode === 'sidepanel' && state.tabId !== null) {
    // O clique no ícone é um gesto válido: reabre o painel se o usuário o fechou.
    if (!(await openSidePanel(state.tabId))) await showViewer(state, 'drawer');
    return;
  }
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

async function switchDisplay(mode: DisplayMode, sidePanelOpened = false): Promise<void> {
  const state = await getState();
  if (state.tabId === null) return;
  if (state.mode === mode && !sidePanelOpened) {
    await focusViewer(state);
    return;
  }
  // Solta a referência da janela antes de fechá-la: senão windows.onRemoved acha que o
  // usuário fechou o viewer e encerra a captura inteira (era o que acontecia ao
  // "voltar para o painel"). Abre a superfície nova antes de fechar a antiga, para
  // não ficar sem viewer se a nova falhar. O estado já muda de modo antes de fechar o
  // painel lateral, para a desconexão da porta não ser lida como fechamento pelo usuário.
  const prevWindowId = state.windowId ?? null;
  const cleared: CaptureState = { ...state, windowId: null };
  await setState(cleared);
  const next = await showViewer(cleared, mode, sidePanelOpened);
  console.log(`[background] viewer trocado de ${state.mode ?? '?'} para ${next.mode}`);
  if (state.mode === 'sidepanel' && next.mode !== 'sidepanel') await closeSidePanel();
  if (state.mode === 'drawer' && next.mode !== 'drawer') await closeDrawer(state.tabId);
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

/** Onde mostrar o viewer ao começar: abrir conforme as opções, ou usar o viewer que pediu (já aberto). */
type StartSurface = { kind: 'open'; sidePanelOpened: boolean } | { kind: 'existing'; mode: DisplayMode; windowId?: number };

async function startCapture(tab: chrome.tabs.Tab, options: Options, surface: StartSurface): Promise<void> {
  if (tab.id === undefined) return;
  const prev = await getState();
  const base: CaptureState = {
    tabId: tab.id,
    tabTitle: tab.title ?? '',
    tabUrl: tab.url ?? '',
    windowId: surface.kind === 'existing' ? (surface.windowId ?? null) : null,
    mode: surface.kind === 'existing' ? surface.mode : undefined,
    lastWindowId: prev.lastWindowId ?? null,
  };
  await setState(base);

  // 1. Tudo que depende do gesto do usuário (clique no ícone) vem primeiro: o painel
  //    lateral do Chrome (sidePanel.open) e o streamId da aba.
  let shown = surface.kind === 'existing';
  if (!shown && options.displayMode === 'sidepanel') {
    await showViewer(base, 'sidepanel', surface.kind === 'open' && surface.sidePanelOpened);
    shown = true;
  }
  const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tab.id });

  // 2. Mostra o viewer já (drawer na página ou janela), antes de qualquer espera longa.
  if (!shown) await showViewer(base, options.displayMode);

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
  // Os viewers ficam abertos mostrando "Parado" com o botão Iniciar; só o estado é limpo.
  await setState({ ...EMPTY_STATE, lastTabId: state.tabId, lastWindowId: state.windowId ?? null, lastMode: state.mode });
  console.log('[background] captura encerrada');
}

/** Encerra a captura e fecha os viewers (botão ✕ do drawer). */
async function stopCaptureAndClose(): Promise<void> {
  const state = await getState();
  await stopCapture();
  await hideViewer(state);
  await setState(EMPTY_STATE);
}

/**
 * "Iniciar" num viewer já aberto. Escolhe a aba: a que o viewer indicou (painel lateral:
 * aba ativa da janela), a aba do próprio viewer (drawer), a da captura anterior, ou a aba
 * ativa da última janela normal. getMediaStreamId não exige gesto, mas exige activeTab ou
 * permissão de host para a aba.
 */
async function startFromViewer(msg: { tabId?: number; from: { mode: DisplayMode; windowId?: number } }, senderTabId: number | undefined): Promise<void> {
  const state = await getState();
  if (state.tabId !== null) {
    await focusViewer(state);
    return;
  }
  const options = await loadOptions();
  // Páginas da extensão (a própria janela do viewer) não têm URL visível para nós e não podem ser capturadas.
  const isPage = (t: chrome.tabs.Tab | undefined): t is chrome.tabs.Tab => !!t && t.id !== undefined && /^https?:/.test(t.url ?? '');
  let tab: chrome.tabs.Tab | undefined;
  // sender.tab só interessa para o drawer (iframe dentro da aba do vídeo); na janela é a aba do próprio viewer.
  for (const id of [msg.tabId, msg.from.mode === 'drawer' ? senderTabId : undefined, state.lastTabId ?? undefined]) {
    if (id == null) continue;
    const t = await browser.tabs.get(id).catch(() => undefined);
    if (isPage(t)) {
      tab = t;
      break;
    }
  }
  if (!tab) {
    const wins = await browser.windows.getAll({ windowTypes: ['normal'], populate: true });
    const win = wins.find((w) => w.focused) ?? wins[0];
    tab = win?.tabs?.find((t) => t.active && isPage(t));
  }
  if (!tab) throw new Error('nenhuma aba com vídeo para capturar');
  console.log(`[background] iniciar pelo viewer (${msg.from.mode}) na aba ${tab.id}`);
  try {
    await startCapture(tab, options, { kind: 'existing', mode: msg.from.mode, windowId: msg.from.windowId });
  } catch (err) {
    // activeTab vale só para a aba em que o ícone foi clicado (e até ela navegar).
    if (String(err).includes('not been invoked')) throw new Error(`a aba "${tab.title ?? tab.url}" precisa ser ativada: clique no ícone da extensão nela`);
    throw err;
  }
}

export default defineBackground(() => {
  console.log(`[background] video-translate v${browser.runtime.getManifest().version}`);

  // Glossário das opções mudou durante a captura: repassa ao offscreen (que não lê o storage).
  watchOptions((o) => {
    void syncSidePanel(o.displayMode);
    void (async () => {
      const state = await getState();
      if (state.tabId === null || !(await hasOffscreenDocument())) return;
      sendToOffscreen({ target: OFFSCREEN_TARGET, type: 'set-context', context: { useTabContext: o.useTabContext, glossary: o.glossary } }, 1).catch(() => undefined);
    })();
  });
  // Clique no ícone. sidePanel.open() exige o gesto do usuário e o gesto se perde em
  // qualquer await/callback antes dele (v0.7.0 lia estado e opções antes e caía no
  // painel sobreposto). Então o painel é tentado às cegas, como primeira instrução: ele
  // só está habilitado (syncSidePanel) quando é o modo escolhido; nos outros modos o
  // open() falha e seguimos normalmente.
  browser.action.onClicked.addListener((tab) => {
    const proceed = async (sidePanelOpened: boolean) => {
      try {
        const state = await getState();
        const options = await loadOptions();
        if (sidePanelOpened && options.displayMode !== 'sidepanel') {
          // Painel habilitado por engano (opções mudaram sem o service worker ver).
          await closeSidePanel();
          sidePanelOpened = false;
        }
        if (state.tabId !== null) {
          if (sidePanelOpened) {
            if (state.mode !== 'sidepanel') await setState({ ...state, mode: 'sidepanel' });
            return; // já estava capturando; o painel foi reaberto
          }
          await focusViewer(state);
        } else {
          await startCapture(tab, options, { kind: 'open', sidePanelOpened });
        }
      } catch (err) {
        console.error('[background] erro no clique:', err);
        await browser.action.setTitle({ title: `Video Translate: erro (${String(err)})` });
        await stopCapture();
      }
    };
    if (tab.windowId === undefined) {
      void proceed(false);
      return;
    }
    chrome.sidePanel.open({ windowId: tab.windowId }, () => {
      const err = chrome.runtime.lastError;
      if (err) console.log('[background] painel lateral não abriu no clique (normal se o modo não for o painel):', err.message);
      else console.log(`[background] painel lateral aberto na janela ${tab.windowId}`);
      void proceed(!err);
    });
  });

  browser.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
    if (isBackgroundMessage(msg)) {
      switch (msg.type) {
        case 'stop-capture-request':
          void stopCapture();
          break;
        case 'drawer-closed':
          void stopCaptureAndClose();
          break;
        case 'start-capture-request':
          startFromViewer(msg, _sender.tab?.id).then(
            () => sendResponse({ ok: true }),
            (err) => {
              console.error('[background] falha ao iniciar pelo viewer:', err);
              browser.runtime.sendMessage({ type: 'capture-status', status: 'error', error: String(err) }).catch(() => undefined);
              void stopCapture();
              sendResponse({ ok: false, error: String(err) });
            },
          );
          return true; // resposta assíncrona
        case 'switch-display':
          switchDisplay(msg.mode, msg.sidePanelOpened === true).then(
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
  // Fechar a janela do viewer não para a captura (o selo REC fica; o clique no ícone reabre).
  browser.windows.onRemoved.addListener(async (windowId) => {
    const state = await getState();
    if (state.windowId === windowId) await setState({ ...state, windowId: null, mode: state.mode === 'window' ? undefined : state.mode });
    else if (state.lastWindowId === windowId) await setState({ ...state, lastWindowId: null });
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

  browser.runtime.onInstalled.addListener(async (details) => {
    await setState(EMPTY_STATE);
    // v0.7.0: o painel sobreposto ("drawer") deixou de ser o padrão; quem estava nele passa
    // para o painel lateral do Chrome, que empurra a página em vez de cobrir o vídeo.
    if (details.reason === 'update' && details.previousVersion && details.previousVersion < '0.7.0') {
      const options = await loadOptions();
      if (options.displayMode === 'drawer') await saveOptions({ ...options, displayMode: 'sidepanel' });
    }
    await syncSidePanel((await loadOptions()).displayMode);
  });
  browser.runtime.onStartup.addListener(async () => {
    await setState(EMPTY_STATE);
  });
});
