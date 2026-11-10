import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { DEFAULT_OPTIONS, loadOptions, originPattern, saveOptions, type Options } from '@/lib/options';
import { STT_MODELS } from '@/lib/stt/models';
import { VAD_PROFILES, type VadProfile } from '@/lib/audio/vad';
import { LibreTranslateProvider, chromeTranslatorBestPair, ChromeTranslatorProvider, LOCAL_MT_DOWNLOAD_MB, LocalOpusProvider, GoogleFreeProvider } from '@/lib/translate';
import type { SttModelId } from '@/lib/messages';

/** URL pública do PWA (GitHub Pages). */
export const PWA_URL = 'https://diegovitorgomesdias.github.io/video-translate/';

function encodeForUrl(obj: unknown): string {
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type TestState = { kind: 'idle' } | { kind: 'testing' } | { kind: 'ok'; sample: string } | { kind: 'error'; error: string };

export function App() {
  const [opts, setOpts] = useState<Options>(DEFAULT_OPTIONS);
  const [loaded, setLoaded] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [chromeInfo, setChromeInfo] = useState<string | null>(null);
  const [fallbackTest, setFallbackTest] = useState<string | null>(null);
  const [qr, setQr] = useState<{ url: string; dataUrl: string; withSettings: boolean } | null>(null);
  const [includeKey, setIncludeKey] = useState(false);

  useEffect(() => {
    void loadOptions().then((o) => {
      setOpts(o);
      setLoaded(true);
    });
    void describeChrome().then(setChromeInfo);
  }, []);

  const update = <K extends keyof Options>(key: K, value: Options[K]) => {
    setOpts((o) => ({ ...o, [key]: value }));
    setSaveMsg(null);
  };

  const save = async () => {
    const url = opts.libreUrl.trim();
    if (url) {
      const pattern = originPattern(url);
      if (!pattern) {
        setSaveMsg('URL inválida: use http:// ou https://');
        return;
      }
      // Permissão de host só para a origem configurada (optional_host_permissions).
      const granted = await browser.permissions.request({ origins: [pattern] }).catch(() => false);
      if (!granted) {
        setSaveMsg(`Permissão para ${pattern} negada; a tradução via LibreTranslate não vai funcionar.`);
      }
    }
    await saveOptions({ ...opts, libreUrl: url, libreApiKey: opts.libreApiKey.trim() });
    setSaveMsg((m) => m ?? 'Salvo.');
  };

  const testConnection = async () => {
    const url = opts.libreUrl.trim();
    if (!url) return;
    setTest({ kind: 'testing' });
    const pattern = originPattern(url);
    if (pattern) {
      const has = await browser.permissions.contains({ origins: [pattern] }).catch(() => false);
      if (!has) {
        const granted = await browser.permissions.request({ origins: [pattern] }).catch(() => false);
        if (!granted) {
          setTest({ kind: 'error', error: 'permissão de acesso à URL negada' });
          return;
        }
      }
    }
    const libre = new LibreTranslateProvider({ url, apiKey: opts.libreApiKey.trim() });
    const health = await libre.healthCheck('en', 'pt');
    if (!health.ok) {
      setTest({ kind: 'error', error: health.error });
      return;
    }
    try {
      const sample = await libre.translate('This is amazing!', 'en', 'pt');
      setTest({ kind: 'ok', sample });
    } catch (err) {
      setTest({ kind: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  };

  const testFallback = async () => {
    setFallbackTest('testando…');
    const t0 = performance.now();
    try {
      const samples = ['This is amazing!', "Let's continue our project next Monday.", 'She brought cases before, but he never made her run the test.'];
      let provider: LocalOpusProvider | GoogleFreeProvider;
      if (opts.translationFallback === 'local') {
        const local = new LocalOpusProvider((p) => browser.runtime.getURL(p as never));
        local.onStatus = (st) => {
          if (st.state === 'loading') setFallbackTest(`baixando/carregando modelo… ${st.progress !== undefined ? `${st.progress.toFixed(0)}%` : ''}`);
        };
        await local.start();
        provider = local;
      } else {
        provider = new GoogleFreeProvider();
      }
      const t1 = performance.now();
      const results: string[] = [];
      for (const en of samples) results.push(`"${en}" → "${await provider.translate(en, 'en', 'pt')}"`);
      const perSentence = ((performance.now() - t1) / samples.length / 1000).toFixed(1);
      if (provider instanceof LocalOpusProvider) provider.dispose();
      setFallbackTest(`OK em ${((performance.now() - t0) / 1000).toFixed(1)} s (${perSentence} s por frase): ${results.join(' | ')}`);
    } catch (err) {
      setFallbackTest(`Falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const makeQr = async (withSettings: boolean) => {
    let url = PWA_URL;
    if (withSettings) {
      const payload = {
        libreUrl: opts.libreUrl.trim(),
        libreApiKey: includeKey ? opts.libreApiKey.trim() : '',
        sttModel: opts.sttModel,
        sentenceSplit: opts.sentenceSplit,
        translationFallback: opts.translationFallback,
        fontSize: opts.fontSize,
      };
      url = `${PWA_URL}#import=${encodeForUrl(payload)}`;
    }
    const dataUrl = await QRCode.toDataURL(url, { width: 220, margin: 1, errorCorrectionLevel: 'M' });
    setQr({ url, dataUrl, withSettings });
  };

  if (!loaded) return null;

  return (
    <main className="page">
      <h1>Video Translate</h1>
      <p className="sub">Configurações da transcrição e da tradução. Mudanças no modelo valem na próxima captura.</p>

      <section>
        <h2>Tradução</h2>
        <label htmlFor="libreUrl">URL do LibreTranslate</label>
        <input
          id="libreUrl"
          type="url"
          placeholder="http://localhost:5000"
          value={opts.libreUrl}
          onChange={(e) => {
            update('libreUrl', e.target.value);
            setTest({ kind: 'idle' });
          }}
        />
        <p className="hint">
          Deixe em branco para usar só a Translator API do Chrome. Para rodar o LibreTranslate localmente:{' '}
          <code>docker run -d -p 5000:5000 libretranslate/libretranslate --load-only en,pt</code>
        </p>
        <label htmlFor="libreKey">Chave da API (opcional)</label>
        <input id="libreKey" type="password" value={opts.libreApiKey} onChange={(e) => update('libreApiKey', e.target.value)} autoComplete="off" />
        <div className="row">
          <button onClick={testConnection} disabled={!opts.libreUrl.trim() || test.kind === 'testing'}>
            {test.kind === 'testing' ? 'Testando…' : 'Testar conexão'}
          </button>
          {test.kind === 'ok' && (
            <span className="status ok">
              OK: "This is amazing!" → "{test.sample}"
            </span>
          )}
          {test.kind === 'error' && <span className="status error">Falhou: {test.error}</span>}
        </div>
        <p className="hint">
          Fallback 1: Translator API do Chrome (138+, roda no computador, sem chave). {chromeInfo ?? 'verificando…'}
        </p>
        <label htmlFor="fallback">Fallback 2 (quando os dois acima falham)</label>
        <select id="fallback" value={opts.translationFallback} onChange={(e) => update('translationFallback', e.target.value as Options['translationFallback'])}>
          <option value="local">Tradução local no navegador (padrão; opus-mt en→pt, ~{LOCAL_MT_DOWNLOAD_MB} MB uma vez, offline)</option>
          <option value="google">Google Tradutor (endpoint público não oficial; envia o texto das frases para fora)</option>
          <option value="none">Nenhum (mostrar só o inglês)</option>
        </select>
        {opts.translationFallback === 'google' && (
          <p className="hint" style={{ color: 'var(--danger)' }}>
            Atenção: o texto de cada frase é enviado ao Google por um endpoint não oficial, sem garantia de disponibilidade.
          </p>
        )}
        <div className="row">
          <button id="test-fallback" onClick={() => void testFallback()} disabled={opts.translationFallback === 'none' || fallbackTest === 'testando…'}>
            Testar fallback 2
          </button>
          {fallbackTest && <span id="fallback-result" className={`status ${fallbackTest.startsWith('OK') ? 'ok' : fallbackTest.startsWith('Falhou') ? 'error' : ''}`}>{fallbackTest}</span>}
        </div>
        <p className="hint">
          Se a Translator API aparecer como indisponível, confira <code>chrome://on-device-translation-internals</code> e a flag <code>chrome://flags/#translation-api</code> (Chrome 138+ desktop).
        </p>
      </section>

      <section>
        <h2>Modelo de transcrição</h2>
        {STT_MODELS.map((m) => (
          <label key={m.id} className={`model ${opts.sttModel === m.id ? 'selected' : ''}`}>
            <input type="radio" name="sttModel" value={m.id} checked={opts.sttModel === m.id} onChange={() => update('sttModel', m.id as SttModelId)} />
            <span className="name">{m.label}</span>
            <div className="desc">
              {m.description} Download: ~{m.downloadMb.webgpu} MB (GPU) ou ~{m.downloadMb.wasm} MB (CPU), só na primeira vez.
            </div>
          </label>
        ))}
      </section>

      <section>
        <h2>Separação de frases</h2>
        {(Object.keys(VAD_PROFILES) as VadProfile[]).map((id) => (
          <label key={id} className={`model ${opts.sentenceSplit === id ? 'selected' : ''}`}>
            <input type="radio" name="sentenceSplit" value={id} checked={opts.sentenceSplit === id} onChange={() => update('sentenceSplit', id)} />
            <span className="name">{VAD_PROFILES[id].label}{id === 'normal' ? ' (padrão)' : ''}</span>
            <div className="desc">{VAD_PROFILES[id].description}</div>
          </label>
        ))}
        <p className="hint">Vale na próxima captura. Independente do nível, uma pausa na fala sempre fecha a frase, e frases coladas sem pontuação são separadas por heurística.</p>
      </section>

      <section>
        <h2>Aparência</h2>
        <label htmlFor="displayMode">Onde mostrar as legendas</label>
        <select id="displayMode" value={opts.displayMode} onChange={(e) => update('displayMode', e.target.value as Options['displayMode'])}>
          <option value="drawer">Painel lateral na própria página do vídeo (padrão)</option>
          <option value="window">Janela separada</option>
        </select>
        <p className="hint">O painel some em tela cheia (é o esperado) e em páginas que não aceitam scripts (chrome://, loja); nesses casos a janela é usada.</p>
        <label htmlFor="fontSize">Tamanho da fonte: {opts.fontSize}px</label>
        <input id="fontSize" type="range" min={12} max={32} step={1} value={opts.fontSize} onChange={(e) => update('fontSize', Number(e.target.value))} />
        <div className="preview" style={{ ['--preview-size' as string]: `${opts.fontSize}px` }}>
          <div>This is amazing!</div>
          <div className="pt">Isso é incrível!</div>
        </div>
      </section>

      <section>
        <h2>Celular e tablet</h2>
        <p className="hint">
          Extensões não existem no Chrome de celular. Para isso há a versão web (PWA), que ouve o som pelo microfone e transcreve/traduz no próprio aparelho:{' '}
          <a href={PWA_URL} target="_blank" rel="noreferrer">
            {PWA_URL}
          </a>
          . Abra no Chrome do celular e use "Adicionar à tela inicial".
        </p>
        <div className="row">
          <button onClick={() => void makeQr(false)}>Mostrar QR do app</button>
          <button onClick={() => void makeQr(true)}>Exportar configurações (QR)</button>
          <label style={{ fontWeight: 400, display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}>
            <input type="checkbox" checked={includeKey} onChange={(e) => setIncludeKey(e.target.checked)} /> incluir chave do LibreTranslate
          </label>
        </div>
        {qr && (
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <img src={qr.dataUrl} alt="QR code" width={220} height={220} style={{ borderRadius: 8, background: '#fff' }} />
            <div className="hint" style={{ flex: 1, wordBreak: 'break-all' }}>
              {qr.withSettings
                ? 'Leia com a câmera do celular: o app abre e pergunta se quer importar a URL do LibreTranslate, o modelo, o fallback de tradução e a fonte.'
                : 'Leia com a câmera do celular para abrir o app.'}
              <br />
              <a href={qr.url} target="_blank" rel="noreferrer">
                {qr.url.length > 120 ? `${qr.url.slice(0, 120)}…` : qr.url}
              </a>
              {qr.withSettings && opts.libreUrl.includes('localhost') && (
                <p style={{ color: 'var(--danger)' }}>Atenção: "localhost" no celular aponta para o próprio celular. Troque pelo IP do computador na rede Wi-Fi (ex.: http://192.168.0.10:5000) antes de exportar.</p>
              )}
            </div>
          </div>
        )}
      </section>

      <div className="row">
        <button className="primary" onClick={() => void save()}>
          Salvar
        </button>
        {saveMsg && <span className={`status ${saveMsg === 'Salvo.' ? 'ok' : 'error'}`}>{saveMsg}</span>}
      </div>
      <p className="hint" style={{ marginTop: 24 }}>Video Translate v{browser.runtime.getManifest().version}</p>
    </main>
  );
}

async function describeChrome(): Promise<string> {
  const pair = await chromeTranslatorBestPair('en', 'pt');
  if (!pair) return 'Indisponível neste navegador (API ausente ou par EN→PT não suportado).';
  if (pair.availability !== 'available') return `Par ${pair.source}→${pair.target}: pacote ainda não baixado (${pair.availability}).`;
  const chrome = new ChromeTranslatorProvider();
  try {
    await chrome.prepare(pair.source, pair.target);
    const sample = await chrome.translate('This is amazing!', pair.source, pair.target);
    chrome.dispose();
    return `OK (${pair.source}→${pair.target}): "This is amazing!" → "${sample}"`;
  } catch (err) {
    return `Par ${pair.source}→${pair.target} marcado como disponível, mas a criação falhou: ${err instanceof Error ? err.message : String(err)}`;
  }
}
