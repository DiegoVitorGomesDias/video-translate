import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { DEFAULT_OPTIONS, loadOptions, originPattern, saveOptions, type Options } from '@/lib/options';
import { STT_MODELS } from '@/lib/stt/models';
import { chromeSpeechAvailability, chromeSpeechInstall, type ChromeSpeechAvailability } from '@/lib/stt/chrome-speech';
import { serverSpeechPing, serverSpeechProbe } from '@/lib/stt/server-speech';
import { VAD_PROFILES, VAD_SENSITIVITIES, type VadProfile, type VadSensitivity } from '@/lib/audio/vad';
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
  const [speech, setSpeech] = useState<ChromeSpeechAvailability | 'checking' | 'installing'>('checking');
  const [speechMsg, setSpeechMsg] = useState<string | null>(null);
  const [serverTest, setServerTest] = useState<TestState>({ kind: 'idle' });

  const ensureOrigin = async (url: string): Promise<string | null> => {
    const pattern = originPattern(url);
    if (!pattern) return 'URL inválida: use http:// ou https://';
    const has = await browser.permissions.contains({ origins: [pattern] }).catch(() => false);
    if (has) return null;
    const granted = await browser.permissions.request({ origins: [pattern] }).catch(() => false);
    return granted ? null : `permissão para ${pattern} negada`;
  };

  const testServer = async () => {
    const url = opts.sttServerUrl.trim();
    if (!url) return;
    setServerTest({ kind: 'testing' });
    const denied = await ensureOrigin(url);
    if (denied) {
      setServerTest({ kind: 'error', error: denied });
      return;
    }
    const cfg = { url, format: opts.sttServerFormat, model: opts.sttServerModel.trim(), apiKey: opts.sttServerApiKey.trim() };
    const ping = await serverSpeechPing(cfg);
    if (!ping.ok) {
      setServerTest({ kind: 'error', error: ping.error });
      return;
    }
    const probe = await serverSpeechProbe(cfg);
    if (!probe.ok) {
      setServerTest({ kind: 'error', error: `${ping.info}; inferência falhou: ${probe.error}` });
      return;
    }
    setServerTest({ kind: 'ok', sample: `${ping.info}; 1 s de áudio transcrito em ${(probe.ms / 1000).toFixed(1)} s` });
  };

  useEffect(() => {
    void loadOptions().then((o) => {
      setOpts(o);
      setLoaded(true);
    });
    void describeChrome().then(setChromeInfo);
    void chromeSpeechAvailability().then(setSpeech);
  }, []);

  const installSpeech = async () => {
    setSpeech('installing');
    setSpeechMsg('Baixando o pacote de voz em inglês (~60 MB)...');
    try {
      const ok = await chromeSpeechInstall();
      const after = await chromeSpeechAvailability();
      setSpeech(after);
      setSpeechMsg(ok && after === 'available' ? 'Pacote instalado.' : `O Chrome respondeu "${after}". Se continuar assim, este Chrome/sistema não oferece o reconhecimento no dispositivo.`);
    } catch (err) {
      setSpeech(await chromeSpeechAvailability());
      setSpeechMsg(`Falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

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
    const serverUrl = opts.sttServerUrl.trim();
    if (opts.sttEngine === 'server' && serverUrl) {
      const denied = await ensureOrigin(serverUrl);
      if (denied) setSaveMsg(`${denied}; o servidor de transcrição não vai funcionar.`);
    }
    await saveOptions({ ...opts, libreUrl: url, libreApiKey: opts.libreApiKey.trim(), sttServerUrl: serverUrl, sttServerModel: opts.sttServerModel.trim(), sttServerApiKey: opts.sttServerApiKey.trim() });
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
        vadSensitivity: opts.vadSensitivity,
        translationFallback: opts.translationFallback,
        fontSize: opts.fontSize,
        glossary: opts.glossary.trim(),
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
        <h2>Contexto do vídeo</h2>
        <label className="model" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={opts.useTabContext} onChange={(e) => update('useTabContext', e.target.checked)} />
          <span>Usar o título da aba como contexto (nomes do vídeo)</span>
        </label>
        <p className="hint">
          Nomes tirados do título (ex.: "Prime Video: Dr. House" → <code>Dr. House</code>, <code>House</code>) ficam sem traduzir ("House está atrasado", não "A casa está atrasada") e
          corrigem a transcrição quando o modelo de fala erra o nome (ex.: "Cutty" → "Cuddy"). A janela de legendas mostra os nomes detectados e deixa remover ou adicionar.
        </p>
        <label htmlFor="glossary">Glossário fixo (um termo por linha ou separados por vírgula)</label>
        <textarea id="glossary" rows={4} value={opts.glossary} onChange={(e) => update('glossary', e.target.value)} placeholder={'Cuddy\nWilson\nForeman'} style={{ width: '100%', font: 'inherit' }} />
        <p className="hint">Vale em todas as capturas, somado aos nomes do título. Use para personagens, siglas e termos técnicos que devem ficar como estão. Só casa palavra inteira com a mesma capitalização.</p>
      </section>

      <section>
        <h2>Motor de transcrição</h2>
        <label className={`model ${opts.sttEngine === 'local' ? 'selected' : ''}`}>
          <input type="radio" name="sttEngine" value="local" checked={opts.sttEngine === 'local'} onChange={() => update('sttEngine', 'local')} />
          <span className="name">Modelo local na extensão (padrão)</span>
          <div className="desc">Roda o modelo escolhido abaixo com transformers.js (WebGPU ou CPU). Funciona em qualquer Chromium.</div>
        </label>
        <label className={`model ${opts.sttEngine === 'chrome' ? 'selected' : ''}`}>
          <input type="radio" name="sttEngine" value="chrome" checked={opts.sttEngine === 'chrome'} onChange={() => update('sttEngine', 'chrome')} />
          <span className="name">Reconhecimento do Chrome no dispositivo</span>
          <div className="desc">
            Mesmo motor do Live Caption, sem download na extensão (o Chrome baixa um pacote de ~60 MB uma vez). Texto contínuo com pontuação e usa os nomes do título e do
            glossário para acertar o reconhecimento. Só no Chrome da Google (139+); se não estiver disponível, a captura cai para o modelo local.
            {' '}
            {speech === 'checking' && 'Verificando...'}
            {speech === 'available' && <strong>Disponível neste Chrome.</strong>}
            {speech === 'downloading' && 'Pacote de voz sendo baixado...'}
            {speech === 'installing' && 'Instalando...'}
            {speech === 'downloadable' && (
              <>
                Pacote de voz ainda não instalado.{' '}
                <button type="button" onClick={() => void installSpeech()}>
                  Instalar pacote de voz (en-US)
                </button>
              </>
            )}
            {speech === 'unavailable' && <strong>Indisponível neste Chrome/sistema</strong>}
            {speech === 'unsupported' && <strong>Este navegador não tem a API (Chrome 139+).</strong>}
            {speechMsg && <div>{speechMsg}</div>}
          </div>
        </label>
        <label className={`model ${opts.sttEngine === 'server' ? 'selected' : ''}`}>
          <input type="radio" name="sttEngine" value="server" checked={opts.sttEngine === 'server'} onChange={() => update('sttEngine', 'server')} />
          <span className="name">Servidor local (Docker)</span>
          <div className="desc">
            Roda o Whisper fora do navegador, com whisper.cpp em Docker (CPU, CUDA ou Vulkan). Mais rápido que o WebGPU e com janela de 15 s em vez de 30 s. Se o servidor não
            responder, a captura cai para o modelo local. Como subir: veja <code>docker/README.md</code> no repositório ou o README principal.
          </div>
        </label>
        {opts.sttEngine === 'server' && (
          <div style={{ marginLeft: 24 }}>
            <label htmlFor="sttServerUrl">URL do servidor</label>
            <input
              id="sttServerUrl"
              type="url"
              placeholder="http://localhost:8080"
              value={opts.sttServerUrl}
              onChange={(e) => {
                update('sttServerUrl', e.target.value);
                setServerTest({ kind: 'idle' });
              }}
            />
            <label htmlFor="sttServerFormat">Formato da API</label>
            <select id="sttServerFormat" value={opts.sttServerFormat} onChange={(e) => update('sttServerFormat', e.target.value as Options['sttServerFormat'])}>
              <option value="whispercpp">whisper.cpp (POST /inference; padrão do docker/ deste projeto)</option>
              <option value="openai">Compatível com OpenAI (POST /v1/audio/transcriptions: Speaches, ScribeCrate, LocalAI)</option>
            </select>
            {opts.sttServerFormat === 'openai' && (
              <>
                <label htmlFor="sttServerModel">Nome do modelo (campo "model")</label>
                <input id="sttServerModel" type="text" value={opts.sttServerModel} onChange={(e) => update('sttServerModel', e.target.value)} placeholder="whisper-1" />
              </>
            )}
            <label htmlFor="sttServerKey">Chave da API (opcional)</label>
            <input id="sttServerKey" type="password" value={opts.sttServerApiKey} onChange={(e) => update('sttServerApiKey', e.target.value)} autoComplete="off" />
            <div className="row">
              <button onClick={() => void testServer()} disabled={!opts.sttServerUrl.trim() || serverTest.kind === 'testing'}>
                {serverTest.kind === 'testing' ? 'Testando…' : 'Testar servidor'}
              </button>
              {serverTest.kind === 'ok' && <span className="status ok">OK: {serverTest.sample}</span>}
              {serverTest.kind === 'error' && <span className="status error">Falhou: {serverTest.error}</span>}
            </div>
            <p className="hint">O servidor recebe cada trecho de fala como WAV e devolve o texto; o glossário e as últimas frases vão como prompt. Nada sai da sua rede.</p>
          </div>
        )}
      </section>

      <section>
        <h2>Modelo de transcrição local</h2>
        {STT_MODELS.map((m) => (
          <label key={m.id} className={`model ${opts.sttModel === m.id ? 'selected' : ''}`}>
            <input type="radio" name="sttModel" value={m.id} checked={opts.sttModel === m.id} onChange={() => update('sttModel', m.id as SttModelId)} />
            <span className="name">{m.label}</span>
            <div className="desc">
              {m.description} Download: ~{m.downloadMb.webgpu} MB (GPU) ou ~{m.downloadMb.wasm} MB (CPU), só na primeira vez.
              <br />
              <strong>Tempo de resposta</strong> (trecho de ~5 s): {m.latency}.
            </div>
            {m.warning && opts.sttModel === m.id && <div className="warn">{m.warning}</div>}
          </label>
        ))}
        <p className="hint">
          Tempos estimados; o real aparece na janela de legendas (latência por trecho). Qualquer modelo Whisper processa uma janela fixa de 30 s, por isso a duração do trecho quase não muda o tempo de resposta.
        </p>
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
        <h2>Sensibilidade do detector de fala</h2>
        {(Object.keys(VAD_SENSITIVITIES) as VadSensitivity[]).map((id) => (
          <label key={id} className={`model ${opts.vadSensitivity === id ? 'selected' : ''}`}>
            <input type="radio" name="vadSensitivity" value={id} checked={opts.vadSensitivity === id} onChange={() => update('vadSensitivity', id)} />
            <span className="name">{VAD_SENSITIVITIES[id].label}{id === 'normal' ? ' (padrão)' : ''}</span>
            <div className="desc">{VAD_SENSITIVITIES[id].description}</div>
          </label>
        ))}
        <p className="hint">Vale na próxima captura. Baixa para séries com trilha sonora alta; Alta para falas sussurradas ou pensamentos em off.</p>
      </section>

      <section>
        <h2>Aparência</h2>
        <label htmlFor="displayMode">Onde mostrar as legendas</label>
        <select id="displayMode" value={opts.displayMode} onChange={(e) => update('displayMode', e.target.value as Options['displayMode'])}>
          <option value="sidepanel">Painel lateral do Chrome, ao lado da página (padrão)</option>
          <option value="drawer">Painel sobreposto à página do vídeo</option>
          <option value="window">Janela separada</option>
        </select>
        <p className="hint">
          O painel lateral do Chrome encolhe a página para caber ao lado, e a largura se ajusta arrastando a borda dele. O painel sobreposto fica por cima do vídeo e não
          funciona em páginas que não aceitam scripts (chrome://, loja). Os dois somem em tela cheia (é o esperado); nesses casos use a janela.
        </p>
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
