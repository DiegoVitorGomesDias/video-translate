// Escolhe o provedor de tradução: LibreTranslate se houver URL configurada e a
// instância responder; senão a Translator API do Chrome. Expõe qual está ativo.

import { CachedTranslationProvider, type TranslationProvider } from './TranslationProvider';
import { LibreTranslateProvider } from './libretranslate';
import { ChromeTranslatorProvider, chromeTranslatorAvailability, type ChromeTranslatorAvailability } from './chrome-translator';

export type { TranslationProvider } from './TranslationProvider';
export { TranslationError } from './TranslationProvider';
export { LibreTranslateProvider } from './libretranslate';
export { ChromeTranslatorProvider, chromeTranslatorAvailability, isChromeTranslatorSupported } from './chrome-translator';

export interface TranslatorSelection {
  /** null quando nenhum provedor está disponível. */
  provider: TranslationProvider | null;
  kind: 'libretranslate' | 'chrome' | 'none';
  /** Motivo de o LibreTranslate não ter sido escolhido (para mostrar na UI). */
  libreError?: string;
  /** Estado do pacote de idioma do Chrome, quando o Chrome é o escolhido ou o único possível. */
  chromeAvailability?: ChromeTranslatorAvailability;
  /** Instância crua do Chrome (para preparar o download a partir de um clique). */
  chrome?: ChromeTranslatorProvider;
}

export interface CreateTranslatorOptions {
  libreUrl?: string;
  libreApiKey?: string;
  from?: string;
  to?: string;
}

export async function createTranslator(opts: CreateTranslatorOptions): Promise<TranslatorSelection> {
  const from = opts.from ?? 'en';
  const to = opts.to ?? 'pt';
  let libreError: string | undefined;

  const url = opts.libreUrl?.trim();
  if (url) {
    const libre = new LibreTranslateProvider({ url, apiKey: opts.libreApiKey });
    const health = await libre.healthCheck(from, to);
    if (health.ok) {
      return { provider: new CachedTranslationProvider(libre), kind: 'libretranslate' };
    }
    libreError = health.error;
  }

  const chromeAvailability = await chromeTranslatorAvailability(from, to);
  if (chromeAvailability !== 'unavailable') {
    const chrome = new ChromeTranslatorProvider();
    return { provider: new CachedTranslationProvider(chrome), kind: 'chrome', libreError, chromeAvailability, chrome };
  }

  return { provider: null, kind: 'none', libreError, chromeAvailability };
}
