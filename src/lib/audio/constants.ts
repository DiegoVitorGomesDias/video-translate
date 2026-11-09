// Constantes compartilhadas entre o AudioWorklet e a página que o usa.
// Fica num arquivo separado para que importar o nome não puxe o código do processor
// (que só existe no AudioWorkletGlobalScope) para o bundle da página.
export const PCM_WORKLET_NAME = 'pcm-downsampler';
export const TARGET_SAMPLE_RATE = 16000;
