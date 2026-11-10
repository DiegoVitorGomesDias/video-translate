// Configurações do PWA em localStorage (equivalente ao chrome.storage.local da extensão).
import type { SttModelId, VadProfileId } from '@/lib/messages';
import { DEFAULT_STT_MODEL, STT_MODELS } from '@/lib/stt/models';

export interface Settings {
  libreUrl: string;
  libreApiKey: string;
  sttModel: SttModelId;
  sentenceSplit: VadProfileId;
  translationFallback: 'local' | 'google' | 'none';
  fontSize: number;
  /** deviceId do microfone; '' = automático (prefere o microfone do próprio aparelho). */
  micDeviceId: string;
  /** Nomes/termos do vídeo a manter na tradução e corrigir na transcrição (um por linha). */
  glossary: string;
}

export const DEFAULT_SETTINGS: Settings = {
  libreUrl: '',
  libreApiKey: '',
  sttModel: DEFAULT_STT_MODEL,
  sentenceSplit: 'normal',
  translationFallback: 'local',
  fontSize: 18,
  micDeviceId: '',
  glossary: '',
};

const KEY = 'videoTranslate.settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return sanitize(raw ? (JSON.parse(raw) as Partial<Settings>) : {});
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* modo privado etc. */
  }
}

/** Aceita só campos conhecidos e valores válidos (usado também na importação via URL). */
export function sanitize(input: Partial<Settings> | Record<string, unknown>): Settings {
  const s = input as Partial<Settings>;
  const modelOk = STT_MODELS.some((m) => m.id === s.sttModel);
  const fallbackOk = s.translationFallback === 'local' || s.translationFallback === 'google' || s.translationFallback === 'none';
  const font = Number(s.fontSize);
  return {
    libreUrl: typeof s.libreUrl === 'string' && /^https?:\/\//.test(s.libreUrl) ? s.libreUrl : '',
    libreApiKey: typeof s.libreApiKey === 'string' ? s.libreApiKey : '',
    sttModel: modelOk ? (s.sttModel as SttModelId) : DEFAULT_STT_MODEL,
    sentenceSplit: s.sentenceSplit === 'fast' || s.sentenceSplit === 'long' ? s.sentenceSplit : 'normal',
    translationFallback: fallbackOk ? s.translationFallback! : 'local',
    fontSize: Number.isFinite(font) && font >= 12 && font <= 32 ? font : 18,
    micDeviceId: typeof s.micDeviceId === 'string' ? s.micDeviceId : '',
    glossary: typeof s.glossary === 'string' ? s.glossary.slice(0, 2000) : '',
  };
}

// ---- Importação a partir da URL (gerada pela extensão: #import=<base64url do JSON>) ----

export const IMPORT_HASH_KEY = 'import';

export function encodeSettingsForUrl(s: Partial<Settings>): string {
  const json = JSON.stringify(s);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function readImportFromHash(hash: string = location.hash): Settings | null {
  const m = /[#&]import=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) return null;
  try {
    const b64 = m[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(b64)));
    return sanitize(JSON.parse(json) as Record<string, unknown>);
  } catch {
    return null;
  }
}
