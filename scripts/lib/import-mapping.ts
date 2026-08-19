/**
 * Tradução do HAWSMASH 1.0 → HAWSMASH 2.0 (CLAUDE.md §15).
 *
 * Funções puras, sem rede: é aqui que se decide o que vira o quê, e é isto que
 * os testes protegem. O script `scripts/import-hawsmash-1.ts` só orquestra.
 *
 * Regra de ouro do dinheiro: o 1.0 guarda **meticais inteiros** (`*_mt`), o 2.0
 * guarda **centavos** (`*_cents`). A conversão acontece num único sítio.
 */

export type LegacyCategory = {
  id: string;
  name: string;
  sort: number | null;
  active: boolean | null;
};

export type LegacyProduct = {
  id: string;
  name: string;
  category_id: string | null;
  description: string | null;
  price_single: number | null;
  price_haw: number | null;
  price_wagyu: number | null;
  image_url: string | null;
  available: boolean | null;
  sort: number | null;
};

export type LegacyOrder = {
  id: string;
  order_number: string | number;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  fulfillment: string | null;
  delivery_address: string | null;
  delivery_zone: string | null;
  payment_method: string | null;
  subtotal_mt: number | null;
  delivery_fee_mt: number | null;
  total_mt: number | null;
  customer_notes: string | null;
  status: string | null;
  created_at: string;
};

export type LegacyOrderItem = {
  order_id: string;
  product_name: string;
  variant: string | null;
  unit_price_mt: number | null;
  qty: number | null;
  line_total_mt: number | null;
};

export class ImportDataError extends Error {}

/** Meticais inteiros do 1.0 → centavos do 2.0. Nunca float pelo caminho. */
export function mtToCents(value: number | null | undefined): number {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new ImportDataError(`Valor monetário inválido no 1.0: ${value}`);
  }
  return Math.round(amount * 100);
}

/** Telefone normalizado para agregar o mesmo cliente vindo de sítios diferentes. */
export function normalizePhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length < 9) return null;
  return digits.startsWith('258') ? digits.slice(-9) : digits.slice(-9);
}

/**
 * O 1.0 tem três colunas de preço (single/haw/wagyu). O 2.0 tem um preço base
 * por item; as variantes já existem no motor, mas a importação fica no preço
 * base para não inventar estrutura — o cliente ajusta no painel se quiser.
 */
export function productBasePriceCents(product: LegacyProduct): number {
  const candidates = [product.price_single, product.price_haw, product.price_wagyu].filter(
    (value): value is number => typeof value === 'number' && value > 0,
  );
  if (candidates.length === 0) {
    throw new ImportDataError(`Produto sem preço no 1.0: ${product.name}`);
  }
  return mtToCents(Math.min(...candidates));
}

export function mapCategory(category: LegacyCategory) {
  return {
    legacy_id: category.id,
    name: category.name.trim(),
    sort: category.sort ?? 0,
    active: category.active ?? true,
    station: 'kitchen' as const,
  };
}

export function mapProduct(product: LegacyProduct, categoryIdByLegacy: Map<string, string>) {
  const categoryId = product.category_id ? categoryIdByLegacy.get(product.category_id) : undefined;
  if (!categoryId) {
    throw new ImportDataError(`Produto sem categoria correspondente: ${product.name}`);
  }
  return {
    legacy_id: product.id,
    category_id: categoryId,
    name: product.name.trim(),
    description: product.description?.trim() || null,
    price_cents: productBasePriceCents(product),
    photo_url: product.image_url || null,
    available: product.available ?? true,
    sort: product.sort ?? 0,
  };
}

/**
 * Estados do 1.0 → máquina de estados do 2.0.
 * `paid` histórico entra como `delivered`: o pedido já foi entregue, e deixá-lo
 * em `paid` punha pedidos antigos a aparecer como activos no painel no dia 1.
 */
export function mapOrderStatus(status: string | null): 'awaiting_approval' | 'delivered' | 'cancelled' {
  switch ((status ?? '').toLowerCase()) {
    case 'paid':
      return 'delivered';
    case 'cancelled':
      return 'cancelled';
    case 'pending':
      return 'awaiting_approval';
    default:
      throw new ImportDataError(`Estado desconhecido no 1.0: ${status}`);
  }
}

