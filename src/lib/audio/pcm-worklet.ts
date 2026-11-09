// AudioWorkletProcessor: converte o áudio do contexto (normalmente 48 kHz, estéreo)
// em mono 16 kHz Float32 e envia blocos pelo port. Também repassa silêncio na saída,
// para poder ser ligado ao destination e garantir que process() seja chamado.
//
// Este arquivo roda no AudioWorkletGlobalScope: não há window, document nem chrome.*.

declare const sampleRate: number;
declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessorLike,
): void;

interface AudioWorkletProcessorLike {
  readonly port: MessagePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare class AudioWorkletProcessor implements AudioWorkletProcessorLike {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

export const PCM_WORKLET_NAME = 'pcm-downsampler';

interface PcmWorkletOptions {
  targetSampleRate?: number;
  /** Tamanho do bloco enviado pelo port, em amostras na taxa de destino. */
  blockSize?: number;
}

class PcmDownsamplerProcessor extends AudioWorkletProcessor {
  private readonly targetRate: number;
  private readonly ratio: number; // amostras de entrada por amostra de saída
  private readonly block: Float32Array;
  private blockFill = 0;
  // Posição fracionária (em amostras de entrada) da próxima amostra de saída.
  private phase = 0;
  // Última amostra do bloco anterior para interpolação contínua entre callbacks.
  private lastSample = 0;
  private hasLast = false;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    const opts = (options?.processorOptions ?? {}) as PcmWorkletOptions;
    this.targetRate = opts.targetSampleRate ?? 16000;
    this.ratio = sampleRate / this.targetRate;
    this.block = new Float32Array(opts.blockSize ?? 1024);
  }

  override process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0] ?? [];
    // Saída em silêncio (o som para o usuário vai direto da fonte ao destination).
    for (const out of outputs[0] ?? []) out.fill(0);

    const first = input[0];
    if (!first || first.length === 0) return true;

    const frames = first.length;
    const channels = input.length;

    // Mixagem para mono.
    const mono = new Float32Array(frames);
    for (const ch of input) {
      for (let i = 0; i < frames; i++) mono[i] = (mono[i] ?? 0) + (ch[i] ?? 0);
    }
    if (channels > 1) for (let i = 0; i < frames; i++) mono[i] = (mono[i] ?? 0) / channels;

    // Reamostragem por interpolação linear. phase é relativo ao início deste bloco,
    // podendo ser negativo em (-1, 0) quando a amostra anterior pertence ao bloco passado.
    let pos = this.phase;
    while (pos < frames) {
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const s0 = (i0 < 0 ? (this.hasLast ? this.lastSample : mono[0]) : mono[i0]) ?? 0;
      const s1 = (i0 + 1 < frames ? mono[i0 + 1] : mono[frames - 1]) ?? 0;
      this.block[this.blockFill++] = s0 + (s1 - s0) * frac;
      if (this.blockFill === this.block.length) this.flush();
      pos += this.ratio;
    }
    this.phase = pos - frames;
    this.lastSample = mono[frames - 1] ?? 0;
    this.hasLast = true;
    return true;
  }

  private flush(): void {
    const copy = this.block.slice(0, this.blockFill);
    this.port.postMessage(copy, [copy.buffer]);
    this.blockFill = 0;
  }
}

registerProcessor(PCM_WORKLET_NAME, PcmDownsamplerProcessor);
