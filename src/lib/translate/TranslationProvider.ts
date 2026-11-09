export interface TranslationProvider {
  /** Nome curto para mostrar na UI (ex.: "LibreTranslate", "Chrome"). */
  readonly name: string;
  translate(text: string, from: string, to: string): Promise<string>;
  /** Libera recursos (opcional). */
  dispose?(): void;
}

export class TranslationError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}

/** Envolve um provedor com cache em memória por texto. */
export class CachedTranslationProvider implements TranslationProvider {
  private readonly cache = new Map<string, Promise<string>>();

  constructor(private readonly inner: TranslationProvider) {}

  get name(): string {
    return this.inner.name;
  }

  translate(text: string, from: string, to: string): Promise<string> {
    const key = `${from}>${to}:${text}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.inner.translate(text, from, to).catch((err) => {
        this.cache.delete(key); // não guarda falhas
        throw err;
      });
      this.cache.set(key, p);
    }
    return p;
  }

  dispose(): void {
    this.inner.dispose?.();
    this.cache.clear();
  }
}
