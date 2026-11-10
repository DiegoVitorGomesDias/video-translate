// Tipos das mensagens trocadas entre background, offscreen e a janela do viewer.
// Todas trafegam por browser.runtime.sendMessage; o campo `target` indica quem deve tratar.

export const OFFSCREEN_TARGET = 'offscreen' as const;
export const BACKGROUND_TARGET = 'background' as const;
export const DRAWER_TARGET = 'drawer' as const;

export type DisplayMode = 'drawer' | 'window';

export type SttModelId = 'moonshine-tiny' | 'moonshine-base' | 'whisper-base.en';
export type VadProfileId = 'fast' | 'normal' | 'long';
export type SegmentEndReason = 'silence' | 'max-length' | 'flush';

// ---- Para o offscreen ----

export interface StartCaptureMessage {
  target: typeof OFFSCREEN_TARGET;
  type: 'start-capture';
  streamId: string;
  tabId: number;
  sttModel: SttModelId;
  vadProfile: VadProfileId;
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

export type OffscreenMessage = StartCaptureMessage | StopCaptureMessage | GetTranscriptsMessage;

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

export type BackgroundMessage = StopCaptureRequestMessage | DrawerClosedMessage | SwitchDisplayMessage;

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
