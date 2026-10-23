import { maputoDate } from '@/lib/admin/analysis-period';

/**
 * O dia para que um pedido foi marcado, quando não é hoje.
 *
 * O site deixa agendar até três dias à frente (`buildScheduleSlots`). Um ecrã
 * que só mostra "12:00" põe um pedido de sábado ao lado dos de sexta, e a
 * cozinha fá-lo no dia errado (23 Out). Por isso o dia aparece sempre que não
 * for hoje — e hoje não leva etiqueta, para não se tornar ruído.
 *
 * Dias de calendário de Maputo (CAT, UTC+2 sem horário de verão).
 */
const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/** `null` = sem hora marcada ou marcado para hoje. */
export function scheduledDayLabel(iso: string | null | undefined, now = new Date()): string | null {
  if (!iso) return null;
  const day = maputoDate(new Date(iso));
  const diff = dayNumber(day) - dayNumber(maputoDate(now));
  if (diff === 0) return null;
  if (diff === 1) return 'Amanhã';
  const [, month, dom] = day.split('-');
  return `${DOW[new Date(`${day}T12:00:00Z`).getUTCDay()]} ${dom}/${month}`;
}

/** Marcado para um dia depois de hoje? */
export function isForLaterDay(iso: string | null | undefined, now = new Date()): boolean {
  if (!iso) return false;
  return dayNumber(maputoDate(new Date(iso))) > dayNumber(maputoDate(now));
}