export function mapOrder(order: LegacyOrder, storeId: string) {
  const fulfillment = (order.fulfillment ?? 'pickup').toLowerCase() === 'delivery'
    ? 'delivery'
    : 'pickup';
  const subtotal = mtToCents(order.subtotal_mt);
  const fee = fulfillment === 'delivery' ? mtToCents(order.delivery_fee_mt) : 0;
  const total = order.total_mt === null || order.total_mt === undefined
    ? subtotal + fee
    : mtToCents(order.total_mt);

  if (total !== subtotal + fee) {
    throw new ImportDataError(
      `Total inconsistente no pedido ${order.order_number}: ${total} ≠ ${subtotal} + ${fee}`,
    );
  }

  return {
    legacy_id: order.id,
    store_id: storeId,
    order_number: String(order.order_number),
    status: mapOrderStatus(order.status),
    flow: 'manual' as const,
    channel: fulfillment,
    fulfillment_type: fulfillment,
    customer_name: order.customer_name?.trim() || 'Cliente',
    customer_phone: order.customer_phone?.trim() || null,
    customer_email: order.customer_email?.trim() || null,
    address: fulfillment === 'delivery' ? order.delivery_address?.trim() || null : null,
    subtotal_cents: subtotal,
    delivery_fee_cents: fee,
    total_cents: total,
    payment_method: order.payment_method?.trim() || 'mpesa',
    notes: order.customer_notes?.trim() || null,
    created_at: order.created_at,
  };
}

export function mapOrderItem(item: LegacyOrderItem, orderId: string, storeId: string) {
  const qty = Number(item.qty ?? 0);
  if (!Number.isInteger(qty) || qty < 1) {
    throw new ImportDataError(`Quantidade inválida em ${item.product_name}: ${item.qty}`);
  }
  return {
    order_id: orderId,
    store_id: storeId,
    menu_item_id: null,
    name_snapshot: item.variant
      ? `${item.product_name.replace(/\s*\([^)]*\)\s*$/, '')} (${item.variant})`
      : item.product_name,
    qty,
    unit_price_cents: mtToCents(item.unit_price_mt),
    station: 'kitchen' as const,
    notes: null,
  };
}

export type CustomerAggregate = {
  phone: string;
  name: string;
  orders_count: number;
  total_spent_cents: number;
  last_order_at: string;
};

/** Clientes do 2.0 são agregados por telefone a partir do histórico do 1.0. */
export function aggregateCustomers(orders: LegacyOrder[]): CustomerAggregate[] {
  const byPhone = new Map<string, CustomerAggregate>();

  for (const order of orders) {
    const phone = normalizePhone(order.customer_phone);
    if (!phone) continue;
    if ((order.status ?? '').toLowerCase() === 'cancelled') continue;

    const current = byPhone.get(phone);
    const total = mtToCents(order.total_mt);
    if (!current) {
      byPhone.set(phone, {
        phone,
        name: order.customer_name?.trim() || 'Cliente',
        orders_count: 1,
        total_spent_cents: total,
        last_order_at: order.created_at,
      });
      continue;
    }

    current.orders_count += 1;
    current.total_spent_cents += total;
    if (new Date(order.created_at) > new Date(current.last_order_at)) {
      current.last_order_at = order.created_at;
      current.name = order.customer_name?.trim() || current.name;
    }
  }

  return Array.from(byPhone.values()).sort((a, b) => b.orders_count - a.orders_count);
}

export type ImportReport = {
  categories: number;
  products: number;
  orders: number;
  order_items: number;
  customers: number;
  revenue_cents: number;
  skipped: string[];
};

/** Relatório de contagens do dry-run: é isto que se confere com o 1.0. */
export function buildReport(input: {
  categories: LegacyCategory[];
  products: LegacyProduct[];
  orders: LegacyOrder[];
  items: LegacyOrderItem[];
  skipped?: string[];
}): ImportReport {
  const revenue = input.orders
    .filter((order) => (order.status ?? '').toLowerCase() === 'paid')
    .reduce((sum, order) => sum + mtToCents(order.total_mt), 0);

  return {
    categories: input.categories.length,
    products: input.products.length,
    orders: input.orders.length,
    order_items: input.items.length,
    customers: aggregateCustomers(input.orders).length,
    revenue_cents: revenue,
    skipped: input.skipped ?? [],
  };
}
