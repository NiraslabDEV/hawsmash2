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
  customer_name: string;
  items: Array<{ name: string; quantity: number; notes?: string | null }>;
  notes?: string | null;
  created_at: string;
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

export type PrintPayload =
  | PrintJobPayload
  | TestPrintPayload
  | KitchenTicketPayload
  | CustomerReceiptPayload;

export function isTestPayload(p: PrintPayload): p is TestPrintPayload {
  return (p as TestPrintPayload).test === true;
}

export function isKitchenTicket(p: PrintPayload): p is KitchenTicketPayload {
  return (p as KitchenTicketPayload).template === 'kitchen';
}

export function isCustomerReceipt(p: PrintPayload): p is CustomerReceiptPayload {
  return (p as CustomerReceiptPayload).template === 'receipt';
}

export interface EventLog {
  id: number;
  order_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}
