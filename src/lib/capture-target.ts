// Escolha da aba a capturar quando o usuário clica em "Iniciar" num viewer já aberto.
// A fonte é a aba em que o usuário estava ao clicar, não a da captura anterior.

/** O que interessa de chrome.tabs.Tab para a escolha (sem a permissão "tabs", `url` vem vazio para abas sem activeTab). */
export interface TabLike {
  id?: number;
  url?: string;
}

/**
 * Uma aba pode ser capturada quando não sabemos sua URL (sem activeTab o Chrome a esconde,
 * mas a aba pode ser uma página normal) ou quando ela é http(s). Páginas da extensão e
 * internas do Chrome (URL conhecida que não é http) ficam de fora.
 */
export function isCapturablePage(tab: TabLike | undefined): tab is TabLike & { id: number } {
  if (!tab || tab.id === undefined) return false;
  if (tab.url === undefined || tab.url === '') return true;
  return /^https?:/.test(tab.url);
}

/**
 * Devolve a primeira aba capturável entre as candidatas, na ordem dada (a indicada pelo
 * viewer, a do próprio drawer, a ativa da janela normal em foco). Nunca cai para a aba da
 * captura anterior: era isso que deixava a extensão presa à aba antiga.
 */
export function chooseCaptureTab<T extends TabLike>(candidates: Array<T | undefined>): (T & { id: number }) | undefined {
  for (const t of candidates) if (isCapturablePage(t)) return t;
  return undefined;
}
