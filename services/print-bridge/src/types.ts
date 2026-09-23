// Print-bridge types — single-tenant (sem tenant_id)
import type { PrintPayload } from '@delivery/receipt';

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

// Os payloads (o que chega para imprimir) vivem em @delivery/receipt, partilhados
// com a pré-visualização do painel. Re-exportados aqui para o resto do bridge.
export type {
  CashClosePayload,
  CustomerReceiptPayload,
  KitchenTicketPayload,
  PrintItemModifier,
  PrintJobPayload,
  PrintPayload,
  TestPrintPayload,
} from '@delivery/receipt';
export { isCashClosePayload, isCustomerReceipt, isKitchenTicket, isTestPayload } from '@delivery/receipt';

export interface EventLog {
  id: number;
  order_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}
