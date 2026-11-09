import { useEffect, useState } from 'react';
import { DEFAULT_OPTIONS, loadOptions, originPattern, saveOptions, type Options } from '@/lib/options';
import { STT_MODELS } from '@/lib/stt/models';
import { LibreTranslateProvider, chromeTranslatorAvailability, type ChromeTranslatorAvailability } from '@/lib/translate';
import type { SttModelId } from '@/lib/messages';

type TestState = { kind: 'idle' } | { kind: 'testing' } | { kind: 'ok'; sample: string } | { kind: 'error'; error: string };

export function App() {
  const [opts, setOpts] = useState<Options>(DEFAULT_OPTIONS);
  const [loaded, setLoaded] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [chromeAvail, setChromeAvail] = useState<ChromeTranslatorAvailability | null>(null);

  useEffect(() => {
    void loadOptions().then((o) => {
      setOpts(o);
      setLoaded(true);
    });
    void chromeTranslatorAvailability('en', 'pt').then(setChromeAvail);
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

  if (!loaded) return null;

  return (
    <main className="page">
      <h1>Video Translate <small style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 13 }}>v{browser.runtime.getManifest().version}</small></h1>
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
          Fallback: Translator API do Chrome (138+, roda no computador, sem chave).{' '}
          {chromeAvail === null
            ? ''
            : chromeAvail === 'unavailable'
              ? 'Indisponível neste navegador.'
              : chromeAvail === 'available'
                ? 'Disponível, pacote EN→PT já baixado.'
                : 'Disponível; o pacote EN→PT será baixado no primeiro uso.'}
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
        <h2>Aparência</h2>
        <label htmlFor="fontSize">Tamanho da fonte: {opts.fontSize}px</label>
        <input id="fontSize" type="range" min={12} max={32} step={1} value={opts.fontSize} onChange={(e) => update('fontSize', Number(e.target.value))} />
        <div className="preview" style={{ ['--preview-size' as string]: `${opts.fontSize}px` }}>
          <div>This is amazing!</div>
          <div className="pt">Isso é incrível!</div>
        </div>
      </section>

      <div className="row">
        <button className="primary" onClick={() => void save()}>
          Salvar
        </button>
        {saveMsg && <span className={`status ${saveMsg === 'Salvo.' ? 'ok' : 'error'}`}>{saveMsg}</span>}
      </div>
    </main>
  );
}
