import { useEffect, useState } from 'react';
import { listMicrophones, type MicDevice } from './capture';
import { STT_MODELS } from '@/lib/stt/models';
import { VAD_PROFILES, type VadProfile } from '@/lib/audio/vad';
import { LOCAL_MT_DOWNLOAD_MB, LibreTranslateProvider } from '@/lib/translate';
import type { Settings } from './settings';
import type { SttModelId } from '@/lib/messages';

export function SettingsPanel({ value, onSave, onClose }: { value: Settings; onSave: (s: Settings) => void; onClose: () => void }) {
  const [s, setS] = useState<Settings>(value);
  const [test, setTest] = useState<string | null>(null);
  const [mics, setMics] = useState<MicDevice[]>([]);
  useEffect(() => {
    void listMicrophones().then(setMics).catch(() => setMics([]));
  }, []);
  const update = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));

  const testLibre = async () => {
    setTest('testando…');
    const libre = new LibreTranslateProvider({ url: s.libreUrl.trim(), apiKey: s.libreApiKey.trim() });
    const h = await libre.healthCheck('en', 'pt');
    if (!h.ok) return setTest(`Falhou: ${h.error}`);
    try {
      setTest(`OK: "This is amazing!" → "${await libre.translate('This is amazing!', 'en', 'pt')}"`);
    } catch (err) {
      setTest(`Falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="settings">
      <h2>Configurações</h2>

      <label htmlFor="libreUrl">URL do LibreTranslate (opcional)</label>
      <input id="libreUrl" type="url" placeholder="http://192.168.0.10:5000" value={s.libreUrl} onChange={(e) => update('libreUrl', e.target.value)} />
      <p className="hint">No celular, use o IP do computador na mesma rede Wi-Fi onde o LibreTranslate está rodando. Vazio = só tradução no aparelho.</p>
      <label htmlFor="libreKey">Chave da API (opcional)</label>
      <input id="libreKey" type="password" value={s.libreApiKey} onChange={(e) => update('libreApiKey', e.target.value)} autoComplete="off" />
      <div className="actions" style={{ marginTop: 10 }}>
        <button onClick={() => void testLibre()} disabled={!s.libreUrl.trim()}>
          Testar conexão
        </button>
        {test && <span className="hint">{test}</span>}
      </div>

      <label htmlFor="fallback">Quando não houver LibreTranslate</label>
      <select id="fallback" value={s.translationFallback} onChange={(e) => update('translationFallback', e.target.value as Settings['translationFallback'])}>
        <option value="local">Tradução no aparelho (opus-mt, ~{LOCAL_MT_DOWNLOAD_MB} MB uma vez)</option>
        <option value="google">Google Tradutor (endpoint público não oficial; envia o texto)</option>
        <option value="none">Nenhuma (só inglês)</option>
      </select>
      <p className="hint">A Translator API do Chrome é usada automaticamente quando existir (Chrome Android recente).</p>

      <label htmlFor="model">Modelo de transcrição</label>
      <select id="model" value={s.sttModel} onChange={(e) => update('sttModel', e.target.value as SttModelId)}>
        {STT_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} (~{m.downloadMb.wasm}–{m.downloadMb.webgpu} MB)
          </option>
        ))}
      </select>
      <p className="hint">No celular prefira o tiny: os outros ficam lentos sem GPU. Vale na próxima captura.</p>

      <label htmlFor="split">Separação de frases</label>
      <select id="split" value={s.sentenceSplit} onChange={(e) => update('sentenceSplit', e.target.value as VadProfile)}>
        {(Object.keys(VAD_PROFILES) as VadProfile[]).map((id) => (
          <option key={id} value={id}>
            {VAD_PROFILES[id].label}{id === 'normal' ? ' (padrão)' : ''}: pausa {VAD_PROFILES[id].silenceMs} ms, até {VAD_PROFILES[id].maxSegmentMs / 1000} s
          </option>
        ))}
      </select>
      <p className="hint">{VAD_PROFILES[s.sentenceSplit].description} Vale na próxima captura.</p>

      <label htmlFor="mic">Microfone</label>
      <select id="mic" value={s.micDeviceId} onChange={(e) => update('micDeviceId', e.target.value)}>
        <option value="">Automático: microfone do aparelho (mesmo com fone conectado)</option>
        {mics.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
            {d.isHeadset ? ' (fone)' : ''}
          </option>
        ))}
      </select>
      <p className="hint">Com fone Bluetooth ou com fio conectado, o app continua ouvindo pelo microfone do aparelho, que fica perto do som. A lista completa aparece depois da primeira captura (permissão).</p>

      <label htmlFor="glossary">Nomes e termos do vídeo (contexto)</label>
      <textarea id="glossary" rows={3} value={s.glossary} onChange={(e) => update('glossary', e.target.value)} placeholder={'House, Cuddy, Wilson'} style={{ width: '100%', font: 'inherit' }} />
      <p className="hint">Um por linha ou separados por vírgula. Ficam sem traduzir ("House" não vira "casa") e corrigem a transcrição quando o modelo erra o nome. No celular não há título de aba, então aqui é manual.</p>

      <label htmlFor="fontSize">Tamanho da fonte: {s.fontSize}px</label>
      <input id="fontSize" type="range" min={12} max={32} value={s.fontSize} onChange={(e) => update('fontSize', Number(e.target.value))} />

      <div className="actions">
        <button className="primary" onClick={() => onSave({ ...s, libreUrl: s.libreUrl.trim(), libreApiKey: s.libreApiKey.trim() })}>
          Salvar
        </button>
        <button onClick={onClose}>Cancelar</button>
      </div>
    </div>
  );
}
