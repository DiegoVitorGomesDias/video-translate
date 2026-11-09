// Provedor LibreTranslate: POST {url}/translate.
// Documentação: https://github.com/LibreTranslate/LibreTranslate#api

import { TranslationError, type TranslationProvider } from './TranslationProvider';

export interface LibreTranslateOptions {
  url: string;
  apiKey?: string;
  timeoutMs?: number;
}

export class LibreTranslateProvider implements TranslationProvider {
  readonly name = 'LibreTranslate';
  private readonly base: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(opts: LibreTranslateOptions) {
    this.base = opts.url.replace(/\/+$/, '');
    this.apiKey = opts.apiKey ?? '';
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  async translate(text: string, from: string, to: string): Promise<string> {
    const body: Record<string, string> = { q: text, source: from, target: to, format: 'text' };
    if (this.apiKey) body.api_key = this.apiKey;
    const res = await this.fetch('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { translatedText?: string; error?: string };
    if (!res.ok || typeof data.translatedText !== 'string') {
      throw new TranslationError(data.error ?? `HTTP ${res.status}`, this.name);
    }
    return data.translatedText;
  }

  /** Verifica se a instância responde e suporta o par de idiomas. */
  async healthCheck(from = 'en', to = 'pt'): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const res = await this.fetch('/languages', { method: 'GET' });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const langs = (await res.json()) as { code: string; targets?: string[] }[];
      const src = langs.find((l) => l.code === from);
      if (!src) return { ok: false, error: `idioma "${from}" não disponível na instância` };
      if (src.targets && !src.targets.includes(to)) return { ok: false, error: `tradução ${from}→${to} não disponível` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await fetch(this.base + path, { ...init, signal: ctrl.signal });
    } catch (err) {
      const msg = ctrl.signal.aborted ? `tempo esgotado (${this.timeoutMs} ms)` : err instanceof Error ? err.message : String(err);
      throw new TranslationError(msg, this.name, err);
    } finally {
      clearTimeout(timer);
    }
  }
}
