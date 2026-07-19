// Tiny bridge so send paths can ask the scheduled-sends worker (registered
// in App.tsx) to drain immediately instead of waiting for the next 60s tick.
// Undo-send rows are scheduled a few seconds ahead; when the undo window
// closes the composer calls drainOutboxNow() so the mail leaves right away.

let drainFn: (() => void) | null = null;

export function registerOutboxDrain(fn: (() => void) | null): void {
  drainFn = fn;
}

export function drainOutboxNow(): void {
  drainFn?.();
}
