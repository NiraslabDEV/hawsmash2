/**
 * Janelas de 30 minutos para o pedido agendado no balcão.
 *
 * "Levo mais tarde" é conversa de balcão todos os dias, e até aqui o POS não
 * tinha onde a escrever: o pedido entrava como se fosse para agora e ia para a
 * cozinha na hora errada.
 *
 * Sobre o fuso (CLAUDE §11.8): grava-se em UTC, apresenta-se em Africa/Maputo.
 * O offset está fixo em +02:00 e não vem de uma tabela porque **Moçambique não
 * tem nem nunca teve horário de verão** — CAT é UTC+2 o ano inteiro. Escrevo-o
 * explícito no ISO em vez de somar horas à mão, que é o erro que faz um pedido
 * das 20h aparecer às 18h no relatório.
 */

export const MAPUTO_OFFSET = '+02:00';

/** Nada de agendar para daqui a dois minutos: a cozinha precisa de tempo. */
export const MIN_LEAD_MINUTES = 20;

/** Sem horário de loja conhecido, o balcão continua a poder agendar. */
export const DEFAULT_HORIZON_MINUTES = 6 * 60;

export type Slot = {
  /** ISO com offset explícito — é o que vai para `orders.scheduled_for`. */
  value: string;
  /** `HH:MM` em hora de Maputo, que é o que o operador diz ao cliente. */
  label: string;
};

/** As partes do relógio de Maputo para um instante qualquer. */
function maputoParts(now: Date): { year: number; month: number; day: number; minutes: number } {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Maputo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // A meia-noite vem como "24" nalguns motores; normaliza-se para 0.
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function label(minutesOfDay: number): string {
  return `${pad(Math.floor(minutesOfDay / 60) % 24)}:${pad(minutesOfDay % 60)}`;
}

/** `21:30` ou `21:30:00` → 1290 minutos. Devolve null ao que não for hora. */
export function parseTimeOfDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * As janelas que o operador pode oferecer, de 30 em 30 minutos.
 *
 * Começa na primeira meia hora redonda que respeite o tempo mínimo de preparo,
 * e acaba quando a loja fecha. Uma loja que fecha às 21:30 não oferece as 22:00
 * — prometer uma hora a que já não há ninguém lá é pior do que não agendar.
 */
export function buildPickupSlots(input: {
  now: Date;
  /** `closes` do `store_hours` do dia, em hora local. */
  closesAt?: string | null;
  leadMinutes?: number;
  horizonMinutes?: number;
}): Slot[] {
  const { year, month, day, minutes } = maputoParts(input.now);
  const lead = input.leadMinutes ?? MIN_LEAD_MINUTES;

  const primeira = Math.ceil((minutes + lead) / 30) * 30;
  const fecho = parseTimeOfDay(input.closesAt);
  const limite =
    fecho !== null && fecho > minutes
      ? fecho
      : minutes + (input.horizonMinutes ?? DEFAULT_HORIZON_MINUTES);

  const slots: Slot[] = [];
  for (let m = primeira; m <= limite; m += 30) {
    // Não se agenda para o dia seguinte a partir do balcão: quem quer amanhã
    // faz o pedido amanhã, e assim o número do dia continua a bater certo.
    if (m >= 24 * 60) break;
    slots.push({
      value: `${year}-${pad(month)}-${pad(day)}T${pad(Math.floor(m / 60))}:${pad(m % 60)}:00${MAPUTO_OFFSET}`,
      label: label(m),
    });
  }
  return slots;
}

/** A hora marcada, como se lê num talão ou num cartão do quadro. */
export function formatSlot(iso: string | null): string {
  if (!iso) return 'Agora';
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Africa/Maputo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}
