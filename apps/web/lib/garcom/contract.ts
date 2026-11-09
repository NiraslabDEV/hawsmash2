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
  /** De quem é o prato (1137). Texto livre: "Ana", "camisa azul". */
  person: z.string().trim().max(40).optional(),
});

export const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('launch'),
    clientSaleId: z.string().uuid(),
    tableId: z.string().uuid(),
    items: z.array(itemSchema).min(1).max(100),
    customerName: z.string().trim().max(60).optional(),
    customerPhone: z.string().trim().max(20).optional(),
    tabNote: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(300).optional(),
  }),
  z.object({ action: z.literal('serve'), orderId: z.string().uuid() }),
  z.object({
    action: z.literal('remove'),
    requestId: z.string().uuid(),
    orderItemId: z.string().uuid(),
    qty: z.number().int().min(1).max(99),
    reason: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal('close'),
    clientCloseId: z.string().uuid(),
    tableId: z.string().uuid(),
    // O total que o garçom viu: se a conta mudou, a BD recusa. Não é o preço (Regra 2).
    expectedTotalCents: z.number().int().positive(),
    // Sem dinheiro em notas: não há meio 'cash' neste contrato (1127).
    method: z.enum(['mpesa', 'emola', 'credit_card']),
  }),
  z.object({
    action: z.literal('move'),
    requestId: z.string().uuid(),
    fromTableId: z.string().uuid(),
    toTableId: z.string().uuid(),
  }),
  z.object({ action: z.literal('request_bill'), requestId: z.string().uuid(), tableId: z.string().uuid() }),
  z.object({ action: z.literal('reprint'), requestId: z.string().uuid(), orderId: z.string().uuid() }),
  z.object({ action: z.literal('availability'), menuItemId: z.string().uuid(), available: z.boolean() }),
  z.object({ action: z.literal('logout') }),
]);

export type WaiterAction = z.infer<typeof actionSchema>;
export type LaunchAction = Extract<WaiterAction, { action: 'launch' }>;

/** A mesa, como o POS a vê (`pos_table_overview`): a mesma conta aberta. */
export type WaiterTable = PosTable;

export type WaiterState = {
  waiter: { id: string; full_name: string; can_charge: boolean };
  store: { name: string; short_name: string; open: boolean; remove_minutes: number };
  /** Meios de pagamento e notas rápidas da loja, para o `resolvePosSettings`. Null = fábrica. */
  pos_config: unknown;
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

export type CloseResult = {
  bill_id: string;
  table_number: number;
  total_cents: number;
  order_count: number;
  duplicate: boolean;
};

/** Um pedido no histórico (`waiter_orders_page`): o mesmo no telemóvel e no painel. */
export type WaiterOrderRow = {
  id: string;
  order_number: string;
  daily_number: number | null;
  table_number: number | null;
  status: string;
  customer_name: string | null;
  total_cents: number;
  created_at: string;
  notes: string | null;
  paid: boolean;
  charged_by_waiter: string | null;
  payments: Array<{ method: string; amount_cents: number }> | null;
  items: Array<{
    name: string;
    variant: string | null;
    qty: number;
    unit_price_cents: number;
    notes: string | null;
    addons: Array<{ name: string; price_cents: number }>;
  }>;
  removed: Array<{
    name: string;
    variant: string | null;
    qty: number;
    removed_cents: number;
    reason: string;
    by_waiter: boolean;
    created_at: string;
  }>;
};

export type WaiterHistory = {
  total: number;
  days: number;
  orders: WaiterOrderRow[];
  summary: { orders: number; revenue_cents: number; avg_ticket_cents: number; tables: number };
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
  waiter_order_not_yours: 'Este pedido foi lançado por outra pessoa. Retira-o no balcão.',
  waiter_remove_window_over: 'Já passou o tempo de retirar aqui. Pede ao balcão.',
  table_order_already_paid: 'Esta conta já foi paga. Fala com o gerente.',
  table_order_not_open: 'Este pedido já não está aberto.',
  order_item_not_found: 'Este artigo já não está no pedido.',
  reason_required: 'Escolhe o motivo.',
  waiter_charge_denied: 'Não tens autorização para cobrar. Fala com o gerente.',
  waiter_cash_not_allowed: 'Dinheiro cobra-se no balcão.',
  table_bill_changed: 'A conta mudou. Confere o total e cobra outra vez.',
  table_has_no_open_orders: 'Esta mesa não tem nada por pagar.',
  payment_total_mismatch: 'O valor não bate com a conta.',
  store_item_not_found: 'Este artigo não é vendido nesta loja.',
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
