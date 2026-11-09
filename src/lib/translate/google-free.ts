// Último recurso: endpoint público não oficial do Google Tradutor (o mesmo usado pela
// extensão do Chrome). Sem chave e sem servidor próprio, mas sem garantia de
// disponibilidade e com limites de uso. Precisa de host_permissions para
// https://translate.googleapis.com/*.

import { TranslationError, type TranslationProvider } from './TranslationProvider';

export class GoogleFreeProvider implements TranslationProvider {
  readonly name = 'Google (não oficial)';
  private readonly timeoutMs: number;

  constructor(opts: { timeoutMs?: number } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  async translate(text: string, from: string, to: string): Promise<string> {
    const params = new URLSearchParams({ client: 'gtx', sl: from, tl: to, dt: 't', q: text });
    const url = `https://translate.googleapis.com/translate_a/single?${params.toString()}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new TranslationError(`HTTP ${res.status}`, this.name);
      const data = (await res.json()) as unknown;
      // Formato: [[["tradução", "original", ...], ...], ...]
      const segments = Array.isArray(data) && Array.isArray(data[0]) ? (data[0] as unknown[]) : null;
      if (!segments) throw new TranslationError('resposta inesperada', this.name);
      const out = segments
        .map((s) => (Array.isArray(s) && typeof s[0] === 'string' ? s[0] : ''))
        .join('')
        .trim();
      if (!out) throw new TranslationError('resposta vazia', this.name);
      return out;
    } catch (err) {
      if (err instanceof TranslationError) throw err;
      const msg = ctrl.signal.aborted ? `tempo esgotado (${this.timeoutMs} ms)` : err instanceof Error ? err.message : String(err);
      throw new TranslationError(msg, this.name, err);
    } finally {
      clearTimeout(timer);
    }
  }
}
