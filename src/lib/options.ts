// Configurações do usuário, guardadas em chrome.storage.local.

import type { DisplayMode, SttEngineId, SttModelId, VadProfileId } from './messages';
import { DEFAULT_STT_MODEL } from './stt/models';

export interface Options {
  /** URL base da instância do LibreTranslate (vazio desativa). */
  libreUrl: string;
  libreApiKey: string;
  sttModel: SttModelId;
  /** Modelo local (transformers.js), reconhecimento nativo do Chrome ou servidor local (Docker). */
  sttEngine: SttEngineId;
  /** Servidor local de transcrição (whisper.cpp em /inference ou API compatível com OpenAI). */
  sttServerUrl: string;
  sttServerFormat: 'whispercpp' | 'openai';
  sttServerModel: string;
  sttServerApiKey: string;
  /** Separação de frases: pausa e duração máxima do trecho (ver VAD_PROFILES). */
  sentenceSplit: VadProfileId;
  /** Último recurso quando LibreTranslate e Chrome falham. */
  translationFallback: 'local' | 'google' | 'none';
  /** Tamanho da fonte das legendas, em px. */
  fontSize: number;
  /** Painel lateral na própria página (padrão) ou janela separada. */
  displayMode: DisplayMode;
  /** Tirar nomes do título da aba para usar como contexto (tradução e transcrição). */
  useTabContext: boolean;
  /** Glossário fixo do usuário: nomes/termos a manter, um por linha (ou separados por vírgula). */
  glossary: string;
}

export const DEFAULT_OPTIONS: Options = {
  libreUrl: 'http://localhost:5000',
  libreApiKey: '',
  sttModel: DEFAULT_STT_MODEL,
  sttEngine: 'local',
  sttServerUrl: 'http://localhost:8080',
  sttServerFormat: 'whispercpp',
  sttServerModel: 'whisper-1',
  sttServerApiKey: '',
  sentenceSplit: 'normal',
  translationFallback: 'local',
  fontSize: 18,
  displayMode: 'drawer',
  useTabContext: true,
  glossary: '',
};

export const OPTIONS_KEY = 'options';

export async function loadOptions(): Promise<Options> {
  const data = await browser.storage.local.get(OPTIONS_KEY);
  const saved = (data[OPTIONS_KEY] as Partial<Options> | undefined) ?? {};
  return { ...DEFAULT_OPTIONS, ...saved };
}

export async function saveOptions(options: Options): Promise<void> {
  await browser.storage.local.set({ [OPTIONS_KEY]: options });
}

/** Chama `cb` com as opções atuais e de novo a cada mudança. Devolve função para cancelar. */
export function watchOptions(cb: (options: Options) => void): () => void {
  void loadOptions().then(cb);
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && changes[OPTIONS_KEY]) {
      cb({ ...DEFAULT_OPTIONS, ...((changes[OPTIONS_KEY].newValue as Partial<Options> | undefined) ?? {}) });
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** Origem (com /* no fim) para pedir permissão de host para a URL do LibreTranslate. */
export function originPattern(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.origin}/*`;
  } catch {
    return null;
  }
}
