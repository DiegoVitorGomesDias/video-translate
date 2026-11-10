import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SentenceSegmenter, normalize, type Sentence } from '@/lib/segmenter';
import { modelLabelFor } from '@/lib/stt/models';
import type { VadEngine } from '@/lib/audio/silero-vad';
import { VAD_PROFILES, type VadProfile } from '@/lib/audio/vad';
import type { SttModelId } from '@/lib/messages';
import { createTranslator, type LocalOpusStatus, type TranslatorSelection } from '@/lib/translate';
import { ContextualTranslationProvider } from '@/lib/translate/contextual';
import { correctTranscript, mergeTerms, parseGlossary } from '@/lib/context';
import type { SpeechProviderStatus, TranscriptResult } from '@/lib/stt/SpeechProvider';
import { MicCapture, listMicrophones, resolveAsset, type MicDevice } from './capture';
import { SettingsPanel } from './Settings';
import { IMPORT_HASH_KEY, loadSettings, readImportFromHash, saveSettings, type Settings } from './settings';

interface Card extends Sentence {
  pt?: string;
  ptError?: string;
}

const FROM = 'en';
const TO = 'pt';
const VERSION = __APP_VERSION__;

export function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [pendingImport, setPendingImport] = useState<Settings | null>(() => readImportFromHash());
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stt, setStt] = useState<SpeechProviderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [cards, setCards] = useState<Card[]>([]);
  const [partial, setPartial] = useState('');
  const [translator, setTranslator] = useState<TranslatorSelection | null>(null);
  const [localStatus, setLocalStatus] = useState<LocalOpusStatus | null>(null);
  const [stuckToEnd, setStuckToEnd] = useState(true);
  const [mic, setMic] = useState<MicDevice | null>(null);
  const [mics, setMics] = useState<MicDevice[]>([]);
  const [applied, setApplied] = useState<{ sttModel: SttModelId; vadProfile: VadProfile } | null>(null);
  const [vadEngine, setVadEngine] = useState<VadEngine | null>(null);

  const capture = useRef(new MicCapture());
  const segmenter = useRef(new SentenceSegmenter({ maxChars: 90, maxWaitMs: 5000 }));
  const listRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(new Set<number>());
  /** Termos do glossário (mantidos na tradução, corrigidos na transcrição). */
  const terms = useMemo(() => mergeTerms(parseGlossary(settings.glossary)), [settings.glossary]);
  const termsRef = useRef<string[]>([]);
  const vadEngineRef = useRef<VadEngine | null>(null);
  termsRef.current = terms;

  useEffect(() => {
    document.documentElement.style.setProperty('--font-size', `${settings.fontSize}px`);
  }, [settings.fontSize]);

  // ---- Tradutor ----
  useEffect(() => {
    let cancelled = false;
    setTranslator(null);
    void createTranslator({
      libreUrl: settings.libreUrl,
      libreApiKey: settings.libreApiKey,
      fallback: settings.translationFallback,
      resolveUrl: resolveAsset,
      from: FROM,
      to: TO,
    }).then((sel) => {
      if (cancelled) {
        sel.provider?.dispose?.();
        return;
      }
      if (sel.local) {
        sel.local.onStatus = setLocalStatus;
        void sel.local.start().catch(() => undefined);
      } else setLocalStatus(null);
      setTranslator({ ...sel, provider: sel.provider ? new ContextualTranslationProvider(sel.provider, () => termsRef.current) : null });
      setCards((prev) => prev.map((c) => (c.ptError ? { ...c, ptError: undefined } : c)));
    });
    return () => {
      cancelled = true;
    };
  }, [settings.libreUrl, settings.libreApiKey, settings.translationFallback]);

  useEffect(() => {
    const provider = translator?.provider;
    if (!provider) return;
    for (const c of cards) {
      if (c.pt !== undefined || c.ptError || inFlight.current.has(c.id)) continue;
      inFlight.current.add(c.id);
      provider
        .translate(c.text, FROM, TO)
        .then((pt) => setCards((prev) => prev.map((x) => (x.id === c.id ? { ...x, pt } : x))))
        .catch((err: unknown) => setCards((prev) => prev.map((x) => (x.id === c.id ? { ...x, ptError: err instanceof Error ? err.message : String(err) } : x))))
        .finally(() => inFlight.current.delete(c.id));
    }
  }, [cards, translator]);

  // ---- Segmentação ----
  const onResult = useCallback((r: TranscriptResult) => {
    const text = correctTranscript(r.text, termsRef.current);
    if (r.isFinal) {
      const out = segmenter.current.push(text, Date.now(), r.reason ?? 'max-length');
      if (out.length) setCards((prev) => [...prev, ...out]);
      setPartial('');
    } else {
      setPartial(normalize(text));
    }
  }, []);
  useEffect(() => {
    const t = window.setInterval(() => {
      const out = segmenter.current.flushIfStale(Date.now());
      if (out.length) setCards((prev) => [...prev, ...out]);
    }, 500);
    return () => window.clearInterval(t);
  }, []);

  // ---- Captura ----
  const start = async () => {
    setError(null);
    setStarting(true);
    setApplied({ sttModel: settings.sttModel, vadProfile: settings.sentenceSplit });
    try {
      await capture.current.start(
        settings.sttModel,
        {
          onStatus: setStt,
          onResult,
          onLevel: (level) => setLevel(Math.min(1, vadEngineRef.current === 'silero' ? level : level * 8)),
          onVadEngine: (e) => {
            vadEngineRef.current = e;
            setVadEngine(e);
          },
          onError: (m) => setError(m),
          onDevice: (d) => {
            setMic(d);
            void listMicrophones().then(setMics);
          },
        },
        settings.micDeviceId,
        settings.sentenceSplit,
      );
      setRunning(true);
    } catch (err) {
      setError(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      await capture.current.stop();
    } finally {
      setStarting(false);
    }
  };
  const stop = async () => {
    await capture.current.stop();
    setRunning(false);
    setLevel(0);
    const out = segmenter.current.flush(Date.now());
    if (out.length) setCards((prev) => [...prev, ...out]);
    setPartial('');
  };

  // ---- Scroll ----
  useEffect(() => {
    const el = listRef.current;
    if (el && stuckToEnd) el.scrollTop = el.scrollHeight;
  }, [cards, partial, stuckToEnd]);
  const onScroll = () => {
    const el = listRef.current;
    if (el) setStuckToEnd(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  // ---- Importação de configurações pela URL ----
  const applyImport = () => {
    if (!pendingImport) return;
    saveSettings(pendingImport);
    setSettings(pendingImport);
    setPendingImport(null);
    history.replaceState(null, '', location.pathname + location.search);
  };
  const dismissImport = () => {
    setPendingImport(null);
    history.replaceState(null, '', location.pathname + location.search);
  };

  const chooseMic = async (deviceId: string) => {
    const next = { ...settings, micDeviceId: deviceId };
    saveSettings(next);
    setSettings(next);
    await capture.current.switchMicrophone(deviceId);
  };

  const statusText = useMemo(() => {
    if (error) return `Erro: ${error}`;
    if (!running) return starting ? 'Pedindo acesso ao microfone…' : 'Parado';
    if (!stt || stt.state === 'loading') return `Carregando modelo${stt?.progress !== undefined ? ` ${stt.progress.toFixed(0)}%` : '…'}`;
    if (stt.state === 'error') return 'Modelo não carregou';
    return `Ouvindo · ${(stt.model ?? '').split('/').pop()?.replace(/-ONNX$/, '')} (${stt.device === 'webgpu' ? 'GPU' : 'CPU'})`;
  }, [error, running, starting, stt]);
  const dotKind = error || stt?.state === 'error' ? 'error' : !running ? 'idle' : stt?.state === 'ready' ? 'listening' : 'loading';

  const translatorLabel = !translator
    ? 'tradução: verificando…'
    : translator.kind === 'libretranslate'
      ? 'tradução: LibreTranslate'
      : translator.kind === 'chrome'
        ? 'tradução: Chrome'
        : translator.kind === 'local'
          ? localStatus?.state === 'loading'
            ? `baixando tradutor ${localStatus.progress?.toFixed(0) ?? ''}%`
            : 'tradução: no aparelho'
          : translator.kind === 'google-free'
            ? 'tradução: Google'
            : 'sem tradução';

  const configLine = useMemo(() => {
    const cfg = applied ?? { sttModel: settings.sttModel, vadProfile: settings.sentenceSplit };
    const modelLabel = modelLabelFor(running && stt?.state === 'ready' ? stt.model : undefined, cfg.sttModel);
    const backend = running && stt?.state === 'ready' ? (stt.device === 'webgpu' ? 'GPU' : 'WASM') : null;
    const vp = VAD_PROFILES[cfg.vadProfile] ?? VAD_PROFILES.normal;
    const vadLabel = running && vadEngine ? (vadEngine === 'silero' ? ' · Silero' : ' · energia') : '';
    const changed = !!applied && running && (settings.sttModel !== applied.sttModel || settings.sentenceSplit !== applied.vadProfile);
    return { model: `${modelLabel}${backend ? ` · ${backend}` : ''}`, split: `Separação: ${vp.label} (${vp.silenceMs / 1000} s / ${vp.maxSegmentMs / 1000} s)${vadLabel}`, changed };
  }, [applied, settings, stt, running, vadEngine]);

  const pendingLine = [segmenter.current.pending, partial].filter(Boolean).join(' ');

  return (
    <div className="app">
      <header className="header">
        <h1>
          Video Translate <span className="version">v{VERSION}</span>
        </h1>
        <div className="row">
          <span className={`dot ${dotKind}`} />
          <span className="grow">{statusText}</span>
          <button className="link" onClick={() => setShowSettings(true)}>
            {translatorLabel}
          </button>
          <button onClick={() => setShowSettings(true)} title="Configurações">
            ⚙
          </button>
        </div>
        <div className="config-line" onClick={() => setShowSettings(true)} title="Configuração aplicada. Toque para abrir as configurações.">
          <span className="chip">{configLine.model}</span>
          <span className="chip">{configLine.split}</span>
          {configLine.changed && <span className="chip warn">novas opções valem na próxima captura</span>}
          {terms.length > 0 && (
            <span className="chip" title={`Contexto: ${terms.join(', ')} (ficam sem traduzir e corrigem a transcrição)`}>
              contexto: {terms.slice(0, 4).join(', ')}
              {terms.length > 4 ? ` +${terms.length - 4}` : ''}
            </span>
          )}
        </div>
        {running && stt?.state === 'loading' && stt.progress !== undefined && (
          <div className="progress-row" title={stt.message ?? ''}>
            <span className="progress-label">modelo</span>
            <div className="progress">
              <div style={{ width: `${Math.max(0, Math.min(100, stt.progress))}%` }} />
            </div>
            <span className="progress-pct">{Math.max(0, Math.min(100, stt.progress)).toFixed(0)}%</span>
          </div>
        )}
        {running && stt?.state === 'ready' && (
          <div className="level">
            <div style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
        )}
        {running && mics.length > 1 && (
          <div className="row" style={{ marginTop: 6 }}>
            <span>🎤</span>
            <select className="mic" value={settings.micDeviceId} onChange={(e) => void chooseMic(e.target.value)} title="Microfone em uso">
              <option value="">Automático: microfone do aparelho{mic ? ` (${mic.label})` : ''}</option>
              {mics.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                  {d.isHeadset ? ' (fone)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        {running && mic?.isHeadset && (
          <p className="notice warn" style={{ margin: '6px 0 0' }}>
            Usando o microfone do fone ({mic.label}). Para ouvir o vídeo, prefira o microfone do aparelho no seletor acima.
          </p>
        )}
      </header>

      <div className="list" ref={listRef} onScroll={onScroll}>
        {cards.length === 0 && !pendingLine && (
          <p className="empty">
            {running
              ? stt?.state === 'ready'
                ? 'Ouvindo… aproxime o aparelho do som do vídeo. As frases aparecem aqui.'
                : 'Carregando o modelo de transcrição (só demora na primeira vez).'
              : 'Toque em Iniciar, permita o microfone e deixe o som do vídeo audível. A transcrição e a tradução acontecem no próprio aparelho.'}
          </p>
        )}
        {cards.map((c) => (
          <article className="card" key={c.id}>
            <div className="en">{c.text}</div>
            {translator?.provider ? (
              c.ptError ? (
                <div className="pt error">tradução falhou: {c.ptError}</div>
              ) : (
                <div className={`pt ${c.pt === undefined ? 'pending' : ''}`}>
                  {c.pt ?? (translator.kind === 'local' && localStatus?.state === 'loading' ? `baixando tradutor ${localStatus.progress?.toFixed(0) ?? ''}%` : '…')}
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

      <button id="toggle" className={`big ${running ? 'stop' : ''}`} onClick={() => void (running ? stop() : start())} disabled={starting}>
        {running ? 'Parar' : 'Iniciar'}
      </button>

      {showSettings && (
        <SettingsPanel
          value={settings}
          onSave={(s) => {
            saveSettings(s);
            setSettings(s);
            setShowSettings(false);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {pendingImport && (
        <div className="modal">
          <div>
            <h2>Importar configurações?</h2>
            <p className="hint">Este link veio da extensão no computador e traz:</p>
            <pre>{JSON.stringify({ ...pendingImport, libreApiKey: pendingImport.libreApiKey ? '••••' : '' }, null, 2)}</pre>
            <div className="actions" style={{ display: 'flex', gap: 10 }}>
              <button className="primary" onClick={applyImport}>
                Importar
              </button>
              <button onClick={dismissImport}>Ignorar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Referência mantida para o tipo da chave de importação (usada pela extensão).
void IMPORT_HASH_KEY;
