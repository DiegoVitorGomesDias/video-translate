// Controle automático de ganho antes do detector de fala e do STT.
//
// Falas baixas (sussurros, pensamentos em off, diálogo ao fundo de música) ficam abaixo
// do limiar do Silero VAD e, mesmo quando passam, chegam fracas ao Whisper. O AGC
// acompanha o pico recente do sinal e amplifica até um alvo, com ganho máximo limitado
// para não transformar o ruído de fundo em "fala". O ganho muda devagar (sem bombeio).
//
// `normalizePeak` é a normalização por trecho, aplicada ao áudio que vai para o STT.

export interface AgcOptions {
  /** Pico que o AGC tenta manter (amplitude, 0 a 1). */
  target?: number;
  /** Ganho máximo aplicado. */
  maxGain?: number;
  /** Tempo (s) para o envelope de pico cair pela metade quando o som baixa. */
  releaseSeconds?: number;
  sampleRate?: number;
}

export class Agc {
  private readonly target: number;
  private readonly maxGain: number;
  private readonly decayPerSample: number;
  private envelope: number;
  private gain = 1;

  constructor(opts: AgcOptions = {}) {
    this.target = opts.target ?? 0.5;
    this.maxGain = opts.maxGain ?? 4;
    const sr = opts.sampleRate ?? 16000;
    const release = opts.releaseSeconds ?? 2;
    this.decayPerSample = Math.pow(0.5, 1 / (release * sr));
    this.envelope = this.target; // começa com ganho 1
  }

  /** Ganho aplicado ao último bloco. */
  get currentGain(): number {
    return this.gain;
  }

  /** Amplifica o bloco no lugar e o devolve. */
  process(block: Float32Array): Float32Array {
    let peak = 0;
    for (let i = 0; i < block.length; i++) {
      const a = Math.abs(block[i]!);
      if (a > peak) peak = a;
    }
    // Envelope: sobe na hora, desce devagar.
    this.envelope = Math.max(peak, this.envelope * Math.pow(this.decayPerSample, block.length));
    const wanted = Math.min(this.maxGain, Math.max(1, this.target / Math.max(this.envelope, 1e-4)));
    // Suaviza a mudança de ganho: desce rápido (som alto chegou), sobe devagar.
    this.gain = wanted < this.gain ? wanted : this.gain * 0.8 + wanted * 0.2;
    if (this.gain > 1.001) {
      for (let i = 0; i < block.length; i++) {
        const v = block[i]! * this.gain;
        block[i] = v > 1 ? 1 : v < -1 ? -1 : v;
      }
    }
    return block;
  }
}

/** Normaliza o trecho para o pico alvo quando está baixo (ganho entre 1 e maxGain). */
export function normalizePeak(audio: Float32Array, target = 0.9, maxGain = 8): Float32Array {
  let peak = 0;
  for (let i = 0; i < audio.length; i++) {
    const a = Math.abs(audio[i]!);
    if (a > peak) peak = a;
  }
  if (peak <= 0 || peak >= target) return audio;
  const gain = Math.min(maxGain, target / peak);
  if (gain <= 1.001) return audio;
  const out = new Float32Array(audio.length);
  for (let i = 0; i < audio.length; i++) out[i] = audio[i]! * gain;
  return out;
}
