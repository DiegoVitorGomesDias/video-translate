// Detector simples de fala por energia (RMS), com piso de ruído adaptativo.
// Fecha um trecho quando há `silenceMs` de silêncio após fala, ou quando o trecho
// atinge `maxSegmentMs`. Guarda um pré-rolo para não cortar o começo das palavras.

export interface AudioSegment {
  /** Id sequencial do trecho (compartilhado entre parciais e o final). */
  id: number;
  /** PCM mono Float32 na taxa `sampleRate`. */
  audio: Float32Array;
  sampleRate: number;
  durationMs: number;
  /** performance.now() do instante em que o trecho foi fechado. */
  endedAt: number;
  /** Motivo do fechamento. */
  reason: 'silence' | 'max-length' | 'flush';
}

export interface VadOptions {
  sampleRate?: number;
  /** Silêncio contínuo (ms) após fala para fechar o trecho. */
  silenceMs?: number;
  /** Duração máxima (ms) de um trecho. */
  maxSegmentMs?: number;
  /** Fala mínima (ms) para o trecho ser emitido; menos que isso é descartado. */
  minSpeechMs?: number;
  /** Áudio anterior ao início da fala incluído no trecho (ms). */
  preRollMs?: number;
  /** Limiar absoluto mínimo de RMS para considerar fala. */
  minThreshold?: number;
  /** Fator sobre o piso de ruído para considerar fala. */
  noiseFactor?: number;
}

export class EnergyVad {
  private readonly sampleRate: number;
  private readonly silenceSamples: number;
  private readonly maxSamples: number;
  private readonly minSpeechSamples: number;
  private readonly preRollSamples: number;
  private readonly minThreshold: number;
  private readonly noiseFactor: number;

  private noiseFloor = 0.002;
  private preRoll: Float32Array[] = [];
  private preRollLength = 0;
  private segment: Float32Array[] = [];
  private segmentLength = 0;
  private speechSamples = 0;
  private trailingSilence = 0;
  private inSpeech = false;
  private nextId = 1;
  private currentId = 0;

  onSegment: ((segment: AudioSegment) => void) | null = null;
  /** Chamado quando um novo trecho começa (fala detectada). */
  onSpeechStart: ((segmentId: number) => void) | null = null;
  /** Chamado em cada bloco com o RMS e se foi considerado fala (útil para debug). */
  onLevel: ((rms: number, isSpeech: boolean, threshold: number) => void) | null = null;

  constructor(opts: VadOptions = {}) {
    this.sampleRate = opts.sampleRate ?? 16000;
    const ms = (v: number) => Math.round((v / 1000) * this.sampleRate);
    this.silenceSamples = ms(opts.silenceMs ?? 400);
    this.maxSamples = ms(opts.maxSegmentMs ?? 6000);
    this.minSpeechSamples = ms(opts.minSpeechMs ?? 250);
    this.preRollSamples = ms(opts.preRollMs ?? 300);
    this.minThreshold = opts.minThreshold ?? 0.008;
    this.noiseFactor = opts.noiseFactor ?? 3;
  }

  /** Há um trecho aberto (fala em andamento)? */
  get isSpeaking(): boolean {
    return this.inSpeech;
  }

  /** Id do trecho aberto (0 se nenhum). */
  get currentSegmentId(): number {
    return this.inSpeech ? this.currentId : 0;
  }

  /** Duração (ms) do trecho aberto. */
  get currentDurationMs(): number {
    return (this.segmentLength / this.sampleRate) * 1000;
  }

  /** Cópia do áudio do trecho aberto até agora (para transcrição parcial). */
  peek(): Float32Array | null {
    if (!this.inSpeech || this.segmentLength === 0) return null;
    return concat(this.segment, this.segmentLength);
  }

  push(block: Float32Array): void {
    let sum = 0;
    for (let i = 0; i < block.length; i++) {
      const v = block[i] ?? 0;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / Math.max(1, block.length));

    const threshold = Math.max(this.minThreshold, this.noiseFloor * this.noiseFactor);
    const isSpeech = rms >= threshold;

    // Piso de ruído: só acompanha blocos sem fala (desce rápido, sobe devagar);
    // durante a fala fica praticamente parado, para não "engolir" falas longas.
    if (!isSpeech) {
      const alpha = rms < this.noiseFloor ? 0.2 : 0.02;
      this.noiseFloor = this.noiseFloor * (1 - alpha) + rms * alpha;
    } else {
      this.noiseFloor = this.noiseFloor * 0.9995 + rms * 0.0005;
    }
    this.onLevel?.(rms, isSpeech, threshold);

    if (!this.inSpeech) {
      if (isSpeech) {
        this.inSpeech = true;
        this.currentId = this.nextId++;
        this.segment = [...this.preRoll];
        this.segmentLength = this.preRollLength;
        this.speechSamples = 0;
        this.trailingSilence = 0;
        this.clearPreRoll();
        this.append(block);
        this.speechSamples += block.length;
        this.onSpeechStart?.(this.currentId);
      } else {
        this.pushPreRoll(block);
      }
      return;
    }

    this.append(block);
    if (isSpeech) {
      this.speechSamples += block.length;
      this.trailingSilence = 0;
    } else {
      this.trailingSilence += block.length;
    }

    if (this.trailingSilence >= this.silenceSamples) {
      this.close('silence');
    } else if (this.segmentLength >= this.maxSamples) {
      this.close('max-length');
    }
  }

  /** Fecha o trecho em andamento (ex.: ao parar a captura). */
  flush(): void {
    if (this.inSpeech) this.close('flush');
  }

  private close(reason: AudioSegment['reason']): void {
    const audio = concat(this.segment, this.segmentLength);
    const hadEnoughSpeech = this.speechSamples >= this.minSpeechSamples;
    const id = this.currentId;
    this.inSpeech = false;
    this.segment = [];
    this.segmentLength = 0;
    if (hadEnoughSpeech && this.onSegment) {
      this.onSegment({
        id,
        audio,
        sampleRate: this.sampleRate,
        durationMs: (audio.length / this.sampleRate) * 1000,
        endedAt: performance.now(),
        reason,
      });
    }
  }

  private append(block: Float32Array): void {
    this.segment.push(block);
    this.segmentLength += block.length;
  }

  private pushPreRoll(block: Float32Array): void {
    this.preRoll.push(block);
    this.preRollLength += block.length;
    while (this.preRollLength - (this.preRoll[0]?.length ?? 0) >= this.preRollSamples && this.preRoll.length > 1) {
      this.preRollLength -= this.preRoll.shift()!.length;
    }
  }

  private clearPreRoll(): void {
    this.preRoll = [];
    this.preRollLength = 0;
  }
}

function concat(blocks: Float32Array[], total: number): Float32Array {
  const out = new Float32Array(total);
  let offset = 0;
  for (const b of blocks) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}
