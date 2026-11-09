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

/** Variantes de código que o Chrome pode aceitar para cada idioma pedido. */
const LANGUAGE_VARIANTS: Record<string, string[]> = {
  pt: ['pt', 'pt-BR', 'pt-PT'],
  en: ['en', 'en-US'],
};

function variantsOf(lang: string): string[] {
  return LANGUAGE_VARIANTS[lang] ?? [lang];
}

function getTranslatorApi(): TranslatorStatic | null {
  const api = (globalThis as { Translator?: TranslatorStatic }).Translator;
  return api && typeof api.create === 'function' ? api : null;
}

export function isChromeTranslatorSupported(): boolean {
  return getTranslatorApi() !== null;
}

export interface ChromeLanguagePair {
  source: string;
  target: string;
  availability: ChromeTranslatorAvailability;
}

/**
 * Consulta a disponibilidade de todas as variantes do par e devolve a melhor
 * ('available' > 'downloading' > 'downloadable'), ou null se nenhuma servir.
 */
export async function chromeTranslatorBestPair(from = 'en', to = 'pt'): Promise<ChromeLanguagePair | null> {
  const api = getTranslatorApi();
  if (!api) return null;
  const rank: Record<ChromeTranslatorAvailability, number> = { available: 3, downloading: 2, downloadable: 1, unavailable: 0 };
  let best: ChromeLanguagePair | null = null;
  for (const source of variantsOf(from)) {
    for (const target of variantsOf(to)) {
      try {
        const availability = await api.availability({ sourceLanguage: source, targetLanguage: target });
        if (availability !== 'unavailable' && (!best || rank[availability] > rank[best.availability])) {
          best = { source, target, availability };
        }
      } catch {
        /* variante inválida */
      }
    }
  }
  return best;
}

export async function chromeTranslatorAvailability(from = 'en', to = 'pt'): Promise<ChromeTranslatorAvailability> {
  return (await chromeTranslatorBestPair(from, to))?.availability ?? 'unavailable';
}

export class ChromeTranslatorProvider implements TranslationProvider {
  readonly name = 'Chrome';
  private instances = new Map<string, Promise<TranslatorInstance>>();

  /** Progresso do download do pacote de idioma (0 a 1), quando houver. */
  onDownloadProgress: ((loaded: number) => void) | null = null;

  /** Último erro de criação (para diagnóstico na UI). */
  lastError: string | null = null;

  /**
   * Cria o tradutor para o par de idiomas, tentando as variantes de código. Se o
   * pacote ainda precisa ser baixado, o Chrome pode exigir um gesto do usuário.
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
      p = this.createAny(from, to).catch((err) => {
        this.instances.delete(key);
        throw err;
      });
      this.instances.set(key, p);
    }
    return p;
  }

  private async createAny(from: string, to: string): Promise<TranslatorInstance> {
    const api = getTranslatorApi();
    if (!api) throw new TranslationError('Translator API indisponível neste Chrome', this.name);
    const errors: string[] = [];
    for (const source of variantsOf(from)) {
      for (const target of variantsOf(to)) {
        try {
          const inst = await api.create({
            sourceLanguage: source,
            targetLanguage: target,
            monitor: (m) => {
              m.addEventListener('downloadprogress', (e) => {
                const loaded = (e as { loaded?: number }).loaded;
                if (typeof loaded === 'number') this.onDownloadProgress?.(loaded);
              });
            },
          });
          this.lastError = null;
          return inst;
        } catch (err) {
          const name = err instanceof Error ? err.name : 'Error';
          errors.push(`${source}→${target}: ${name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    this.lastError = errors.join(' | ');
    throw new TranslationError(this.lastError, this.name);
  }
}
