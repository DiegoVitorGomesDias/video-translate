// Catálogo dos modelos de transcrição oferecidos na tela de opções.
// Tamanhos aproximados dos arquivos ONNX baixados do Hugging Face (nov/2026).

import type { SttModelId } from '@/lib/messages';

export type SttDevice = 'webgpu' | 'wasm';

export interface SttModelCandidate {
  modelId: string;
  device: SttDevice;
  dtype?: string | Record<string, string>;
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
    id: 'moonshine-tiny',
    label: 'Moonshine tiny (padrão, mais rápido)',
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
];

export const DEFAULT_STT_MODEL: SttModelId = 'moonshine-tiny';

export function getModelInfo(id: SttModelId): SttModelInfo {
  return STT_MODELS.find((m) => m.id === id) ?? STT_MODELS[0]!;
}

/** Ordem de tentativa: o modelo escolhido (WebGPU, depois WASM) e o tiny como reserva. */
export function candidatesFor(id: SttModelId): SttModelCandidate[] {
  const chosen = getModelInfo(id);
  const fallback = getModelInfo(DEFAULT_STT_MODEL);
  return chosen.id === fallback.id ? [...chosen.candidates] : [...chosen.candidates, ...fallback.candidates];
}
