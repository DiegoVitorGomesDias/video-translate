// Escolhe o provedor de tradução, nesta ordem:
//   1. LibreTranslate, se houver URL configurada e a instância responder;
//   2. Translator API do Chrome, se o pacote de idioma já estiver instalado e o tradutor
//      for criado com sucesso;
//   3. último recurso escolhido nas opções: tradução local no navegador (opus-mt) ou
//      Google Tradutor (endpoint não oficial), ou nenhum.
// Expõe qual ficou ativo e os motivos dos que falharam, para a UI mostrar.

import { CachedTranslationProvider, type TranslationProvider } from './TranslationProvider';
import { LibreTranslateProvider } from './libretranslate';
import { ChromeTranslatorProvider, chromeTranslatorBestPair, type ChromeTranslatorAvailability } from './chrome-translator';
import { GoogleFreeProvider } from './google-free';
import { LocalOpusProvider } from './local-opus';

export type { TranslationProvider } from './TranslationProvider';
export { TranslationError } from './TranslationProvider';
export { LibreTranslateProvider } from './libretranslate';
export {
  ChromeTranslatorProvider,
  chromeTranslatorAvailability,
  chromeTranslatorBestPair,
  isChromeTranslatorSupported,
  type ChromeTranslatorAvailability,
} from './chrome-translator';
export { GoogleFreeProvider } from './google-free';
export { LocalOpusProvider, LOCAL_MT_DOWNLOAD_MB, OPUS_MT_EN_ROMANCE, type LocalOpusStatus } from './local-opus';

export type TranslatorKind = 'libretranslate' | 'chrome' | 'local' | 'google-free' | 'none';
export type FallbackChoice = 'local' | 'google' | 'none';

export interface TranslatorSelection {
  /** null quando nenhum provedor está disponível. */
  provider: TranslationProvider | null;
  kind: TranslatorKind;
  /** Motivo de o LibreTranslate não ter sido escolhido. */
  libreError?: string;
  /** Estado do pacote de idioma do Chrome ('unavailable' quando a API não existe). */
  chromeAvailability: ChromeTranslatorAvailability;
  /** Motivo de o Chrome não ter sido escolhido (ex.: erro de create). */
  chromeError?: string;
  /** Instância do Chrome para disparar o download a partir de um clique, quando 'downloadable'. */
  chrome?: ChromeTranslatorProvider;
  /** Instância do tradutor local (para acompanhar o download). */
  local?: LocalOpusProvider;
}

export interface CreateTranslatorOptions {
  libreUrl?: string;
  libreApiKey?: string;
  fallback?: FallbackChoice;
  /** Necessário para o tradutor local (URLs do runtime ONNX). */
  resolveUrl?: (path: string) => string;
  from?: string;
  to?: string;
}

export async function createTranslator(opts: CreateTranslatorOptions): Promise<TranslatorSelection> {
  const from = opts.from ?? 'en';
  const to = opts.to ?? 'pt';
  let libreError: string | undefined;
  let chromeError: string | undefined;

  const url = opts.libreUrl?.trim();
  if (url) {
    const libre = new LibreTranslateProvider({ url, apiKey: opts.libreApiKey });
    const health = await libre.healthCheck(from, to);
    if (health.ok) {
      return { provider: new CachedTranslationProvider(libre), kind: 'libretranslate', chromeAvailability: 'unavailable' };
    }
    libreError = health.error;
  }

  // Diagnóstico do Chrome no console (versão, API, disponibilidade por variante).
  const hasApi = 'Translator' in globalThis;
  const pair = await chromeTranslatorBestPair(from, to);
  console.log(`[translate] ${navigator.userAgent} | Translator API: ${hasApi ? 'presente' : 'ausente'} | melhor par: ${pair ? `${pair.source}→${pair.target} (${pair.availability})` : 'nenhum'}`);
  const chromeAvailability = pair?.availability ?? 'unavailable';
  const chrome = pair ? new ChromeTranslatorProvider() : undefined;
  if (chrome && pair && pair.availability === 'available') {
    try {
      await chrome.prepare(pair.source, pair.target);
      const provider = new CachedTranslationProvider({
        name: chrome.name,
        translate: (text) => chrome.translate(text, pair.source, pair.target),
        dispose: () => chrome.dispose(),
      });
      return { provider, kind: 'chrome', libreError, chromeAvailability, chrome };
    } catch (err) {
      chromeError = err instanceof Error ? err.message : String(err);
    }
  } else if (pair) {
    chromeError = `pacote ${pair.source}→${pair.target} ainda não baixado (${pair.availability})`;
  } else {
    chromeError = hasApi ? `Translator API presente, mas sem suporte a ${from}→${to} neste navegador` : 'Translator API ausente (Chrome 138+ desktop)';
  }

  const fallback = opts.fallback ?? 'local';
  if (fallback === 'local' && opts.resolveUrl) {
    const local = new LocalOpusProvider(opts.resolveUrl);
    return { provider: new CachedTranslationProvider(local), kind: 'local', libreError, chromeAvailability, chromeError, chrome, local };
  }
  if (fallback === 'google') {
    return { provider: new CachedTranslationProvider(new GoogleFreeProvider()), kind: 'google-free', libreError, chromeAvailability, chromeError, chrome };
  }
  return { provider: null, kind: 'none', libreError, chromeAvailability, chromeError, chrome };
}
