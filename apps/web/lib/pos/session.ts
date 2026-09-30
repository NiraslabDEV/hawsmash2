export function isPosPin(value: string): boolean {
  return /^[0-9]{4,6}$/.test(value);
}

/**
 * Bloqueio por inactividade: quanto tempo sem toques até o POS voltar aos
 * cartões e pedir o PIN. Vem das Definições do POS de cada loja
 * (`session.lockAfterMinutes`). 0 = nunca: `null`, sem temporizador — o POS
 * fica aberto o turno inteiro e bloqueia no botão Bloquear ou na troca de turno.
 */
export function posIdleTimeoutMs(lockAfterMinutes: number): number | null {
  return Number.isFinite(lockAfterMinutes) && lockAfterMinutes > 0 ? Math.round(lockAfterMinutes) * 60_000 : null;
}

export function shouldLockPos(lastActivityAt: number, now: number, timeoutMs: number | null): boolean {
  return timeoutMs !== null && now - lastActivityAt >= timeoutMs;
}
