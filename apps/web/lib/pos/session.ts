export const POS_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export function isPosPin(value: string): boolean {
  return /^[0-9]{4,6}$/.test(value);
}

export function shouldLockPos(
  lastActivityAt: number,
  now: number,
  timeoutMs = POS_IDLE_TIMEOUT_MS,
): boolean {
  return now - lastActivityAt >= timeoutMs;
}
