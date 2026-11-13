import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type AppliedConfig,
  BACKGROUND_TARGET,
  CAPTURE_STATE_KEY,
  OFFSCREEN_TARGET,
  isBroadcastEvent,
  type BroadcastEvent,
  type CaptureState,
  type GetTranscriptsResponse,
  type SttStatusEvent,
  type TranscriptEvent,
  type DisplayMode,
} from '@/lib/messages';
import { SentenceSegmenter, normalize, type Sentence } from '@/lib/segmenter';
import { saveOptions, watchOptions, type Options } from '@/lib/options';
import { createTranslator, type LocalOpusStatus, type TranslatorSelection } from '@/lib/translate';
import { ContextualTranslationProvider } from '@/lib/translate/contextual';
import { correctTranscript, extractTermsFromTitle, mergeTerms, parseGlossary, termPattern } from '@/lib/context';
import { modelLabelFor } from '@/lib/stt/models';
import { VAD_PROFILES, VAD_SENSITIVITIES } from '@/lib/audio/vad';

interface Card extends Sentence {
  pt?: string;
  ptError?: string;
}

type CaptureStatus = 'starting' | 'listening' | 'stopped' | 'error';

const VERSION = browser.runtime.getManifest().version;
const DISPLAY_MODE: DisplayMode = (() => {
  const m = new URLSearchParams(location.search).get('mode');
  return m === 'drawer' || m === 'sidepanel' ? m : 'window';
})();
const FROM = 'en';
const TO = 'pt';

