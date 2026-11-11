// Provedor LibreTranslate: POST {url}/translate.
// Documentação: https://github.com/LibreTranslate/LibreTranslate#api

import { TranslationError, type TranslationProvider } from './TranslationProvider';
import { toBrazilian } from './ptbr';

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
  /** Alvo efetivo por idioma pedido: "pt" vira "pt-BR" quando a instância oferece (o "pt" do Argos é europeu). */
  private readonly targets = new Map<string, Promise<string>>();

  constructor(opts: LibreTranslateOptions) {
    this.base = opts.url.replace(/\/+$/, '');
    this.apiKey = opts.apiKey ?? '';
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  async translate(text: string, from: string, to: string): Promise<string> {
    const target = await this.resolveTarget(from, to);
    const body: Record<string, string> = { q: text, source: from, target, format: 'text' };
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
    // O modelo "pt" do Argos sai em português europeu; só pt-BR nativo dispensa o ajuste.
    return target === 'pt-BR' || !to.startsWith('pt') ? data.translatedText : toBrazilian(data.translatedText);
  }

  /** "pt" → "pt-BR" se a instância tiver o modelo brasileiro; senão o próprio código. */
  private resolveTarget(from: string, to: string): Promise<string> {
    if (to !== 'pt') return Promise.resolve(to);
    let cached = this.targets.get(from);
    if (!cached) {
      cached = (async () => {
        try {
          const res = await this.fetch('/languages', { method: 'GET' });
          const langs = (await res.json()) as { code: string; targets?: string[] }[];
          const src = langs.find((l) => l.code === from);
          return src?.targets?.includes('pt-BR') ? 'pt-BR' : to;
        } catch {
          return to;
        }
      })();
      this.targets.set(from, cached);
    }
    return cached;
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
