/**
 * Entrada no POS por card da pessoa + PIN (CLAUDE §7.1).
 *
 * Lógica pura do ecrã de entrada: o que cada card mostra, quanto falta de
 * castigo e que frase aparece quando corre mal. Fica fora do componente
 * porque é isto que se testa — e porque a mensagem errada num balcão cheio
 * custa mais do que o bug que a causou.
 */

export type StaffRole = 'owner' | 'manager' | 'cashier' | 'kitchen';

export type StaffCard = {
  user_id: string;
  full_name: string;
  role: StaffRole;
  has_pin: boolean;
  locked_until: string | null;
};

export type CardState = 'ready' | 'no-pin' | 'locked';

export const POS_PIN_MIN = 4;
export const POS_PIN_MAX = 6;

const ROLE_LABELS: Record<StaffRole, string> = {
  owner: 'Dono',
  manager: 'Gerente',
  cashier: 'Caixa',
  kitchen: 'Cozinha',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role as StaffRole] ?? 'Equipa';
}

/** Duas letras grandes no card — a foto da equipa não existe e não vale esperar por ela. */
export function cardInitials(fullName: string): string {
  const palavras = fullName.trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return '?';
  const primeira = palavras[0]!;
  const ultima = palavras[palavras.length - 1]!;
  const letras =
    palavras.length === 1
      ? primeira.slice(0, 2)
      : `${primeira[0] ?? ''}${ultima[0] ?? ''}`;
  return letras.toUpperCase();
}

export function cardState(card: StaffCard, now: number = Date.now()): CardState {
  // Sem PIN vem primeiro de propósito: a saída é a mesma (criar PIN), e dizer
  // "espera 3 minutos" a quem nunca teve PIN mandava a pessoa esperar por nada.
  if (!card.has_pin) return 'no-pin';
  if (lockedMs(card.locked_until, now) > 0) return 'locked';
  return 'ready';
}

function lockedMs(lockedUntil: string | null, now: number): number {
  if (!lockedUntil) return 0;
  const alvo = Date.parse(lockedUntil);
  if (Number.isNaN(alvo)) return 0;
  return Math.max(0, alvo - now);
}

/** "4 min" ou "45 s" — quem está ao balcão precisa de saber se espera ou se chama o gerente. */
export function lockCountdown(
  lockedUntil: string | null,
  now: number = Date.now(),
): string | null {
  const restante = lockedMs(lockedUntil, now);
  if (restante <= 0) return null;
  if (restante < 60_000) return `${Math.ceil(restante / 1000)} s`;
  return `${Math.ceil(restante / 60_000)} min`;
}

export function loginErrorMessage(
  reason: string,
  lockedUntil: string | null = null,
  now: number = Date.now(),
): string {
  switch (reason) {
    case 'invalid_pin':
      return 'PIN incorrecto. Tenta outra vez.';
    case 'pin_locked': {
      const falta = lockCountdown(lockedUntil, now);
      return falta
        ? `Demasiados PIN errados. Espera ${falta} ou pede ao gerente para repor o teu PIN.`
        : 'Demasiados PIN errados. Tenta daqui a pouco ou pede ao gerente para repor o teu PIN.';
    }
    case 'pin_not_configured':
      return 'Ainda não tens PIN. Pede ao gerente para o definir em Equipa.';
    case 'invalid_pin_format':
      return `O PIN tem ${POS_PIN_MIN} a ${POS_PIN_MAX} algarismos.`;
    case 'staff_not_in_store':
      return 'Esta conta não tem acesso à loja deste terminal.';
    case 'staff_without_email':
      return 'Conta sem email no sistema. Pede ao dono para a corrigir em Equipa.';
    case 'invalid_device':
      return 'Este PC deixou de estar vinculado. Um gerente tem de o vincular outra vez.';
    case 'session_unavailable':
      return 'Não foi possível abrir a sessão. Entra por email uma vez e avisa o suporte.';
    case 'offline':
      return 'Sem ligação. A entrada no POS precisa de internet.';
    default:
      return 'Não foi possível entrar. Tenta outra vez.';
  }
}

export function appendPinDigit(pin: string, digit: string): string {
  if (!/^[0-9]$/.test(digit)) return pin;
  if (pin.length >= POS_PIN_MAX) return pin;
  return pin + digit;
}