export function App() {
  const [options, setOptions] = useState<Options | null>(null);
  const [capture, setCapture] = useState<CaptureState>({ tabId: null });
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>('starting');
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [stt, setStt] = useState<SttStatusEvent | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [partial, setPartial] = useState<string>('');
  const [translator, setTranslator] = useState<TranslatorSelection | null>(null);
  const [chromeDownload, setChromeDownload] = useState<number | null>(null);
  const [stuckToEnd, setStuckToEnd] = useState(true);
  const [translatorRetry, setTranslatorRetry] = useState(0);
  const [applied, setApplied] = useState<AppliedConfig | null>(null);
  const [localStatus, setLocalStatus] = useState<LocalOpusStatus | null>(null);
  const [removedTerms, setRemovedTerms] = useState<string[]>([]);
  const [addingTerm, setAddingTerm] = useState(false);
  const [newTerm, setNewTerm] = useState('');

  const segmenter = useRef(new SentenceSegmenter({ maxChars: 90, maxWaitMs: 5000 }));
  const listRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(new Set<number>());
  /** Termos de contexto atuais (lidos pelo tradutor e pela correção da transcrição). */
  const termsRef = useRef<string[]>([]);

  // ---- Contexto: nomes do título da aba + glossário do usuário ----
  const autoTerms = useMemo(() => (options?.useTabContext === false ? [] : extractTermsFromTitle(capture.tabTitle ?? '')), [capture.tabTitle, options?.useTabContext]);
  const manualTerms = useMemo(() => parseGlossary(options?.glossary ?? ''), [options?.glossary]);
  const terms = useMemo(() => mergeTerms(manualTerms, autoTerms).filter((t) => !removedTerms.includes(t.toLowerCase())), [manualTerms, autoTerms, removedTerms]);
  termsRef.current = terms;

  // ---- Opções (fonte, LibreTranslate) ----
  useEffect(() => watchOptions(setOptions), []);

  useEffect(() => {
    if (options) document.documentElement.style.setProperty('--font-size', `${options.fontSize}px`);
  }, [options?.fontSize]);

  // ---- Provedor de tradução (recriado quando a URL/chave mudam) ----
  useEffect(() => {
    if (!options) return;
    let cancelled = false;
    setTranslator(null);
    void createTranslator({
      libreUrl: options.libreUrl,
      libreApiKey: options.libreApiKey,
      fallback: options.translationFallback,
      resolveUrl: (p) => browser.runtime.getURL(p as never),
      from: FROM,
      to: TO,
    }).then((sel) => {
      if (cancelled) {
        sel.provider?.dispose?.();
        return;
      }
      if (sel.chrome) sel.chrome.onDownloadProgress = (p) => setChromeDownload(p >= 1 ? null : p);
      if (sel.local) {
        sel.local.onStatus = setLocalStatus;
        void sel.local.start().catch(() => undefined);
      } else {
        setLocalStatus(null);
      }
      // Mantém os nomes do contexto sem traduzir (ex.: "House" não vira "casa").
      setTranslator({ ...sel, provider: sel.provider ? new ContextualTranslationProvider(sel.provider, () => termsRef.current) : null });
      // Traduções já feitas continuam; as que falharam serão tentadas de novo.
      setCards((prev) => prev.map((c) => (c.ptError ? { ...c, ptError: undefined } : c)));
    });
    return () => {
      cancelled = true;
    };
  }, [options?.libreUrl, options?.libreApiKey, options?.translationFallback, translatorRetry]);

  // ---- Estado da captura (título da aba) ----
  useEffect(() => {
    void browser.storage.session.get(CAPTURE_STATE_KEY).then((d) => {
      const s = d[CAPTURE_STATE_KEY] as CaptureState | undefined;
      if (s) setCapture(s);
      // Aberto sem captura (ex.: pelo menu de painéis do Chrome, ou depois de parar): mostra "Iniciar".
      if (!s || s.tabId === null) setCaptureStatus((st) => (st === 'error' ? st : 'stopped'));
    });
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'session' && changes[CAPTURE_STATE_KEY]) {
        const s = changes[CAPTURE_STATE_KEY].newValue as CaptureState | undefined;
        if (s) setCapture(s);
        if (s && s.tabId === null) setCaptureStatus((st) => (st === 'error' ? st : 'stopped'));
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);

  // ---- Transcrições: histórico + eventos ----
  const pushFinal = useCallback((ev: TranscriptEvent) => {
    const sentences = segmenter.current.push(correctTranscript(ev.text, termsRef.current), ev.readyAt, ev.reason ?? 'max-length');
    if (sentences.length) setCards((prev) => [...prev, ...sentences]);
    setPartial((p) => (p && ev.text ? '' : p));
  }, []);

  useEffect(() => {
    const onEvent = (msg: unknown) => {
      if (!isBroadcastEvent(msg)) return;
      const ev: BroadcastEvent = msg;
      switch (ev.type) {
        case 'transcript':
          if (ev.isFinal) pushFinal(ev);
          else setPartial(normalize(correctTranscript(ev.text, termsRef.current)));
          break;
        case 'stt-status':
          setStt(ev);
          break;
        case 'capture-status':
          if (ev.status === 'started') {
            setCaptureStatus('listening');
            if (ev.applied) setApplied(ev.applied);
          }
          if (ev.status === 'stopped') setCaptureStatus('stopped');
          if (ev.status === 'error') {
            setCaptureStatus('error');
            setCaptureError(ev.error ?? 'erro desconhecido');
          }
          break;
      }
    };
    browser.runtime.onMessage.addListener(onEvent);

    // Histórico do que já foi transcrito antes de a janela abrir.
    void browser.runtime
      .sendMessage({ target: OFFSCREEN_TARGET, type: 'get-transcripts' })
      .then((res: GetTranscriptsResponse | undefined) => {
        if (!res || !('finals' in res)) return;
        for (const f of res.finals) pushFinal(f);
        if (res.partial) setPartial(normalize(correctTranscript(res.partial.text, termsRef.current)));
        if (res.status) setStt(res.status);
        if (res.applied) setApplied(res.applied);
        setCaptureStatus((s) => (s === 'starting' ? 'listening' : s));
      })
      .catch(() => {
        /* offscreen ainda não existe; os eventos chegarão depois */
      });

    // Fecha restos sem pontuação que ficaram parados.
    const timer = window.setInterval(() => {
      const out = segmenter.current.flushIfStale(Date.now());
      if (out.length) setCards((prev) => [...prev, ...out]);
    }, 500);

    return () => {
      browser.runtime.onMessage.removeListener(onEvent);
      window.clearInterval(timer);
    };
  }, [pushFinal]);

  // Ao parar, fecha o que sobrou no segmentador.
  useEffect(() => {
    if (captureStatus === 'stopped') {
      const out = segmenter.current.flush(Date.now());
      if (out.length) setCards((prev) => [...prev, ...out]);
      setPartial('');
    }
  }, [captureStatus]);

  // ---- Tradução dos cards ----
  useEffect(() => {
    const provider = translator?.provider;
    if (!provider) return;
    for (const c of cards) {
      if (c.pt !== undefined || c.ptError || inFlight.current.has(c.id)) continue;
      inFlight.current.add(c.id);
      provider
        .translate(c.text, FROM, TO)
        .then((pt) => setCards((prev) => prev.map((x) => (x.id === c.id ? { ...x, pt } : x))))
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          setCards((prev) => prev.map((x) => (x.id === c.id ? { ...x, ptError: msg } : x)));
        })
        .finally(() => inFlight.current.delete(c.id));
    }
  }, [cards, translator]);

  // ---- Auto-scroll ----
  useEffect(() => {
    const el = listRef.current;
    if (el && stuckToEnd) el.scrollTop = el.scrollHeight;
  }, [cards, partial, stuckToEnd]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setStuckToEnd(atEnd);
  };

  // ---- Ações ----
  const stop = () => {
    void browser.runtime.sendMessage({ target: BACKGROUND_TARGET, type: 'stop-capture-request' }).catch(() => undefined);
  };
  /** (Re)começa a captura a partir deste viewer, sem abrir outro. */
  const start = () => {
    setCaptureStatus('starting');
    setCaptureError(null);
    void (async () => {
      let tabId: number | undefined;
      let windowId: number | undefined;
      try {
        if (DISPLAY_MODE === 'sidepanel') {
          // Aba ativa da janela em que o painel está.
          const [t] = await browser.tabs.query({ active: true, currentWindow: true });
          if (t && !(t.url ?? '').startsWith('chrome-extension://')) tabId = t.id;
        } else if (DISPLAY_MODE === 'window') {
          windowId = (await browser.windows.getCurrent()).id;
        }
      } catch {
        /* o background escolhe a aba */
      }
      try {
        const res = (await browser.runtime.sendMessage({ target: BACKGROUND_TARGET, type: 'start-capture-request', tabId, from: { mode: DISPLAY_MODE, windowId } })) as
          | { ok?: boolean; error?: string }
          | undefined;
        if (res && res.ok === false) {
          setCaptureStatus('error');
          setCaptureError(res.error ?? 'não foi possível iniciar');
        }
      } catch (err) {
        setCaptureStatus('error');
        setCaptureError(String(err));
      }
    })();
  };
  const openOptions = () => void browser.runtime.openOptionsPage();
  // Da janela, "voltar para o painel" usa o painel escolhido nas opções (Chrome ou sobreposto).
  const panelMode: DisplayMode = options?.displayMode === 'drawer' ? 'drawer' : 'sidepanel';
  const switchDisplay = () => {
    const mode: DisplayMode = DISPLAY_MODE === 'window' ? panelMode : 'window';
    const send = (sidePanelOpened: boolean) =>
      browser.runtime
        .sendMessage({ target: BACKGROUND_TARGET, type: 'switch-display', mode, sidePanelOpened })
        .then((res: { ok?: boolean; error?: string } | undefined) => {
          if (res && res.ok === false) console.error('[viewer] não foi possível trocar o modo:', res.error);
        })
        .catch((err) => console.error('[viewer] não foi possível trocar o modo:', err));
    if (mode !== 'sidepanel') {
      void send(false);
      return;
    }
    // sidePanel.open() exige o gesto do usuário, que não chega ao background por mensagem;
    // esta página da extensão abre o painel ela mesma (com callbacks, para o gesto não se
    // perder) e só então avisa o background.
    chrome.storage.session.get(CAPTURE_STATE_KEY, (data) => {
      const tabId = (data?.[CAPTURE_STATE_KEY] as { tabId?: number | null } | undefined)?.tabId;
      if (tabId == null) {
        void send(false);
        return;
      }
      chrome.tabs.get(tabId, (tab) => {
        const windowId = tab?.windowId;
        if (chrome.runtime.lastError || windowId === undefined) {
          void send(false);
          return;
        }
        chrome.sidePanel.setOptions({ path: 'viewer.html?mode=sidepanel', enabled: true }, () => {
          chrome.sidePanel.open({ windowId }, () => {
            const err = chrome.runtime.lastError;
            if (err) console.warn('[viewer] sidePanel.open falhou:', err.message);
            void send(!err);
          });
        });
      });
    });
  };
  /** Refaz a tradução dos cards que contêm o termo (a proteção/remoção passa a valer neles). */
  const retranslateWith = (term: string) => {
    const re = termPattern(term, 'u');
    setCards((prev) => prev.map((c) => (re.test(c.text) ? { ...c, pt: undefined, ptError: undefined } : c)));
  };
  const removeTerm = (term: string) => {
    setRemovedTerms((r) => [...r, term.toLowerCase()]);
    retranslateWith(term);
  };
  const addTerm = () => {
    const term = newTerm.trim();
    setNewTerm('');
    setAddingTerm(false);
    if (!term || !options) return;
    setRemovedTerms((r) => r.filter((x) => x !== term.toLowerCase()));
    if (!manualTerms.some((t) => t.toLowerCase() === term.toLowerCase())) {
      // Fica no glossário das opções (vale para as próximas capturas também).
      void saveOptions({ ...options, glossary: options.glossary.trim() ? `${options.glossary.trim()}\n${term}` : term });
    }
    retranslateWith(term);
  };
  const prepareChrome = () => {
    const chrome = translator?.chrome;
    if (!chrome) return;
    setChromeDownload(0);
    void chrome
      .prepare(FROM, TO)
      .then(() => {
        setChromeDownload(null);
        // Reavalia os provedores: agora o Chrome deve ficar ativo.
        setTranslatorRetry((n) => n + 1);
      })
      .catch((err: unknown) => {
        setChromeDownload(null);
        console.error('[viewer] download do tradutor do Chrome falhou:', err);
        setTranslator((t) => (t ? { ...t, chromeAvailability: 'unavailable', chromeError: err instanceof Error ? err.message : String(err) } : t));
      });
  };

  // ---- Cabeçalho ----
  const status = useMemo(() => describeStatus(captureStatus, captureError, stt), [captureStatus, captureError, stt]);
  const translatorLabel = useMemo(() => {
    if (!translator) return 'tradução: verificando…';
    switch (translator.kind) {
      case 'libretranslate':
        return 'tradução: LibreTranslate';
      case 'chrome':
        return 'tradução: Chrome (local)';
      case 'local':
        return localStatus?.state === 'loading'
          ? `tradução: baixando modelo local ${localStatus.progress !== undefined ? `${localStatus.progress.toFixed(0)}%` : ''}`
          : 'tradução: local (opus-mt)';
      case 'google-free':
        return 'tradução: Google (não oficial)';
      default:
        return 'sem tradutor disponível';
    }
  }, [translator, localStatus]);
  const translatorDetail = useMemo(() => {
    if (!translator) return '';
    const parts: string[] = [];
    if (translator.libreError) parts.push(`LibreTranslate: ${translator.libreError}`);
    if (translator.chromeError) parts.push(`Chrome: ${translator.chromeError}`);
    return parts.join('\n');
  }, [translator]);

  // Linha de configuração aplicada (modelo + backend, separação) e aviso se as opções salvas diferem.
  const configLine = useMemo(() => {
    const cfg = applied ?? (options ? { sttModel: options.sttModel, vadProfile: options.sentenceSplit, vadSensitivity: options.vadSensitivity } : null);
    if (!cfg) return null;
    const active = cfg.activeEngine ?? cfg.sttEngine ?? 'local';
    const chrome = active === 'chrome';
    const server = active === 'server';
    const backend =
      stt?.state === 'ready' ? (stt.device === 'webgpu' ? 'GPU' : stt.device === 'chrome' ? 'nativo' : stt.device === 'server' ? 'Docker' : 'WASM') : stt?.state === 'loading' ? 'carregando' : null;
    const vp = VAD_PROFILES[cfg.vadProfile] ?? VAD_PROFILES.normal;
    const vs = VAD_SENSITIVITIES[cfg.vadSensitivity ?? 'normal'] ?? VAD_SENSITIVITIES.normal;
    const modelLabel = chrome ? 'Chrome no dispositivo' : server ? `Servidor local (${stt?.model ?? 'whisper'})` : modelLabelFor(stt?.state === 'ready' ? stt.model : undefined, cfg.sttModel);
    const fellBack = (cfg.sttEngine ?? 'local') !== 'local' && cfg.activeEngine === 'local';
    const fellBackLabel = cfg.sttEngine === 'chrome' ? ' (Chrome indisponível)' : ' (servidor indisponível)';
    const vadLabel = chrome ? '' : cfg.vadEngine === 'silero' ? ' · Silero' : cfg.vadEngine === 'energy' ? ' · energia' : '';
    const changed =
      !!applied && !!options && (options.sttModel !== applied.sttModel || options.sentenceSplit !== applied.vadProfile || options.vadSensitivity !== (applied.vadSensitivity ?? 'normal') || options.sttEngine !== (applied.sttEngine ?? 'local'));
    return {
      model: `${modelLabel}${backend ? ` · ${backend}` : ''}${fellBack ? fellBackLabel : ''}`,
      split: `Separação: ${vp.label} (${vp.silenceMs / 1000} s / ${vp.maxSegmentMs / 1000} s)${vadLabel} · Sensibilidade: ${vs.label.toLowerCase()}`,
      changed,
      isApplied: !!applied,
    };
  }, [applied, options, stt]);

  const pendingLine = [segmenter.current.pending, partial].filter(Boolean).join(' ');

  return (
    <div className="app">
      <header className="header">
        <h1 title={`${capture.tabTitle ?? ''} · Video Translate v${VERSION}`}>
          {capture.tabTitle || 'Video Translate'} <span className="version">v{VERSION}</span>
        </h1>
        <div className="row">
          <span className={`dot ${status.kind}`} />
          <span className="grow" title={status.detail ?? ''}>
            {status.text}
          </span>
          <button className="link" onClick={openOptions} title={translatorDetail || translatorLabel}>
            {translatorLabel}
          </button>
          <button className="link" onClick={switchDisplay} disabled={captureStatus === 'stopped'} title={DISPLAY_MODE !== 'window' ? 'Abrir numa janela separada' : 'Voltar para o painel ao lado do vídeo'}>
            {DISPLAY_MODE !== 'window' ? 'abrir em janela' : 'voltar para o painel'}
          </button>
          {captureStatus === 'stopped' || captureStatus === 'error' ? (
            <button className="start" onClick={start} title="Começar a transcrever a aba com o vídeo">
              Iniciar
            </button>
          ) : (
            <button className="danger" onClick={stop} title="Parar a transcrição (o painel continua aberto)">
              Parar
            </button>
          )}
        </div>
        {configLine && (
          <div className="config-line" onClick={openOptions} title={configLine.isApplied ? 'Configuração aplicada nesta captura. Clique para abrir as opções.' : 'Configuração salva (ainda sem captura). Clique para abrir as opções.'}>
            <span className="chip" title="Modelo de transcrição e backend">{configLine.model}</span>
            <span className="chip" title="Pausa para fechar a frase / duração máxima do trecho">{configLine.split}</span>
            {configLine.changed && <span className="chip warn">novas opções valem na próxima captura</span>}
          </div>
        )}
        <div className="context-line">
          <span className="context-label" title="Nomes do título da aba e do glossário: ficam sem traduzir (House não vira casa) e corrigem a transcrição">
            contexto:
          </span>
          {terms.map((t) => (
            <span className="chip term" key={t} title={manualTerms.some((m) => m.toLowerCase() === t.toLowerCase()) ? 'Do glossário (Opções). Clique no × para ignorar nesta captura.' : `Tirado do título "${capture.tabTitle ?? ''}". Clique no × para ignorar nesta captura.`}>
              {t}
              <button className="x" onClick={() => removeTerm(t)} aria-label={`Remover ${t}`}>
                ×
              </button>
            </span>
          ))}
          {terms.length === 0 && !addingTerm && <span className="chip muted">nenhum nome no título</span>}
          {addingTerm ? (
            <input
              className="term-input"
              autoFocus
              value={newTerm}
              placeholder="nome ou termo"
              onChange={(e) => setNewTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addTerm();
                if (e.key === 'Escape') {
                  setAddingTerm(false);
                  setNewTerm('');
                }
              }}
              onBlur={addTerm}
            />
          ) : (
            <button className="chip add" onClick={() => setAddingTerm(true)} title="Adicionar um nome ou termo ao glossário">
              + nome
            </button>
          )}
        </div>
        {stt?.state === 'loading' && stt.progress !== undefined && <ProgressBar value={stt.progress} label="modelo" title={stt.message} />}
        {chromeDownload !== null && <ProgressBar value={chromeDownload * 100} label="tradutor do Chrome" />}
        {translator?.kind === 'local' && localStatus?.state === 'loading' && localStatus.progress !== undefined && (
          <ProgressBar value={localStatus.progress} label="tradutor local" title={localStatus.message} />
        )}
      </header>

      <div className="list" ref={listRef} onScroll={onScroll}>
        {translator && translator.kind !== 'chrome' && translator.kind !== 'libretranslate' && translator.chromeAvailability === 'downloadable' && chromeDownload === null && (
          <p className="notice warn">
            O Chrome pode traduzir localmente depois de baixar o pacote inglês → português.{' '}
            <button className="link" onClick={prepareChrome}>
              Baixar agora
            </button>
          </p>
        )}
        {translator?.kind === 'none' && (
          <p className="notice error">
            Nenhum tradutor disponível.
            {translator.libreError ? ` LibreTranslate: ${translator.libreError}.` : ''}
            {translator.chromeError ? ` Chrome: ${translator.chromeError}.` : ''}{' '}
            <button className="link" onClick={openOptions}>
              Configurar LibreTranslate ou outro fallback
            </button>
          </p>
        )}

        {cards.length === 0 && !pendingLine && (
          <p className="empty">
            {captureStatus === 'stopped'
              ? 'Captura encerrada.'
              : stt?.state === 'ready'
                ? 'Ouvindo… as frases aparecem aqui assim que alguém falar.'
                : 'Carregando o modelo de transcrição. O áudio já está sendo capturado.'}
          </p>
        )}

        {cards.map((c) => (
          <article className="card" key={c.id}>
            <div className="en">{c.text}</div>
            {translator?.provider ? (
              c.ptError ? (
                <div className="pt error" title={c.ptError}>
                  tradução falhou: {c.ptError}
                </div>
              ) : (
                <div className={`pt ${c.pt === undefined ? 'pending' : ''}`}>
                  {c.pt ??
                    (translator.kind === 'local' && localStatus?.state === 'loading'
                      ? `baixando tradutor local${localStatus.progress !== undefined ? ` ${localStatus.progress.toFixed(0)}%` : '…'}`
                      : '…')}
                </div>
              )
            ) : null}
          </article>
        ))}

        {pendingLine && <div className="partial">{pendingLine}</div>}
      </div>

      {!stuckToEnd && (
        <button className="to-end" onClick={() => setStuckToEnd(true)}>
          ↓ voltar ao fim
        </button>
      )}
    </div>
  );
}

