/**
 * Um pedido de exemplo para pré-visualizar o talão no painel.
 *
 * Neutro de propósito (§18.3): o painel passa os dados reais da loja e, se
 * quiser, artigos do cardápio dela; sem isso, sai um pedido genérico.
 */

import type { KitchenTicketPayload, TicketViaLabel } from './types';

export interface SampleStore {
  shortName: string;
  address?: string | null;
  phone?: string | null;
  footer?: string | null;
  reviewUrl?: string | null;
  instagram?: string | null;
  instagramUrl?: string | null;
}

export interface SampleItem {
  name: string;
  quantity: number;
  unitPriceCents: number;
  notes?: string | null;
}

const ARTIGOS_DE_EXEMPLO: SampleItem[] = [
  { name: 'Hambúrguer da casa', quantity: 2, unitPriceCents: 30000, notes: 'SEM CEBOLA, SEM MOLHO' },
  { name: 'Batata frita', quantity: 1, unitPriceCents: 15000 },
  { name: 'Refrigerante', quantity: 2, unitPriceCents: 10000 },
];

export function sampleTicket(input: {
  store: SampleStore;
  via: TicketViaLabel | null;
  fulfillment?: 'counter' | 'pickup' | 'delivery';
  items?: SampleItem[];
}): KitchenTicketPayload {
  const artigos = input.items && input.items.length > 0 ? input.items : ARTIGOS_DE_EXEMPLO;
  const fulfillment = input.fulfillment ?? 'delivery';
  const subtotal = artigos.reduce((soma, artigo) => soma + artigo.unitPriceCents * artigo.quantity, 0);
  const taxa = fulfillment === 'delivery' ? 15000 : 0;
  const total = subtotal + taxa;
  return {
    template: 'kitchen',
    formato: 'talao_completo',
    via: input.via,
    store_short_name: input.store.shortName,
    store_address: input.store.address ?? null,
    store_phone: input.store.phone ?? null,
    order_number: 'LOJ-0042',
    daily_number: 42,
    channel: fulfillment,
    fulfillment_type: fulfillment,
    customer_name: 'Maria Silva',
    customer_phone: '84 000 0000',
    delivery_zone: fulfillment === 'delivery' ? 'Centro' : null,
    address: fulfillment === 'delivery' ? 'Av. Principal 100, 2.º andar' : null,
    scheduled_for: null,
    items: artigos.map((artigo) => ({
      name: artigo.name,
      quantity: artigo.quantity,
      notes: artigo.notes ?? null,
      line_total_cents: artigo.unitPriceCents * artigo.quantity,
    })),
    notes: 'Tocar à campainha',
    subtotal_cents: subtotal,
    delivery_fee_cents: taxa,
    discount_cents: 0,
    total_cents: total,
    payment_method: 'mpesa',
    payments: [{ method: 'mpesa', amount_cents: total }],
    review_url: input.store.reviewUrl ?? null,
    instagram: input.store.instagram ?? null,
    instagram_url: input.store.instagramUrl ?? null,
    receipt_footer: input.store.footer ?? null,
    created_at: '2026-01-15T17:30:00.000Z',
  };
}
