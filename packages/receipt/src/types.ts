/**
 * O que chega para imprimir — o `payload` de cada `print_jobs`, montado pela
 * base de dados (1062–1064) ou pelo POS, na rede local, quando está sem rede.
 *
 * Moveram-se do print-bridge para aqui para o painel poder desenhar a mesma
 * pré-visualização; o bridge re-exporta-os (`services/print-bridge/src/types.ts`).
 */

import type { SenhaSlipPayload } from './senha';

export interface PrintItemModifier {
  group_name: string;
  options: Array<{ name: string }>;
}

/** O formato herdado do motor: comanda de mesa. */
export interface PrintJobPayload {
  order_number: string; // "ENC-0042"
  customer_name: string;
  fulfillment_type: 'pickup' | 'delivery' | 'dine_in';
  delivery_zone?: string | null;
  address?: string | null;
  table_number?: number | null; // só dine_in — vai em destaque no talão
  scheduled_for?: string | null; // null = ASAP
  items: Array<{
    name: string;
    quantity: number;
    notes?: string;
    variant?: string | null;
    modifiers?: PrintItemModifier[];
    person?: string | null; // só dine_in — agrupa a comanda por pessoa
  }>;
  // 'no_payment' = mesa; paga-se fisicamente no balcão, fora da app.
  payment_method: 'mpesa' | 'emola' | 'credit_card' | 'cash' | 'no_payment';
  payment_status?: 'paid' | 'pending';
  total_cents: number;
  notes?: string;
  created_at: string;
}

export interface TestPrintPayload {
  test: true;
  message?: string;
}

export type TicketViaLabel = 'controlo' | 'cliente' | 'cozinha' | 'reimpressao' | 'alteracao';

export interface KitchenTicketPayload {
  template: 'kitchen';
  store_short_name: string;
  order_number: string;
  daily_number: number;
  channel: 'counter' | 'delivery' | 'pickup' | 'dine_in';
  /**
   * Como sai o pedido. É isto — e não o `channel` — que a cozinha e o
   * entregador leem: uma entrega vendida ao balcão tem channel='counter'.
   */
  fulfillment_type?: 'counter' | 'delivery' | 'pickup' | 'dine_in' | null;
  /** null numa venda de balcão sem nome: 'Balcão' não é o nome de ninguém. */
  customer_name: string | null;
  customer_phone?: string | null;
  address?: string | null;
  delivery_zone?: string | null;
  /** Hora marcada. null = para já. */
  scheduled_for?: string | null;
  items: Array<{
    name: string;
    quantity: number;
    notes?: string | null;
    /** Só nos pedidos online (via): o talão completo leva o preço de cada linha. */
    line_total_cents?: number | null;
  }>;
  notes?: string | null;
  created_at: string;

  // ── Pedido online (1063): o talão completo do HAWSMASH 1.0, em vias ────────
  // Uma bridge que não conheça estes campos ignora-os e imprime a comanda de
  // cozinha, como antes. É isso que deixa actualizar a base de dados e as
  // bridges das lojas por qualquer ordem.
  /** Presente = pedido online: sai o talão completo em vez da comanda curta. */
  formato?: 'talao_completo';
  /**
   * 'controlo' fica na loja; 'cliente' vai com o pedido; 'cozinha' é a 3.ª via;
   * 'reimpressao' é uma cópia pedida depois e tem de se ver que o é (§7.4);
   * 'alteracao' sai quando o balcão muda a morada ou a hora depois de a
   * comanda ter saído (1072) — substitui a via do saco.
   */
  via?: TicketViaLabel | null;
  /** Só na via 'alteracao': o que mudou ('address' | 'scheduled_for'). */
  alteracoes?: string[] | null;
  /** Venda de balcão (1064): pagamento misto, dinheiro recebido e troco. */
  payments?: Array<{ method: string; amount_cents: number }> | null;
  cash_received_cents?: number | null;
  change_cents?: number | null;
  store_address?: string | null;
  store_phone?: string | null;
  subtotal_cents?: number | null;
  delivery_fee_cents?: number | null;
  discount_cents?: number | null;
  total_cents?: number | null;
  payment_method?: string | null;
  /** Link de avaliação no Google — é o QR do rodapé quando existe. */
  review_url?: string | null;
  /** O Instagram da marca: o texto (@…) e o link, que é o QR quando não há avaliação. */
  instagram?: string | null;
  instagram_url?: string | null;
  receipt_footer?: string | null;
}

export interface CustomerReceiptPayload {
  template: 'receipt';
  store_short_name: string;
  store_address?: string | null;
  store_phone?: string | null;
  receipt_footer?: string | null;
  order_number: string;
  daily_number: number;
  customer_name: string;
  customer_phone?: string | null;
  fulfillment_type?: 'counter' | 'delivery' | 'pickup' | 'dine_in' | null;
  address?: string | null;
  delivery_zone?: string | null;
  scheduled_for?: string | null;
  items: Array<{
    name: string;
    quantity: number;
    unit_price_cents: number;
    line_total_cents: number;
    notes?: string | null;
  }>;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  payments: Array<{ method: string; amount_cents: number }>;
  cash_received_cents?: number | null;
  change_cents?: number | null;
  created_at: string;
}

export interface CashClosePayload {
  template: 'cash_close';
  store_short_name: string;
  shift_label: string;
  opened_at: string;
  closed_at: string;
  opening_float_cents: number;
  cash_sales_cents: number;
  sangria_cents: number;
  reforco_cents: number;
  despesa_cents: number;
  expected_cash_cents: number;
  counted_cash_cents: number;
  difference_cents: number;
  difference_reason?: string | null;
  payments: {
    cash: number;
    mpesa: number;
    emola: number;
    credit_card: number;
  };
  closed_by_name?: string | null;
}

export type PrintPayload =
  | PrintJobPayload
  | TestPrintPayload
  | KitchenTicketPayload
  | CustomerReceiptPayload
  | CashClosePayload
  | SenhaSlipPayload;

export function isTestPayload(p: PrintPayload): p is TestPrintPayload {
  return (p as TestPrintPayload).test === true;
}

export function isKitchenTicket(p: PrintPayload): p is KitchenTicketPayload {
  return (p as KitchenTicketPayload).template === 'kitchen';
}

export function isCustomerReceipt(p: PrintPayload): p is CustomerReceiptPayload {
  return (p as CustomerReceiptPayload).template === 'receipt';
}

export function isCashClosePayload(p: PrintPayload): p is CashClosePayload {
  return (p as CashClosePayload).template === 'cash_close';
}
