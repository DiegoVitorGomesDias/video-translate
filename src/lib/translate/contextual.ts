// Envolve um provedor de tradução para manter os termos do glossário (nomes do vídeo)
// sem traduzir: "House is late." → "701 is late." → "701 está atrasado." → "House está atrasado."

import { protectTerms } from '@/lib/context';
import type { TranslationProvider } from './TranslationProvider';

export class ContextualTranslationProvider implements TranslationProvider {
  constructor(
    private readonly inner: TranslationProvider,
    /** Termos atuais, do maior para o menor (lidos a cada frase, podem mudar durante a captura). */
    private readonly getTerms: () => string[],
  ) {}

  get name(): string {
    return this.inner.name;
  }

  async translate(text: string, from: string, to: string): Promise<string> {
    const terms = this.getTerms();
    const plan = terms.length ? protectTerms(text, terms) : null;
    if (!plan || plan.hits.length === 0) return this.inner.translate(text, from, to);
    const translated = await this.inner.translate(plan.text, from, to);
    const restored = plan.restore(translated);
    if (restored !== null) return restored;
    console.warn(`[translate] marcadores de contexto perdidos em "${translated}"; traduzindo sem proteção`);
    return this.inner.translate(text, from, to);
  }

  dispose(): void {
    this.inner.dispose?.();
  }
}
