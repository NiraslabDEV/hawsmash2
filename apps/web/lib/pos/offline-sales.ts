import type { OfflineSale } from './offline-store';

export type LocalBridgeConfig = { baseUrl: string; token: string };
export type LocalPrintResult = OfflineSale['localPrint'];

export const DEFAULT_LOCAL_BRIDGE_URL = 'http://127.0.0.1:7777';
const BRIDGE_URL_KEY = 'hs_pos_bridge_url';
const BRIDGE_TOKEN_KEY = 'hs_pos_bridge_token';

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function readLocalBridgeConfig(storage: Storage): LocalBridgeConfig | null {
  const baseUrl = storage.getItem(BRIDGE_URL_KEY)?.trim() || DEFAULT_LOCAL_BRIDGE_URL;
  const token = storage.getItem(BRIDGE_TOKEN_KEY)?.trim() ?? '';
  if (token.length < 32) return null;
  try {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return { baseUrl: url.origin, token };
  } catch {
    return null;
  }
}

export function saveLocalBridgeConfig(storage: Storage, config: LocalBridgeConfig): void {
  const url = new URL(config.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || config.token.trim().length < 32) {
    throw new Error('Configuração do bridge inválida');
  }
  storage.setItem(BRIDGE_URL_KEY, url.origin);
  storage.setItem(BRIDGE_TOKEN_KEY, config.token.trim());
}

async function post(
  config: LocalBridgeConfig,
  path: '/print' | '/drawer',
  body: Record<string, unknown>,
  fetcher: Fetcher,
): Promise<boolean> {
  try {
    const response = await fetcher(`${config.baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function printOfflineSale(
  sale: OfflineSale,
  config: LocalBridgeConfig,
  fetcher: Fetcher = fetch,
): Promise<LocalPrintResult> {
  const printedStations = new Set(sale.localPrint.stations);
  for (const station of ['kitchen', 'bar'] as const) {
    const items = sale.items.filter((item) => item.station === station);
    if (items.length === 0 || printedStations.has(station)) continue;
    const ok = await post(config, '/print', {
      requestId: `${sale.clientSaleId}:order:${station}`,
      station,
      kind: 'order',
      payload: {
        template: 'kitchen',
        store_short_name: sale.storeName,
        order_number: sale.localOrderNumber,
        daily_number: sale.localNumber,
        channel: 'counter',
        customer_name: 'Balcão',
        items: items.map((item) => ({ name: item.name, quantity: item.qty })),
        notes: 'VENDA OFFLINE',
        created_at: sale.createdAt,
      },
    }, fetcher);
    if (ok) printedStations.add(station);
  }

  let receipt = sale.localPrint.receipt;
  if (!receipt) {
    receipt = await post(config, '/print', {
      requestId: `${sale.clientSaleId}:receipt:counter`,
      station: 'counter',
      kind: 'receipt',
      payload: {
        template: 'receipt',
        store_short_name: sale.storeName,
        order_number: sale.localOrderNumber,
        daily_number: sale.localNumber,
        customer_name: 'Balcão',
        items: sale.items.map((item) => ({
          name: item.name,
          quantity: item.qty,
          unit_price_cents: item.unitPriceCents,
          line_total_cents: item.unitPriceCents * item.qty,
        })),
        subtotal_cents: sale.totalCents,
        delivery_fee_cents: 0,
        total_cents: sale.totalCents,
        payments: sale.payments.map((payment) => ({
          method: payment.method,
          amount_cents: payment.amountCents,
        })),
        cash_received_cents: sale.cashReceivedCents ?? null,
        change_cents: sale.cashReceivedCents == null
          ? null
          : sale.cashReceivedCents - (sale.payments.find((payment) => payment.method === 'cash')?.amountCents ?? 0),
        receipt_footer: 'VENDA OFFLINE · será sincronizada automaticamente',
        created_at: sale.createdAt,
      },
    }, fetcher);
  }

  let drawer = sale.localPrint.drawer;
  const hasCash = sale.payments.some((payment) => payment.method === 'cash');
  if (hasCash && !drawer) {
    drawer = await post(config, '/drawer', {
      requestId: `${sale.clientSaleId}:drawer:counter`,
    }, fetcher);
  }

  return { receipt, drawer: hasCash ? drawer : true, stations: [...printedStations] };
}
