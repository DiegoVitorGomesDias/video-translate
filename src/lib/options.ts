// Configurações do usuário, guardadas em chrome.storage.local.

import type { DisplayMode, SttModelId } from './messages';
import { DEFAULT_STT_MODEL } from './stt/models';

export interface Options {
  /** URL base da instância do LibreTranslate (vazio desativa). */
  libreUrl: string;
  libreApiKey: string;
  sttModel: SttModelId;
  /** Último recurso quando LibreTranslate e Chrome falham. */
  translationFallback: 'local' | 'google' | 'none';
  /** Tamanho da fonte das legendas, em px. */
  fontSize: number;
  /** Painel lateral na própria página (padrão) ou janela separada. */
  displayMode: DisplayMode;
}

export const DEFAULT_OPTIONS: Options = {
  libreUrl: 'http://localhost:5000',
  libreApiKey: '',
  sttModel: DEFAULT_STT_MODEL,
  translationFallback: 'local',
  fontSize: 18,
  displayMode: 'drawer',
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
