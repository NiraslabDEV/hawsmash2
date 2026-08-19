export type StoreHour = {
  dow: number;
  opens: string;
  closes: string;
  active: boolean;
};

export type ScheduleSlot = {
  /** Instante em UTC, pronto para ir no pedido. */
  iso: string;
  /** Etiqueta em Africa/Maputo, como o cliente a lê. */
  label: string;
};

// Moçambique (CAT) é UTC+2 o ano inteiro — não há horário de verão. Guardar o
// deslocamento aqui evita depender do fuso do browser, que pode ser outro.
const MAPUTO_OFFSET_MINUTES = 120;
const DOW_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const MINUTE = 60_000;

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Horários possíveis para agendar na loja escolhida. O servidor volta a validar
 * (CLAUDE §13): isto existe para o cliente não escolher um horário impossível.
 */
export function buildScheduleSlots(
  hours: StoreHour[],
  now: Date = new Date(),
  options: { stepMinutes?: number; horizonDays?: number; leadMinutes?: number } = {},
): ScheduleSlot[] {
  const step = options.stepMinutes ?? 30;
  const horizon = options.horizonDays ?? 3;
  const lead = options.leadMinutes ?? 30;

  const active = hours.filter((entry) => entry.active);
  if (active.length === 0) return [];

  const earliestUtc = now.getTime() + lead * MINUTE;
  const localNow = new Date(now.getTime() + MAPUTO_OFFSET_MINUTES * MINUTE);
  const slots: ScheduleSlot[] = [];

  for (let dayOffset = 0; dayOffset < horizon; dayOffset += 1) {
    const localDay = new Date(localNow.getTime() + dayOffset * 24 * 60 * MINUTE);
    const year = localDay.getUTCFullYear();
    const month = localDay.getUTCMonth();
    const day = localDay.getUTCDate();
    const dow = localDay.getUTCDay();

    const window = active.find((entry) => entry.dow === dow);
    if (!window) continue;

    const opens = toMinutes(window.opens);
    const closes = toMinutes(window.closes);
    if (closes <= opens) continue;

    for (let minute = opens; minute < closes; minute += step) {
      const utc = Date.UTC(year, month, day, 0, minute - MAPUTO_OFFSET_MINUTES, 0, 0);
      if (utc < earliestUtc) continue;
      const hour = Math.floor(minute / 60);
      slots.push({
        iso: new Date(utc).toISOString(),
        label: `${DOW_LABELS[dow]} · ${pad(hour)}:${pad(minute % 60)}`,
      });
    }
  }

  return slots;
}
