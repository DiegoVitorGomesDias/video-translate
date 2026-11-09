// Provedor com a Translator API nativa do Chrome (138+), que roda local e sem chave.
// Documentação: https://developer.chrome.com/docs/ai/translator-api

import { TranslationError, type TranslationProvider } from './TranslationProvider';

export type ChromeTranslatorAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface TranslatorInstance {
  translate(text: string): Promise<string>;
  destroy?(): void;
}

interface TranslatorStatic {
  availability(opts: { sourceLanguage: string; targetLanguage: string }): Promise<ChromeTranslatorAvailability>;
  create(opts: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: EventTarget) => void;
  }): Promise<TranslatorInstance>;
}

function getTranslatorApi(): TranslatorStatic | null {
  const api = (globalThis as { Translator?: TranslatorStatic }).Translator;
  return api && typeof api.create === 'function' ? api : null;
}

export function isChromeTranslatorSupported(): boolean {
  return getTranslatorApi() !== null;
}

export async function chromeTranslatorAvailability(from = 'en', to = 'pt'): Promise<ChromeTranslatorAvailability> {
  const api = getTranslatorApi();
  if (!api) return 'unavailable';
  try {
    return await api.availability({ sourceLanguage: from, targetLanguage: to });
  } catch {
    return 'unavailable';
  }
}

export class ChromeTranslatorProvider implements TranslationProvider {
  readonly name = 'Chrome';
  private instances = new Map<string, Promise<TranslatorInstance>>();

  /** Progresso do download do pacote de idioma (0 a 1), quando houver. */
  onDownloadProgress: ((loaded: number) => void) | null = null;

  /**
   * Cria o tradutor para o par de idiomas. Se o pacote ainda precisa ser baixado, o
   * Chrome pode exigir que isso aconteça a partir de um gesto do usuário (clique).
   */
  async prepare(from = 'en', to = 'pt'): Promise<void> {
    await this.get(from, to);
  }

  async translate(text: string, from: string, to: string): Promise<string> {
    const t = await this.get(from, to);
    try {
      return await t.translate(text);
    } catch (err) {
      throw new TranslationError(err instanceof Error ? err.message : String(err), this.name, err);
    }
  }

  dispose(): void {
    for (const p of this.instances.values()) void p.then((t) => t.destroy?.()).catch(() => undefined);
    this.instances.clear();
  }

  private get(from: string, to: string): Promise<TranslatorInstance> {
    const key = `${from}>${to}`;
    let p = this.instances.get(key);
    if (!p) {
      const api = getTranslatorApi();
      if (!api) return Promise.reject(new TranslationError('Translator API indisponível neste Chrome', this.name));
      p = api
        .create({
          sourceLanguage: from,
          targetLanguage: to,
          monitor: (m) => {
            m.addEventListener('downloadprogress', (e) => {
              const loaded = (e as { loaded?: number }).loaded;
              if (typeof loaded === 'number') this.onDownloadProgress?.(loaded);
            });
          },
        })
        .catch((err) => {
          this.instances.delete(key);
          throw new TranslationError(err instanceof Error ? err.message : String(err), this.name, err);
        });
      this.instances.set(key, p);
    }
    return p;
  }
}
