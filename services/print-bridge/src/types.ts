// Print-bridge types — single-tenant (sem tenant_id)

export interface PrintJob {
  id: string;
  store_id: string;
  order_id: string | null;
  request_id: string | null;
  claimed_at: string | null;
  station: 'kitchen' | 'counter' | 'bar';
  kind: 'order' | 'receipt' | 'drawer' | 'cash_close' | 'test';
  reprint_seq: number;
  payload: PrintPayload;
  status: 'queued' | 'printing' | 'printed' | 'failed';
  attempts: number;
  created_at: string;
  printed_at: string | null;
}

export interface PrintItemModifier {
  group_name: string;
  options: Array<{ name: string }>;
}

export interface PrintJobPayload {
  order_number: string;        // "ENC-0042"
  customer_name: string;
  fulfillment_type: 'pickup' | 'delivery' | 'dine_in';
  delivery_zone?: string | null;
  address?: string | null;
  table_number?: number | null;   // só dine_in — vai em destaque no talão
  scheduled_for?: string | null;  // null = ASAP
  items: Array<{
    name: string;
    quantity: number;
    notes?: string;
    variant?: string | null;
    modifiers?: PrintItemModifier[];
    person?: string | null;       // só dine_in — agrupa a comanda por pessoa
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
  customer_name: string;
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
  /** 'controlo' fica na loja; 'cliente' vai com o pedido; 'cozinha' é a 3.ª via. */
  via?: 'controlo' | 'cliente' | 'cozinha' | null;
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
  | CashClosePayload;

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

export interface EventLog {
  id: number;
  order_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}
