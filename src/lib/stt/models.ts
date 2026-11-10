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
  /** Download aproximado em MB (WebGPU / WASM). */
  downloadMb: { webgpu: number; wasm: number };
  candidates: SttModelCandidate[];
}

export const STT_MODELS: SttModelInfo[] = [
  {
    id: 'auto',
    label: 'Automático (padrão)',
    description: 'Moonshine base na GPU (WebGPU) quando houver; sem GPU usa o Moonshine tiny na CPU para manter a latência baixa.',
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
    downloadMb: { webgpu: 110, wasm: 28 },
    candidates: [
      { modelId: 'onnx-community/moonshine-tiny-ONNX', device: 'webgpu', dtype: 'fp32' },
      { modelId: 'onnx-community/moonshine-tiny-ONNX', device: 'wasm', dtype: 'q8' },
    ],
  },
  {
    id: 'moonshine-base',
    label: 'Moonshine base (mais preciso)',
    description: 'Cerca de 2 a 3 vezes mais lento que o tiny, melhor com ruído e sotaques. Download maior.',
    downloadMb: { webgpu: 155, wasm: 63 },
    candidates: [
      { modelId: 'onnx-community/moonshine-base-ONNX', device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } },
      { modelId: 'onnx-community/moonshine-base-ONNX', device: 'wasm', dtype: 'q8' },
    ],
  },
  {
    id: 'whisper-base.en',
    label: 'Whisper base (inglês)',
    description: 'Alternativa mais robusta a música e diálogo sobreposto; pontuação boa. O mais lento dos três (processa 30 s por janela).',
    downloadMb: { webgpu: 207, wasm: 77 },
    candidates: [
      { modelId: 'onnx-community/whisper-base.en', device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } },
      { modelId: 'onnx-community/whisper-base.en', device: 'wasm', dtype: 'q8' },
    ],
  },
  {
    id: 'whisper-large-v3-turbo',
    label: 'Whisper large-v3-turbo (máxima qualidade)',
    description:
      'O melhor em sotaques, música e diálogo sobreposto. Só com WebGPU e placa com memória de sobra (~1,5 GB usados); download de ~570 MB (GPU com f16) ou ~760 MB. Sem GPU cai para o Moonshine tiny.',
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
