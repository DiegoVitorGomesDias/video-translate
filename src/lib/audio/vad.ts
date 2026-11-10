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

/** Perfis de separação de frases: silêncio para fechar / duração máxima do trecho. */
export type VadProfile = 'fast' | 'normal' | 'long';
export const VAD_PROFILES: Record<VadProfile, { silenceMs: number; maxSegmentMs: number; label: string; description: string }> = {
  fast: { silenceMs: 200, maxSegmentMs: 3000, label: 'Rápida', description: 'Fecha a frase em pausas de 0,2 s (até 3 s por trecho). Frases curtas, mais cortes no meio.' },
  normal: { silenceMs: 250, maxSegmentMs: 4000, label: 'Normal', description: 'Pausas de 0,25 s e até 4 s por trecho. Bom equilíbrio para diálogo.' },
  long: { silenceMs: 400, maxSegmentMs: 6000, label: 'Longa', description: 'Pausas de 0,4 s e até 6 s. Frases mais completas, mas falas diferentes podem ficar juntas.' },
};

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
  /** RMS e classificação de cada bloco do trecho aberto (para cortar no ponto mais silencioso). */
  private segmentMeta: { rms: number; isSpeech: boolean }[] = [];
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
    this.silenceSamples = ms(opts.silenceMs ?? 250);
    this.maxSamples = ms(opts.maxSegmentMs ?? 4000);
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
        this.segmentMeta = this.preRoll.map(() => ({ rms: 0, isSpeech: false }));
        this.segmentLength = this.preRollLength;
        this.speechSamples = 0;
        this.trailingSilence = 0;
        this.clearPreRoll();
        this.append(block, rms, true);
        this.speechSamples += block.length;
        this.onSpeechStart?.(this.currentId);
      } else {
        this.pushPreRoll(block);
      }
      return;
    }

    this.append(block, rms, isSpeech);
    if (isSpeech) {
      this.speechSamples += block.length;
      this.trailingSilence = 0;
    } else {
      this.trailingSilence += block.length;
    }

    if (this.trailingSilence >= this.silenceSamples) {
      this.close('silence');
    } else if (this.segmentLength >= this.maxSamples) {
      this.splitAtQuietest();
    }
  }

  /**
   * Trecho atingiu o máximo: corta no bloco mais silencioso dos últimos ~1,2 s (em vez
   * de cortar seco no meio de uma palavra). O que vem depois do corte vira o início
   * do próximo trecho, que continua aberto.
   */
  private splitAtQuietest(): void {
    const windowSamples = Math.round(1.2 * this.sampleRate);
    let acc = 0;
    let bestIdx = this.segment.length; // índice do bloco onde começa o resto
    let bestRms = Infinity;
    for (let i = this.segment.length - 1; i > 0; i--) {
      acc += this.segment[i]!.length;
      if (acc > windowSamples) break;
      const m = this.segmentMeta[i]!;
      if (m.rms < bestRms) {
        bestRms = m.rms;
        bestIdx = i;
      }
    }
    // Garante que a parte emitida tenha pelo menos metade do máximo.
    const headLen = this.segment.slice(0, bestIdx).reduce((n, b) => n + b.length, 0);
    if (bestIdx >= this.segment.length || headLen < this.maxSamples / 2) {
      this.close('max-length');
      return;
    }
    const tail = this.segment.slice(bestIdx);
    const tailMeta = this.segmentMeta.slice(bestIdx);
    this.segment = this.segment.slice(0, bestIdx);
    this.segmentMeta = this.segmentMeta.slice(0, bestIdx);
    this.segmentLength = headLen;
    const tailSpeech = tailMeta.reduce((n, m, i) => n + (m.isSpeech ? tail[i]!.length : 0), 0);
    this.speechSamples = Math.max(0, this.speechSamples - tailSpeech);
    this.emit('max-length');
    // O resto abre o próximo trecho imediatamente.
    this.inSpeech = true;
    this.currentId = this.nextId++;
    this.segment = tail;
    this.segmentMeta = tailMeta;
    this.segmentLength = tail.reduce((n, b) => n + b.length, 0);
    this.speechSamples = tailSpeech;
    this.trailingSilence = tailMeta.reduceRight((n, m, i) => (m.isSpeech || n < 0 ? (m.isSpeech ? -1 : n) : n + tail[i]!.length), 0);
    if (this.trailingSilence < 0) this.trailingSilence = 0;
    this.onSpeechStart?.(this.currentId);
  }

  /** Fecha o trecho em andamento (ex.: ao parar a captura). */
  flush(): void {
    if (this.inSpeech) this.close('flush');
  }

  private close(reason: AudioSegment['reason']): void {
    this.emit(reason);
    this.inSpeech = false;
    this.segment = [];
    this.segmentMeta = [];
    this.segmentLength = 0;
  }

  private emit(reason: AudioSegment['reason']): void {
    const audio = concat(this.segment, this.segmentLength);
    const hadEnoughSpeech = this.speechSamples >= this.minSpeechSamples;
    const id = this.currentId;
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

  private append(block: Float32Array, rms: number, isSpeech: boolean): void {
    this.segment.push(block);
    this.segmentMeta.push({ rms, isSpeech });
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
