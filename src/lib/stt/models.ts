// Catálogo dos modelos de transcrição oferecidos na tela de opções.
// Tamanhos aproximados dos arquivos ONNX baixados do Hugging Face (nov/2026).

import type { SttModelId } from '@/lib/messages';

export type SttDevice = 'webgpu' | 'wasm';

export interface SttModelCandidate {
  modelId: string;
  device: SttDevice;
  dtype?: string | Record<string, string>;
  /** Modelo multilíngue (Whisper grande): fixa inglês na geração para não detectar idioma errado. */
  multilingual?: boolean;
  /** Pesos em f16: só em GPUs com o recurso WebGPU "shader-f16" (verificado antes do download). */
  requiresF16?: boolean;
}

export interface SttModelInfo {
  id: SttModelId;
  label: string;
  description: string;
  /** Tempo de resposta típico por trecho de fala de ~5 s, para a tela de opções. */
  latency: string;
  /** Aviso extra mostrado quando o modelo está selecionado. */
  warning?: string;
  /** Download aproximado em MB (WebGPU / WASM). */
  downloadMb: { webgpu: number; wasm: number };
  candidates: SttModelCandidate[];
}

export const STT_MODELS: SttModelInfo[] = [
  {
    id: 'auto',
    label: 'Automático (padrão)',
    description: 'Moonshine base na GPU (WebGPU) quando houver; sem GPU usa o Moonshine tiny na CPU para manter a latência baixa.',
    latency: 'menos de 1 s (GPU) ou 1 a 2 s (CPU)',
    downloadMb: { webgpu: 155, wasm: 28 },
    candidates: [
      { modelId: 'onnx-community/moonshine-base-ONNX', device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } },
      { modelId: 'onnx-community/moonshine-tiny-ONNX', device: 'wasm', dtype: 'q8' },
    ],
  },
  {
    id: 'moonshine-tiny',
    label: 'Moonshine tiny (mais rápido)',
    description: 'Inferência de ~0,1 s por segundo de áudio em WebGPU. Bom em fala limpa; sofre com música de fundo e várias vozes.',
    latency: '0,3 a 0,5 s (GPU), 1 a 2 s (CPU)',
    downloadMb: { webgpu: 110, wasm: 28 },
    candidates: [
      { modelId: 'onnx-community/moonshine-tiny-ONNX', device: 'webgpu', dtype: 'fp32' },
      { modelId: 'onnx-community/moonshine-tiny-ONNX', device: 'wasm', dtype: 'q8' },
    ],
  },
  {
    id: 'moonshine-base',
    label: 'Moonshine base (mais preciso)',
    description:
      'Cerca de 2 a 3 vezes mais lento que o tiny, melhor com ruído e sotaques. Vantagem sobre o Whisper base: processa só a duração real do trecho (sem janela fixa de 30 s), por isso responde mais rápido e mostra parciais enquanto a pessoa fala. Desvantagens: só inglês, sem suporte a prompt de contexto (o glossário é aplicado por fora), pontuação mais fraca e mais erros com música de fundo ou duas vozes.',
    latency: '0,5 a 1 s (GPU), 2 a 4 s (CPU)',
    downloadMb: { webgpu: 155, wasm: 63 },
    candidates: [
      { modelId: 'onnx-community/moonshine-base-ONNX', device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } },
      { modelId: 'onnx-community/moonshine-base-ONNX', device: 'wasm', dtype: 'q8' },
    ],
  },
  {
    id: 'whisper-base.en',
    label: 'Whisper base (inglês)',
    description:
      'Vantagens sobre o Moonshine base: mais robusto a música e diálogo sobreposto, pontuação e maiúsculas melhores, aceita o prompt de contexto (glossário + frases anteriores). Desvantagens: processa sempre uma janela fixa de 30 s mesmo para um trecho de 3 s, então cada resposta demora mais e os parciais são desligados quando ele passa de 1 s; vocabulário um pouco pior que o Moonshine base em fala limpa; pode "alucinar" texto em silêncio ou música.',
    latency: '1 a 3 s (GPU), 5 a 10 s (CPU)',
    downloadMb: { webgpu: 207, wasm: 77 },
    candidates: [
      { modelId: 'onnx-community/whisper-base.en', device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } },
      { modelId: 'onnx-community/whisper-base.en', device: 'wasm', dtype: 'q8' },
    ],
  },
  {
    id: 'whisper-small.en',
    label: 'Whisper small (inglês, equilíbrio)',
    description:
      'Meio-termo entre o Whisper base e o large-v3-turbo: bem melhor que o base em sotaques e ruído, 3 a 5 vezes mais rápido que o turbo. Pesos q4 na GPU; aceita prompt de contexto.',
    latency: '2 a 5 s (GPU), 10 a 20 s (CPU)',
    downloadMb: { webgpu: 300, wasm: 250 },
    candidates: [
      { modelId: 'onnx-community/whisper-small.en', device: 'webgpu', dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' } },
      { modelId: 'onnx-community/whisper-small.en', device: 'wasm', dtype: 'q8' },
    ],
  },
  {
    id: 'whisper-large-v3-turbo',
    label: 'Whisper large-v3-turbo (máxima qualidade)',
    description:
      'O melhor em sotaques, música e diálogo sobreposto. Só com WebGPU e placa com memória de sobra (~1,5 GB usados); download de ~570 MB (GPU com f16) ou ~760 MB. Sem GPU cai para o Moonshine tiny.',
    latency: '5 a 20 s por trecho em GPU sem f16 (pesos q4); 1 a 3 s em GPU com shader-f16',
    warning:
      'Lento no navegador: o encoder de 32 camadas processa uma janela de 30 s a cada trecho e, numa GPU sem shader-f16, usa pesos q4 convertidos para fp32. A legenda chega vários segundos depois da fala e os parciais ficam desligados. Para o mesmo modelo em 1 a 2 s por trecho, use o motor "Servidor local (Docker)" acima; para algo mais rápido só no navegador, o Whisper small.',
    downloadMb: { webgpu: 760, wasm: 28 },
    candidates: [
      { modelId: 'onnx-community/whisper-large-v3-turbo', device: 'webgpu', dtype: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' }, multilingual: true, requiresF16: true },
      { modelId: 'onnx-community/whisper-large-v3-turbo', device: 'webgpu', dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' }, multilingual: true },
    ],
  },
];

export const DEFAULT_STT_MODEL: SttModelId = 'auto';

export function getModelInfo(id: SttModelId): SttModelInfo {
  return STT_MODELS.find((m) => m.id === id) ?? STT_MODELS[0]!;
}

const RESERVE: SttModelId = 'moonshine-tiny';

/** Ordem de tentativa: o modelo escolhido (WebGPU, depois WASM) e o tiny como reserva. */
export function candidatesFor(id: SttModelId): SttModelCandidate[] {
  const chosen = getModelInfo(id);
  const reserve = getModelInfo(RESERVE);
  const list = [...chosen.candidates];
  for (const c of reserve.candidates) if (!list.some((x) => x.modelId === c.modelId && x.device === c.device)) list.push(c);
  return list;
}

/** Nome curto para mostrar na janela a partir do id do Hugging Face que de fato carregou. */
export function modelLabelFor(hfId: string | undefined, fallbackId: SttModelId): string {
  if (hfId) {
    const hit = STT_MODELS.find((m) => m.id !== 'auto' && m.candidates.some((c) => c.modelId === hfId));
    if (hit) return hit.label.replace(/\s*\(.*\)$/, '');
  }
  return getModelInfo(fallbackId).label.replace(/\s*\(.*\)$/, '');
}
