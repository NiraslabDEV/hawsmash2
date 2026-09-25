/**
 * As mesas da loja no POS (migration 1081).
 *
 * Quem está na mesa 2 pede pelo QR ou ao balcão, e vai tudo para a mesma mesa.
 * A mesa paga no fim, tudo junto: a conta é o que a mesa pediu hoje e ainda não
 * pagou. Quem define a conta é o servidor (`pos_table_overview` e
 * `close_table_bill` usam a mesma função); aqui só se lê, soma e mostra — e o
 * fecho manda o total que o caixa viu, para o servidor recusar se entretanto
 * entrou um pedido.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type TableOrigin = 'qr' | 'pos';

export type TableOrderItem = {
  name: string;
  variant: string | null;
  qty: number;
  unit_price_cents: number;
  notes: string | null;
  person: string | null;
  addons: Array<{ name: string; price_cents: number }>;
};

export type TableOrder = {
  id: string;
  order_number: string;
  daily_number: number | null;
  status: string;
  origin: TableOrigin;
  customer_name: string | null;
  created_at: string;
  total_cents: number;
  notes: string | null;
  items: TableOrderItem[];
};

export type PosTable = {
  id: string;
  number: number;
  active: boolean;
  orders: TableOrder[];
};

export type TableOverview = {
  store_id: string;
  tables: PosTable[];
};

/** A mesa para onde vai o carrinho, ou a conta que se está a fechar. */
export type TableRef = { id: string; number: number; name?: string | null };

export const TABLE_ORDER_STATUS_LABEL: Record<string, string> = {
  in_preparation: 'Em preparo',
  ready: 'Pronto',
  delivered: 'Entregue',
};

/**
 * O nome que sai no ecrã: "Classic Smash WAGYU + Queijo". A mesma regra do
 * talão (1080) e do carrinho (`resolveName`): a variante não se repete quando
 * o nome já a traz.
 */
export function itemLabel(item: TableOrderItem): string {
  const variante = item.variant?.trim();
  const base =
    !variante || item.name.toLowerCase().includes(variante.toLowerCase())
      ? item.name
      : `${item.name} ${variante}`;
  const extras = (item.addons ?? []).map((addon) => addon.name).filter(Boolean);
  return extras.length > 0 ? `${base} + ${extras.join(' + ')}` : base;
}

/**
 * O nome da conta (1092): o último que se escreveu num pedido desta mesa.
 * Fica no pedido como "Mesa 5 · João" — aqui é só "João". Sem nome, null.
 */
export function orderCustomerName(customerName: string | null | undefined): string | null {
  const nome = (customerName ?? '').replace(/^mesa\s+\d+\s*(·\s*)?/i, '').trim();
  return nome || null;
}

export function tableName(table: PosTable): string | null {
  const recentes = [...table.orders].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  for (const order of recentes) {
    const nome = orderCustomerName(order.customer_name);
    if (nome) return nome;
  }
  return null;
}

export function tableTotalCents(table: PosTable): number {
  return table.orders.reduce((soma, order) => soma + order.total_cents, 0);
}

/**
 * O resumo da conta, para conferir antes de cobrar: o mesmo artigo de vários
 * pedidos numa linha só, e o que tem nota à parte — é o que o cliente vê no
 * talão e o que se lhe lê em voz alta.
 */
export function billLines(
  table: PosTable,
): Array<{ key: string; label: string; notes: string | null; qty: number; totalCents: number }> {
  const linhas = new Map<string, { key: string; label: string; notes: string | null; qty: number; totalCents: number }>();
  for (const order of table.orders) {
    for (const item of order.items) {
      const label = itemLabel(item);
      const notes = item.notes?.trim() || null;
      const key = `${label}|${notes ?? ''}`;
      const actual = linhas.get(key) ?? { key, label, notes, qty: 0, totalCents: 0 };
      actual.qty += item.qty;
      actual.totalCents += item.qty * item.unit_price_cents;
      linhas.set(key, actual);
    }
  }
  return [...linhas.values()];
}

/** Minutos desde o primeiro pedido da conta. Null para uma mesa livre. */
export function minutesOpen(table: PosTable, now: Date): number | null {
  if (table.orders.length === 0) return null;
  const primeiro = Math.min(...table.orders.map((order) => new Date(order.created_at).getTime()));
  return Math.max(0, Math.floor((now.getTime() - primeiro) / 60_000));
}

export function tableErrorMessage(message?: string): string {
  if (!message) return 'Não foi possível concluir. Tenta outra vez.';
  if (message.includes('table_bill_changed')) {
    return 'Entrou um pedido novo nesta mesa. Confere a conta e cobra outra vez.';
  }
  if (message.includes('table_has_no_open_orders')) {
    return 'Esta mesa não tem nada por pagar.';
  }
  if (message.includes('invalid_table')) {
    return 'Esta mesa já não existe ou está desactivada. Escolhe outra mesa.';
  }
  if (message.includes('out_of_stock') || message.includes('item_unavailable') || message.includes('out_of_ingredient')) {
    return 'Um dos produtos esgotou. Actualiza o cardápio e confirma o carrinho.';
  }
  if (message.includes('payment_total_mismatch')) return 'As formas de pagamento não fecham o total.';
  if (message.includes('insufficient_cash_received')) return 'O valor recebido em dinheiro é insuficiente.';
  if (message.includes('device_locked')) return 'O POS está bloqueado. Introduz o PIN para continuar.';
  if (message.includes('invalid_or_unauthorised_device')) return 'Este dispositivo perdeu o acesso à loja.';
  if (/fetch|network|connection|offline/i.test(message)) {
    return 'Sem ligação. As mesas precisam de internet — tenta outra vez quando voltar.';
  }
  return message;
}

export async function fetchTableOverview(
  supabase: SupabaseClient,
  deviceId: string,
): Promise<TableOverview> {
  const { data, error } = await supabase.rpc('pos_table_overview', { p_device_id: deviceId });
  if (error || !data) throw new Error(error?.message ?? 'pos_table_overview');
  return data as TableOverview;
}
