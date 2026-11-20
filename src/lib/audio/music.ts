// Modo música: segmentação por janelas fixas, sem detector de fala.
//
// Num clipe musical o Silero VAD (treinado em fala) oscila com a voz cantada e o
// instrumental e corta as frases em pedaços sem sentido, ou nem abre trecho. Aqui o áudio
// é acumulado continuamente e cortado a cada `windowMs`, no bloco mais silencioso dos
// últimos `searchMs` (fim de verso, respiração), para que cada janela seja um verso ou
// dois. Uma pausa longa (`silenceMs` abaixo de `minRms`) fecha a janela em aberto; uma
// janela só de silêncio (vídeo pausado) é descartada.
//
// Mesma interface do SegmentBuilder/SileroVad (SpeechSegmenter), para o resto do
// pipeline não mudar. Sem dependências do navegador, para poder ser testado em Node.

import type { AudioSegment, SpeechSegmenter } from './vad';

export type AudioMode = 'speech' | 'music';

export const AUDIO_MODES: Record<AudioMode, { label: string; description: string }> = {
  speech: {
    label: 'Fala (diálogo)',
    description: 'Detector de fala (Silero) separa as frases nas pausas. Para filmes, séries, vídeos falados.',
  },
  music: {
    label: 'Música (letras)',
    description:
      'Sem detector de fala: o áudio é cortado em janelas de ~7 s, no ponto mais silencioso (fim de verso), e transcrito por um modelo Whisper, que entende voz cantada sobre instrumentos bem melhor que o Moonshine. Cada janela vira um verso. Latência maior e sem parciais.',
  },
};

export interface MusicSegmenterOptions {
  sampleRate?: number;
  /** Duração alvo da janela (ms): ao passar disso, corta no bloco mais silencioso recente. */
  windowMs?: number;
  /** Duração máxima (ms): corta seco se não houver ponto silencioso. */
  maxWindowMs?: number;
  /** Faixa do fim da janela (ms) onde se procura o bloco mais silencioso para cortar. */
  searchMs?: number;
  /** RMS abaixo do qual o bloco conta como silêncio. */
  minRms?: number;
  /** Silêncio contínuo (ms) que fecha a janela em aberto (fim da música, pausa). */
  silenceMs?: number;
  /** Som mínimo (ms de blocos acima de minRms) para a janela valer uma transcrição. */
  minSoundMs?: number;
}

/** Parâmetros padrão do modo música (mostrados nas opções e no viewer). */
export const MUSIC_WINDOW = { windowMs: 7000, maxWindowMs: 9000, searchMs: 2500, silenceMs: 1200, minRms: 0.004, minSoundMs: 800 } as const;

export class MusicSegmenter implements SpeechSegmenter {
  onSegment: ((segment: AudioSegment) => void) | null = null;
  onSpeechStart: ((segmentId: number) => void) | null = null;
  onLevel: ((level: number, isSpeech: boolean, threshold: number) => void) | null = null;

  private readonly sampleRate: number;
  private readonly windowSamples: number;
  private readonly maxSamples: number;
  private readonly searchSamples: number;
  private readonly minRms: number;
  private readonly silenceSamples: number;
  private readonly minSoundSamples: number;

  private blocks: Float32Array[] = [];
  private rms: number[] = [];
  private length = 0;
  private soundSamples = 0;
  private trailingSilence = 0;
  private open = false;
  private nextId = 1;
  private currentId = 0;

  constructor(opts: MusicSegmenterOptions = {}) {
    this.sampleRate = opts.sampleRate ?? 16000;
    const ms = (v: number) => Math.round((v / 1000) * this.sampleRate);
    this.windowSamples = ms(opts.windowMs ?? MUSIC_WINDOW.windowMs);
    this.maxSamples = ms(opts.maxWindowMs ?? MUSIC_WINDOW.maxWindowMs);
    this.searchSamples = ms(opts.searchMs ?? MUSIC_WINDOW.searchMs);
    this.minRms = opts.minRms ?? MUSIC_WINDOW.minRms;
    this.silenceSamples = ms(opts.silenceMs ?? MUSIC_WINDOW.silenceMs);
    this.minSoundSamples = ms(opts.minSoundMs ?? MUSIC_WINDOW.minSoundMs);
  }