function describeStatus(
  capture: CaptureStatus,
  captureError: string | null,
  stt: SttStatusEvent | null,
): { kind: 'listening' | 'loading' | 'error' | 'idle'; text: string; detail?: string } {
  if (capture === 'error') return { kind: 'error', text: 'Erro na captura', detail: captureError ?? undefined };
  if (capture === 'stopped') return { kind: 'idle', text: 'Parado' };
  if (!stt || stt.state === 'idle' || stt.state === 'loading') {
    const pct = stt?.progress !== undefined ? ` ${stt.progress.toFixed(0)}%` : '';
    const model = stt?.model ? modelShortName(stt.model) : '';
    return { kind: 'loading', text: `Carregando modelo${model ? ` ${model}` : ''}${pct}`, detail: stt?.message };
  }
  if (stt.state === 'error') return { kind: 'error', text: 'Modelo não carregou', detail: stt.message };
  if (stt.device === 'chrome') return { kind: 'listening', text: 'Ouvindo · Chrome no dispositivo', detail: stt.message };
  if (stt.device === 'server') return { kind: 'listening', text: `Ouvindo · servidor local (${stt.model ?? 'whisper'})`, detail: stt.message };
  const device = stt.device === 'webgpu' ? 'GPU' : 'CPU';
  return { kind: 'listening', text: `Ouvindo · ${modelShortName(stt.model ?? '')} (${device})`, detail: stt.message };
}

/** Barra de progresso com a porcentagem ao lado. */
function ProgressBar({ value, label, title }: { value: number; label: string; title?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="progress-row" title={title ?? ''}>
      <span className="progress-label">{label}</span>
      <div className="progress">
        <div style={{ width: `${pct}%` }} />
      </div>
      <span className="progress-pct">{pct.toFixed(0)}%</span>
    </div>
  );
}

function modelShortName(hfId: string): string {
  const base = hfId.split('/').pop() ?? hfId;
  return base.replace(/-ONNX$/i, '').replace(/^onnx-/, '');
}

