// Tipos das mensagens trocadas entre background, offscreen e (futuramente) a janela.

export const OFFSCREEN_TARGET = 'offscreen' as const;

export interface StartCaptureMessage {
  target: typeof OFFSCREEN_TARGET;
  type: 'start-capture';
  streamId: string;
  tabId: number;
}

export interface StopCaptureMessage {
  target: typeof OFFSCREEN_TARGET;
  type: 'stop-capture';
}

export type OffscreenMessage = StartCaptureMessage | StopCaptureMessage;

export interface CaptureStatusMessage {
  type: 'capture-status';
  status: 'started' | 'stopped' | 'error';
  error?: string;
}

export type BackgroundMessage = CaptureStatusMessage;

export function isOffscreenMessage(msg: unknown): msg is OffscreenMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { target?: unknown }).target === OFFSCREEN_TARGET
  );
}
