// Tipos das mensagens trocadas entre background, offscreen e a janela do viewer.
// Todas trafegam por browser.runtime.sendMessage; o campo `target` indica quem deve tratar.

export const OFFSCREEN_TARGET = 'offscreen' as const;
export const BACKGROUND_TARGET = 'background' as const;
export const DRAWER_TARGET = 'drawer' as const;

export type DisplayMode = 'drawer' | 'window';

export type SttModelId = 'auto' | 'moonshine-tiny' | 'moonshine-base' | 'whisper-base.en' | 'whisper-small.en' | 'whisper-large-v3-turbo';
/** Motor de transcrição: modelo local (transformers.js) ou reconhecimento nativo do Chrome no dispositivo. */
export type SttEngineId = 'local' | 'chrome' | 'server';
export type VadEngineId = 'silero' | 'energy';
export type VadProfileId = 'fast' | 'normal' | 'long';
export type VadSensitivityId = 'low' | 'normal' | 'high';
export type SegmentEndReason = 'silence' | 'max-length' | 'flush';

// ---- Para o offscreen ----

export interface StartCaptureMessage {
  target: typeof OFFSCREEN_TARGET;
  type: 'start-capture';
  streamId: string;
  tabId: number;
  sttModel: SttModelId;
  sttEngine: SttEngineId;
  vadProfile: VadProfileId;
  vadSensitivity?: VadSensitivityId;
  /** Contexto inicial (o offscreen não acessa chrome.storage; o background manda). */
  context?: SpeechContext;
  /** Configuração do servidor local de transcrição (motor 'server'). */
  server?: { url: string; format: 'whispercpp' | 'openai'; model: string; apiKey: string };
}

/** Fonte do glossário para o reconhecimento do Chrome: título da aba e opções. */
export interface SpeechContext {
  tabTitle: string;
  useTabContext: boolean;
  glossary: string;
}

/** Título da aba ou opções mudaram; o offscreen refaz o glossário do reconhecimento do Chrome. */
export interface SetContextMessage {
  target: typeof OFFSCREEN_TARGET;
  type: 'set-context';
  context: Partial<SpeechContext>;
}

export interface StopCaptureMessage {
  target: typeof OFFSCREEN_TARGET;
  type: 'stop-capture';
}

/** O viewer pede o histórico ao abrir (pode ter perdido eventos antes de carregar). */
export interface GetTranscriptsMessage {
  target: typeof OFFSCREEN_TARGET;
  type: 'get-transcripts';
}

export type OffscreenMessage = StartCaptureMessage | StopCaptureMessage | GetTranscriptsMessage | SetContextMessage;

export interface GetTranscriptsResponse {
  finals: TranscriptEvent[];
  partial: TranscriptEvent | null;
  status: SttStatusEvent | null;
  applied: AppliedConfig | null;
}

// ---- Para o background ----

export interface StopCaptureRequestMessage {
  target: typeof BACKGROUND_TARGET;
  type: 'stop-capture-request';
}

/** O drawer foi fechado pelo usuário (botão X). */
export interface DrawerClosedMessage {
  target: typeof BACKGROUND_TARGET;
  type: 'drawer-closed';
}

/** Troca entre painel lateral e janela durante a captura. */
export interface SwitchDisplayMessage {
  target: typeof BACKGROUND_TARGET;
  type: 'switch-display';
  mode: DisplayMode;
}

/** O drawer avisa que o título da página mudou (navegação SPA no YouTube, próximo episódio). */
export interface TabTitleMessage {
  target: typeof BACKGROUND_TARGET;
  type: 'tab-title';
  title: string;
  url: string;
}

export type BackgroundMessage = StopCaptureRequestMessage | DrawerClosedMessage | SwitchDisplayMessage | TabTitleMessage;

// ---- Para o content script do drawer (via tabs.sendMessage) ----

export interface DrawerCloseMessage {
  target: typeof DRAWER_TARGET;
  type: 'close';
}

export interface DrawerPingMessage {
  target: typeof DRAWER_TARGET;
  type: 'ping';
}

export type DrawerMessage = DrawerCloseMessage | DrawerPingMessage;

// ---- Eventos (broadcast do offscreen; background e viewer escutam) ----

/** Configuração realmente aplicada na captura em curso. */
export interface AppliedConfig {
  sttModel: SttModelId;
  vadProfile: VadProfileId;
  vadSensitivity?: VadSensitivityId;
  /** Motor pedido nas opções e o que de fato está em uso (o Chrome pode cair para o local). */
  sttEngine?: SttEngineId;
  activeEngine?: SttEngineId;
  /** Detector de fala em uso (o Silero pode cair para o de energia). */
  vadEngine?: VadEngineId;
}

export interface CaptureStatusEvent {
  type: 'capture-status';
  status: 'started' | 'stopped' | 'error';
  error?: string;
  applied?: AppliedConfig;
}

export interface SttStatusEvent {
  type: 'stt-status';
  state: 'idle' | 'loading' | 'ready' | 'error';
  message?: string;
  progress?: number;
  device?: string;
  model?: string;
}

export interface TranscriptEvent {
  type: 'transcript';
  /** Id do trecho de áudio (um trecho pode gerar vários parciais e um final). */
  segmentId: number;
  text: string;
  isFinal: boolean;
  /** Como o trecho de áudio terminou (só em finais). */
  reason?: SegmentEndReason;
  /** performance.now() do offscreen no fechamento (final) ou no corte (parcial). */
  audioEndedAt: number;
  /** Date.now() em que o texto ficou pronto. */
  readyAt: number;
  latencyMs: number;
  inferenceMs: number;
  audioMs: number;
}

export type BroadcastEvent = CaptureStatusEvent | SttStatusEvent | TranscriptEvent;

// ---- Estado da sessão (chrome.storage.session) ----

export interface CaptureState {
  tabId: number | null;
  tabTitle?: string;
  tabUrl?: string;
  windowId?: number | null;
  /** Como o viewer está sendo mostrado nesta captura. */
  mode?: DisplayMode;
}

export const CAPTURE_STATE_KEY = 'captureState';

// ---- Guards ----

export function isOffscreenMessage(msg: unknown): msg is OffscreenMessage {
  return hasTarget(msg, OFFSCREEN_TARGET);
}

export function isBackgroundMessage(msg: unknown): msg is BackgroundMessage {
  return hasTarget(msg, BACKGROUND_TARGET);
}

export function isDrawerMessage(msg: unknown): msg is DrawerMessage {
  return hasTarget(msg, DRAWER_TARGET);
}

export function isBroadcastEvent(msg: unknown): msg is BroadcastEvent {
  if (typeof msg !== 'object' || msg === null) return false;
  const t = (msg as { type?: unknown }).type;
  return t === 'capture-status' || t === 'stt-status' || t === 'transcript';
}

function hasTarget(msg: unknown, target: string): boolean {
  return typeof msg === 'object' && msg !== null && (msg as { target?: unknown }).target === target;
}
