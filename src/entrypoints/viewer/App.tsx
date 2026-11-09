import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BACKGROUND_TARGET,
  CAPTURE_STATE_KEY,
  OFFSCREEN_TARGET,
  isBroadcastEvent,
  type BroadcastEvent,
  type CaptureState,
  type GetTranscriptsResponse,
  type SttStatusEvent,
  type TranscriptEvent,
} from '@/lib/messages';
import { SentenceSegmenter, normalize, type Sentence } from '@/lib/segmenter';
import { watchOptions, type Options } from '@/lib/options';
import { createTranslator, type TranslatorSelection } from '@/lib/translate';
import { getModelInfo } from '@/lib/stt/models';

interface Card extends Sentence {
  pt?: string;
  ptError?: string;
}

type CaptureStatus = 'starting' | 'listening' | 'stopped' | 'error';

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

  const segmenter = useRef(new SentenceSegmenter({ maxChars: 120, maxWaitMs: 5000 }));
  const listRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(new Set<number>());

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
    void createTranslator({ libreUrl: options.libreUrl, libreApiKey: options.libreApiKey, from: FROM, to: TO }).then((sel) => {
      if (cancelled) {
        sel.provider?.dispose?.();
        return;
      }
      if (sel.chrome) sel.chrome.onDownloadProgress = (p) => setChromeDownload(p >= 1 ? null : p);
      setTranslator(sel);
      // Traduções já feitas continuam; as que falharam serão tentadas de novo.
      setCards((prev) => prev.map((c) => (c.ptError ? { ...c, ptError: undefined } : c)));
    });
    return () => {
      cancelled = true;
    };
  }, [options?.libreUrl, options?.libreApiKey]);

  // ---- Estado da captura (título da aba) ----
  useEffect(() => {
    void browser.storage.session.get(CAPTURE_STATE_KEY).then((d) => {
      const s = d[CAPTURE_STATE_KEY] as CaptureState | undefined;
      if (s) setCapture(s);
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
    const sentences = segmenter.current.push(ev.text, ev.readyAt);
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
          else setPartial(normalize(ev.text));
          break;
        case 'stt-status':
          setStt(ev);
          break;
        case 'capture-status':
          if (ev.status === 'started') setCaptureStatus('listening');
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
        if (res.partial) setPartial(normalize(res.partial.text));
        if (res.status) setStt(res.status);
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
  const openOptions = () => void browser.runtime.openOptionsPage();
  const prepareChrome = () => {
    const chrome = translator?.chrome;
    if (!chrome) return;
    setChromeDownload(0);
    void chrome
      .prepare(FROM, TO)
      .then(() => {
        setChromeDownload(null);
        setTranslator((t) => (t ? { ...t, chromeAvailability: 'available' } : t));
        setCards((prev) => prev.map((c) => (c.ptError ? { ...c, ptError: undefined } : c)));
      })
      .catch((err: unknown) => {
        setChromeDownload(null);
        console.error('[viewer] download do tradutor do Chrome falhou:', err);
      });
  };

  // ---- Cabeçalho ----
  const status = useMemo(() => describeStatus(captureStatus, captureError, stt), [captureStatus, captureError, stt]);
  const translatorLabel = useMemo(() => {
    if (!translator) return 'tradução: verificando…';
    if (translator.kind === 'libretranslate') return 'tradução: LibreTranslate';
    if (translator.kind === 'chrome') return `tradução: Chrome${translator.libreError ? ' (LibreTranslate indisponível)' : ''}`;
    return 'sem tradutor disponível';
  }, [translator]);

  const pendingLine = [segmenter.current.pending, partial].filter(Boolean).join(' ');

  return (
    <div className="app">
      <header className="header">
        <h1 title={capture.tabTitle ?? ''}>{capture.tabTitle || 'Video Translate'}</h1>
        <div className="row">
          <span className={`dot ${status.kind}`} />
          <span className="grow" title={status.detail ?? ''}>
            {status.text}
          </span>
          <button className="link" onClick={openOptions} title={translatorLabel}>
            {translatorLabel}
          </button>
          <button className="danger" onClick={stop} disabled={captureStatus === 'stopped'}>
            {captureStatus === 'stopped' ? 'Parado' : 'Parar'}
          </button>
        </div>
        {stt?.state === 'loading' && stt.progress !== undefined && (
          <div className="progress">
            <div style={{ width: `${Math.min(100, stt.progress)}%` }} />
          </div>
        )}
        {chromeDownload !== null && (
          <div className="progress">
            <div style={{ width: `${Math.round(chromeDownload * 100)}%` }} />
          </div>
        )}
      </header>

      <div className="list" ref={listRef} onScroll={onScroll}>
        {translator?.kind === 'chrome' && translator.chromeAvailability === 'downloadable' && chromeDownload === null && (
          <p className="notice warn">
            O Chrome precisa baixar o pacote de tradução inglês → português.{' '}
            <button className="link" onClick={prepareChrome}>
              Baixar agora
            </button>
          </p>
        )}
        {translator?.kind === 'none' && (
          <p className="notice error">
            Nenhum tradutor disponível: {translator.libreError ? `LibreTranslate: ${translator.libreError}. ` : ''}
            A Translator API precisa do Chrome 138+.{' '}
            <button className="link" onClick={openOptions}>
              Abrir opções
            </button>
          </p>
        )}
        {translator?.kind === 'libretranslate' && options && !options.libreUrl && null}

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
                <div className={`pt ${c.pt === undefined ? 'pending' : ''}`}>{c.pt ?? '…'}</div>
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
  const device = stt.device === 'webgpu' ? 'GPU' : 'CPU';
  return { kind: 'listening', text: `Ouvindo · ${modelShortName(stt.model ?? '')} (${device})`, detail: stt.message };
}

function modelShortName(hfId: string): string {
  const base = hfId.split('/').pop() ?? hfId;
  return base.replace(/-ONNX$/i, '').replace(/^onnx-/, '');
}

// Mantém a referência usada no cabeçalho para o label do modelo escolhido nas opções.
void getModelInfo;
