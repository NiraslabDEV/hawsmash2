import { z } from 'zod';

/**
 * Forma da loja tal como a página de entrada e o selector a consomem.
 * Vem sempre de `list_public_stores()` — a única porta anónima para a lista
 * de lojas — e nunca de uma leitura directa da tabela.
 */
export const publicStoreSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  short_name: z.string().min(1),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  maps_url: z.string().nullable(),
  accepting_orders: z.boolean(),
  delivery_enabled: z.boolean(),
  pickup_enabled: z.boolean(),
  open_now: z.boolean(),
  hours: z.array(
    z.object({
      dow: z.number().int().min(0).max(6),
      opens: z.string(),
      closes: z.string(),
      active: z.boolean(),
    }),
  ),
});

export const publicStoreListSchema = z.array(publicStoreSchema);

export type PublicStoreOption = z.infer<typeof publicStoreSchema>;

const DOW_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const hhmm = (value: string) => value.slice(0, 5);

/** Horário do dia indicado, já em texto para o cliente ler. */
export function todaysHours(store: PublicStoreOption, dow: number): string {
  const today = store.hours.find((entry) => entry.dow === dow && entry.active);
  if (!today) return 'Fechado hoje';
  return `${DOW_LABELS[dow]}: ${hhmm(today.opens)}–${hhmm(today.closes)}`;
}

/** Estado curto da loja para o cartão de escolha. */
export function storeStatusLabel(store: PublicStoreOption): string {
  if (!store.accepting_orders) return 'Não está a aceitar pedidos';
  return store.open_now ? 'Aberta agora' : 'Fechada agora · aceita agendamento';
}

/**
 * Dia da semana em Africa/Maputo (0 = domingo). O servidor pode correr noutro
 * fuso; o horário da loja é sempre lido no fuso da loja (CLAUDE §11.8).
 */
export function maputoDow(now: Date = new Date()): number {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Maputo',
    weekday: 'short',
  }).format(now);
  const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  if (index < 0) throw new Error('Não foi possível determinar o dia em Africa/Maputo.');
  return index;
}
