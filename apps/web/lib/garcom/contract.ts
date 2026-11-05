import { z } from 'zod';

import type { PosTable } from '@/lib/pos/tables';

/**
 * Contrato entre o telemóvel do garçom e `/api/garcom` (1122).
 *
 * O telemóvel nunca fala com a BD: manda acções pequenas, a rota junta-lhes o
 * token do cookie e chama as RPCs `waiter_*` com a service key. Nada aqui
 * decide dinheiro — vão ids e quantidades, o preço é da BD (Regra 2).
 */

export const WAITER_COOKIE = 'garcom_sessao';
/** Igual à validade da sessão na BD (`waiter_sessions.expires_at`). */
export const WAITER_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export const loginSchema = z.object({
  phone: z.string().trim().min(9).max(20),
  pin: z.string().regex(/^[0-9]{4,6}$/),
});

const itemSchema = z.object({
  menuItemId: z.string().uuid(),
  qty: z.number().int().min(1).max(99),
  variantId: z.string().uuid().optional(),
  addonIds: z.array(z.string().uuid()).max(20).optional(),
  notes: z.string().trim().max(140).optional(),
});

export const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('launch'),
    clientSaleId: z.string().uuid(),
    tableId: z.string().uuid(),
    items: z.array(itemSchema).min(1).max(100),
    customerName: z.string().trim().max(60).optional(),
    notes: z.string().trim().max(300).optional(),
  }),
  z.object({ action: z.literal('serve'), orderId: z.string().uuid() }),
  z.object({ action: z.literal('logout') }),
]);

export type WaiterAction = z.infer<typeof actionSchema>;
export type LaunchAction = Extract<WaiterAction, { action: 'launch' }>;

/** A mesa, como o POS a vê (`pos_table_overview`): a mesma conta aberta. */
export type WaiterTable = PosTable;

export type WaiterState = {
  waiter: { id: string; full_name: string };
  store: { name: string; short_name: string; open: boolean };
  tables: WaiterTable[];
  today: { orders: number };
};

export type LaunchResult = {
  order_id: string;
  order_number: string;
  daily_number: number | null;
  total_cents: number;
  table_id: string;
  table_number: number;
  customer_name: string;
  duplicate: boolean;
};

const MENSAGENS: Record<string, string> = {
  invalid_credentials: 'Telefone ou PIN errado.',
  pin_not_configured: 'Ainda não tens PIN. Pede ao gerente para o definir.',
  pin_locked: 'Demasiadas tentativas. Espera um pouco e tenta outra vez.',
  waiter_session_invalid: 'A sessão terminou. Entra outra vez.',
  counter_disabled: 'A loja não está a receber pedidos agora. Fala com o balcão.',
  invalid_table: 'Esta mesa já não existe ou foi desactivada. Escolhe outra.',
  item_unavailable: 'Um dos produtos esgotou. O cardápio foi actualizado — confere o pedido.',
  out_of_stock: 'Um dos produtos esgotou. O cardápio foi actualizado — confere o pedido.',
  out_of_ingredient: 'Falta um ingrediente para um dos produtos. Fala com a cozinha.',
  invalid_variant: 'Um artigo mudou no cardápio. Tira-o do pedido e põe outra vez.',
  invalid_addon: 'Um extra mudou no cardápio. Tira o artigo e põe outra vez.',
  duplicate_addon: 'Um extra está repetido. Tira o artigo e põe outra vez.',
  invalid_item: 'Um artigo do pedido é inválido. Tira-o e põe outra vez.',
  invalid_items: 'O pedido está vazio.',
  client_sale_id_store_conflict: 'Este pedido já foi enviado por outra pessoa. Começa um pedido novo.',
  order_not_found: 'Este pedido já não está nesta loja.',
  order_cancelled: 'Este pedido foi cancelado. Não o sirvas.',
  order_not_ready: 'Este pedido ainda não foi para a cozinha.',
  invalid_request: 'Pedido inválido.',
};

/** A frase que o garçom lê, a partir do código que a BD devolve. */
export function waiterErrorMessage(code: string | null | undefined): string {
  if (code) {
    for (const [chave, frase] of Object.entries(MENSAGENS)) {
      if (code.includes(chave)) return frase;
    }
  }
  return 'Não foi possível. Verifica a rede e tenta outra vez.';
}

/** O código conhecido dentro de uma mensagem de erro do Postgres, ou null. */
export function waiterErrorCode(message: string | null | undefined): string | null {
  if (!message) return null;
  return Object.keys(MENSAGENS).find((k) => message.includes(k)) ?? null;
}