  get isSpeaking(): boolean {
    return this.open;
  }

  get currentSegmentId(): number {
    return this.open ? this.currentId : 0;
  }

  get currentDurationMs(): number {
    return (this.length / this.sampleRate) * 1000;
  }

  peek(): Float32Array | null {
    if (!this.open || this.length === 0) return null;
    return concat(this.blocks, this.length);
  }

  push(block: Float32Array): void {
    let sum = 0;
    for (let i = 0; i < block.length; i++) {
      const v = block[i] ?? 0;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / Math.max(1, block.length));
    const loud = rms >= this.minRms;
    this.onLevel?.(rms, loud, this.minRms);

    if (!this.open) {
      if (!loud) return; // silêncio antes da música: nada a acumular
      this.open = true;
      this.currentId = this.nextId++;
      this.soundSamples = 0;
      this.trailingSilence = 0;
      this.onSpeechStart?.(this.currentId);
    }

    this.blocks.push(block);
    this.rms.push(rms);
    this.length += block.length;
    if (loud) {
      this.soundSamples += block.length;
      this.trailingSilence = 0;
    } else {
      this.trailingSilence += block.length;
    }

    if (this.trailingSilence >= this.silenceSamples) {
      this.close('silence');
    } else if (this.length >= this.windowSamples) {
      this.splitAtQuietest();
    }
  }

  flush(): void {
    if (this.open) this.close('flush');
  }

  /** Corta no bloco mais silencioso da faixa final; o resto abre a próxima janela. */
  private splitAtQuietest(): void {
    let acc = 0;
    let bestIdx = -1;
    let bestRms = Infinity;
    for (let i = this.blocks.length - 1; i > 0; i--) {
      acc += this.blocks[i]!.length;
      if (acc > this.searchSamples) break;
      const r = this.rms[i]!;
      // Prefere o bloco mais silencioso; em empate, o mais recente (janela mais longa).
      if (r < bestRms) {
        bestRms = r;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) {
      if (this.length >= this.maxSamples) this.close('max-length');
      return;
    }
    // Só vale cortar antes do fim se o ponto for de fato mais silencioso que a média da
    // janela; senão espera até a duração máxima (um verso pode estar no meio).
    const mean = this.rms.reduce((a, b) => a + b, 0) / this.rms.length;
    if (bestRms > mean * 0.5 && this.length < this.maxSamples) return;

    const tail = this.blocks.slice(bestIdx);
    const tailRms = this.rms.slice(bestIdx);
    this.blocks = this.blocks.slice(0, bestIdx);
    this.rms = this.rms.slice(0, bestIdx);
    this.length = this.blocks.reduce((n, b) => n + b.length, 0);
    const tailSound = tail.reduce((n, b, i) => n + (tailRms[i]! >= this.minRms ? b.length : 0), 0);
    this.soundSamples = Math.max(0, this.soundSamples - tailSound);
    this.emit('max-length');

    this.open = true;
    this.currentId = this.nextId++;
    this.blocks = tail;
    this.rms = tailRms;
    this.length = tail.reduce((n, b) => n + b.length, 0);
    this.soundSamples = tailSound;
    this.trailingSilence = 0;
    for (let i = tail.length - 1; i >= 0; i--) {
      if (tailRms[i]! >= this.minRms) break;
      this.trailingSilence += tail[i]!.length;
    }
    this.onSpeechStart?.(this.currentId);
  }

  private close(reason: AudioSegment['reason']): void {
    this.emit(reason);
    this.open = false;
    this.blocks = [];
    this.rms = [];
    this.length = 0;
    this.soundSamples = 0;
    this.trailingSilence = 0;
  }

  private emit(reason: AudioSegment['reason']): void {
    if (this.soundSamples < this.minSoundSamples || !this.onSegment) return;
    const audio = concat(this.blocks, this.length);
    this.onSegment({
      id: this.currentId,
      audio,
      sampleRate: this.sampleRate,
      durationMs: (audio.length / this.sampleRate) * 1000,
      endedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      // Cada janela é um verso fechado: para o segmentador de frases não juntar com a próxima.
      reason: reason === 'max-length' ? 'silence' : reason,
    });
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
