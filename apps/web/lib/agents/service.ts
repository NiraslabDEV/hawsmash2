import { cents, formatMT } from '@delivery/core';
import { z } from 'zod';
import { encodeAgentHandoff } from './handoff';
import { agentToolSchemas, type AgentOrderInput, type AgentToolName } from './schemas';

export class AgentToolError extends Error {
  constructor(message: string, public readonly code = 'agent_tool_error') { super(message); this.name = 'AgentToolError'; }
}

type AgentDependencies = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  baseUrl: string;
};
const genericError = () => new AgentToolError('Não foi possível consultar o restaurante. Tenta novamente.', 'restaurant_unavailable');
const id = z.string().uuid();
const text = z.string().max(2000);
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const count = z.number().int().nonnegative().max(10000);
const hoursSchema = z.array(z.object({ dow: z.number().int().min(0).max(6), opens: z.string().max(20), closes: z.string().max(20), active: z.boolean() })).max(7);
const storesSchema = z.array(z.object({
  slug: z.string().min(1).max(80), name: text, short_name: text,
  address: text.nullable(), phone: text.nullable(), maps_url: text.nullable(),
  accepting_orders: z.boolean(), delivery_enabled: z.boolean(), pickup_enabled: z.boolean(), open_now: z.boolean(), hours: hoursSchema,
})).max(500);
const optionSchema = z.object({ id, name: text, price_cents: money, active: z.boolean().optional() });
const groupSchema = z.object({
  id, name: text, selection_type: z.enum(['single', 'multi']),
  min_select: count, max_select: count, free_quantity: count, extra_price_cents: money,
  active: z.boolean().optional(), options: z.array(optionSchema).max(100),
});
const itemSchema = z.object({
  id, name: text, description: text.nullable().optional(), price_cents: money, available: z.boolean(),
  available_delivery: z.boolean().optional(), track_stock: z.boolean().optional(), stock_qty: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  calories_kcal: z.number().int().nonnegative().nullable().optional(), allergens: z.array(z.string().max(100)).max(50).optional(),
  variants: z.array(optionSchema.extend({ is_default: z.boolean().optional() })).max(100).default([]),
  addons: z.array(optionSchema).max(100).default([]),
  modifier_groups: z.array(groupSchema).max(50).default([]),
});
const menuSchema = z.object({
  store: z.object({ id, slug: z.string().min(1).max(80), name: text, delivery_enabled: z.boolean(), pickup_enabled: z.boolean() }),
  accepting_orders: z.boolean(),
  categories: z.array(z.object({ id, name: text, items: z.array(itemSchema).max(10000) })).max(1000),
  zones: z.array(z.object({ id, name: text, fee_cents: money })).max(1000),
  hours: hoursSchema,
});
type CatalogueItem = z.infer<typeof itemSchema>;
type Catalogue = z.infer<typeof menuSchema>;
type PublicStore = z.infer<typeof storesSchema>[number];

function checkedMoney(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new AgentToolError('O preço deste pedido não está disponível. Consulta a loja.', 'invalid_catalogue_price');
  return value;
}
function addMoney(left: number, right: number): number { return checkedMoney(left + right); }
function multiplyMoney(value: number, quantity: number): number { return checkedMoney(value * quantity); }
function publicHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function publicStore(store: PublicStore) {
  return { slug: store.slug, name: store.name, shortName: store.short_name, address: store.address, phone: store.phone, mapsUrl: publicHttpUrl(store.maps_url), acceptingOrders: store.accepting_orders, deliveryEnabled: store.delivery_enabled, pickupEnabled: store.pickup_enabled, openNow: store.open_now, hours: store.hours };
}
async function callRpc(deps: AgentDependencies, name: 'get_menu' | 'list_public_stores', args?: Record<string, unknown>): Promise<unknown> {
  try {
    const response = await deps.rpc(name, args);
    if (response.error) throw genericError();
    return response.data;
  } catch { throw genericError(); }
}
async function readStores(deps: AgentDependencies): Promise<PublicStore[]> {
  const parsed = storesSchema.safeParse(await callRpc(deps, 'list_public_stores'));
  if (!parsed.success) throw genericError();
  return parsed.data;
}
async function readCatalogue(storeSlug: string, deps: AgentDependencies): Promise<{ menu: Catalogue; store: PublicStore }> {
  // DECISÃO: o catálogo herdado usa delivery também para levantamento; nunca
  // pedir p_channel=null, que publicaria artigos exclusivos de consumo na loja.
  const [rawMenu, stores] = await Promise.all([
    callRpc(deps, 'get_menu', { p_store_slug: storeSlug, p_channel: 'delivery', p_include_unavailable: false }),
    readStores(deps),
  ]);
  const parsed = menuSchema.safeParse(rawMenu);
  if (!parsed.success) throw genericError();
  const store = stores.find((entry) => entry.slug === storeSlug);
  if (!store || parsed.data.store.slug !== storeSlug) throw new AgentToolError('A loja escolhida não está disponível. Consulta a lista de lojas.', 'store_unavailable');
  return { menu: parsed.data, store };
}
function checkChannel(menu: Catalogue, store: PublicStore, channel: 'delivery' | 'pickup'): void {
  const enabled = channel === 'delivery'
    ? menu.store.delivery_enabled && store.delivery_enabled
    : menu.store.pickup_enabled && store.pickup_enabled;
  if (!enabled) throw new AgentToolError('Este serviço não está disponível na loja escolhida. Escolhe outro serviço ou outra loja.', 'channel_unavailable');
}
function usableItem(item: CatalogueItem): boolean {
  return item.available && item.available_delivery !== false
    && !(item.track_stock && typeof item.stock_qty === 'number' && item.stock_qty <= 0);
}
function publicOption(option: z.infer<typeof optionSchema>) {
  return { id: option.id, name: option.name, priceCents: option.price_cents };
}
function publicItem(item: CatalogueItem, category: { id: string; name: string }) {
  return {
    id: item.id, name: item.name, description: item.description ?? null,
    categoryId: category.id, categoryName: category.name,
    priceCents: item.price_cents, priceFormatted: formatMT(cents(item.price_cents)), available: usableItem(item),
    caloriesKcal: item.calories_kcal ?? null, allergens: item.allergens ?? [],
    variants: item.variants.filter((variant) => variant.active !== false).map((variant) => ({ ...publicOption(variant), isDefault: variant.is_default === true })),
    addons: item.addons.filter((addon) => addon.active !== false).map(publicOption),
    modifierGroups: item.modifier_groups.filter((group) => group.active !== false).map((group) => ({
      id: group.id, name: group.name, selectionType: group.selection_type, minSelect: group.min_select, maxSelect: group.max_select,
      freeQuantity: group.free_quantity, extraPriceCents: group.extra_price_cents,
      options: group.options.filter((option) => option.active !== false).map(publicOption),
    })),
  };
}

const QUOTE_NOTICE = 'Estimativa com os preços actuais, sem cupões. Não reserva stock nem cria uma encomenda. Preços, disponibilidade e total são novamente validados ao concluir no site.';

function quoteLine(line: AgentOrderInput['items'][number], item: CatalogueItem) {
  let unitPriceCents = item.price_cents;
  let variantName: string | undefined;
  const variants = item.variants.filter((variant) => variant.active !== false);
  if (variants.length && !line.variantId) throw new AgentToolError('Escolhe uma variante para este produto antes de calcular o pedido.', 'variant_required');
  if (line.variantId) {
    const variant = variants.find((entry) => entry.id === line.variantId);
    if (!variant) throw new AgentToolError('A variante escolhida não pertence a este produto ou está indisponível.', 'invalid_variant');
    unitPriceCents = variant.price_cents;
    variantName = variant.name;
  }
  const addonNames: string[] = [];
  for (const addonId of line.addonIds ?? []) {
    const addon = item.addons.find((entry) => entry.id === addonId && entry.active !== false);
    if (!addon) throw new AgentToolError('Um adicional escolhido não pertence a este produto ou está indisponível.', 'invalid_addon');
    unitPriceCents = addMoney(unitPriceCents, addon.price_cents);
    addonNames.push(addon.name);
  }
  const groups = item.modifier_groups.filter((group) => group.active !== false);
  if ((line.modifiers ?? []).some((selection) => !groups.some((group) => group.id === selection.groupId))) throw new AgentToolError('Um grupo de escolhas não pertence a este produto.', 'invalid_modifier_group');
  const modifierNames: string[] = [];
  for (const group of groups) {
    const ids = line.modifiers?.find((entry) => entry.groupId === group.id)?.optionIds ?? [];
    if (ids.length < group.min_select || ids.length > group.max_select || (group.selection_type === 'single' && ids.length > 1)) throw new AgentToolError('Completa as escolhas obrigatórias e respeita o limite de cada grupo do produto.', 'invalid_modifier_count');
    for (const optionId of ids) {
      const option = group.options.find((entry) => entry.id === optionId && entry.active !== false);
      if (!option) throw new AgentToolError('Uma opção escolhida não pertence ao grupo indicado ou está indisponível.', 'invalid_modifier_option');
      unitPriceCents = addMoney(unitPriceCents, option.price_cents);
      modifierNames.push(`${group.name}: ${option.name}`);
    }
    unitPriceCents = addMoney(unitPriceCents, multiplyMoney(Math.max(ids.length - group.free_quantity, 0), group.extra_price_cents));
  }
  return { menuItemId: line.menuItemId, name: item.name, qty: line.qty, unitPriceCents, lineTotalCents: multiplyMoney(unitPriceCents, line.qty), ...(variantName ? { variantName } : {}), addonNames, modifierNames };
}

async function quoteOrder(input: AgentOrderInput, deps: AgentDependencies): Promise<Record<string, unknown>> {
  const { menu, store } = await readCatalogue(input.storeSlug, deps);
  checkChannel(menu, store, input.fulfillmentType);
  if (!menu.accepting_orders || !store.accepting_orders) throw new AgentToolError('A loja não está a aceitar pedidos neste momento.', 'orders_paused');
  const catalogue = new Map(menu.categories.flatMap((category) => category.items).map((item) => [item.id, item]));
  const quantities = new Map<string, number>();
  for (const line of input.items) quantities.set(line.menuItemId, (quantities.get(line.menuItemId) ?? 0) + line.qty);
  const lines = input.items.map((line) => {
    const item = catalogue.get(line.menuItemId);
    if (!item || !usableItem(item)) throw new AgentToolError('Um produto escolhido está indisponível nesta loja. Consulta novamente o cardápio.', 'item_unavailable');
    // O RPC anónimo só expõe disponibilidade. Se o catálogo fornecer uma
    // quantidade pública, validá-la agregada; nunca afirmar que há uma reserva.
    if (item.track_stock && typeof item.stock_qty === 'number' && item.stock_qty < (quantities.get(line.menuItemId) ?? 0)) throw new AgentToolError('A quantidade escolhida ultrapassa o stock disponível deste produto.', 'insufficient_stock');
    return quoteLine(line, item);
  });
  const zone = input.fulfillmentType === 'delivery' ? menu.zones.find((entry) => entry.id === input.deliveryZoneId) : undefined;
  if (input.fulfillmentType === 'delivery' && !zone) throw new AgentToolError('A zona de entrega escolhida não está disponível nesta loja.', 'invalid_delivery_zone');
  const subtotalCents = lines.reduce((sum, line) => addMoney(sum, line.lineTotalCents), 0);
  const deliveryFeeCents = zone?.fee_cents ?? 0;
  const totalCents = addMoney(subtotalCents, deliveryFeeCents);
  return { ...input, storeName: store.name, ...(zone ? { deliveryZoneName: zone.name } : {}), lines, subtotalCents, deliveryFeeCents, totalCents, totalFormatted: formatMT(cents(totalCents)), currency: 'MZN', requiresScheduling: !store.open_now, hours: menu.hours, notice: QUOTE_NOTICE };
}

export async function executeAgentTool(name: AgentToolName, args: unknown, deps: AgentDependencies): Promise<Record<string, unknown>> {
  if (name === 'list_stores') {
    agentToolSchemas.list_stores.parse(args);
    return { stores: (await readStores(deps)).map(publicStore), timezone: 'Africa/Maputo' };
  }
  if (name === 'get_menu') {
    const input = agentToolSchemas.get_menu.parse(args);
    const { menu, store } = await readCatalogue(input.storeSlug, deps);
    checkChannel(menu, store, input.fulfillmentType);
    const search = (input.query ?? '').toLocaleLowerCase('pt-PT');
    const matches = menu.categories.flatMap((category) => category.items.filter((item) => usableItem(item) && (!search || `${item.name} ${item.description ?? ''} ${category.name}`.toLocaleLowerCase('pt-PT').includes(search))).map((item) => ({ item, category })));
    const page = matches.slice(input.offset, input.offset + input.limit);
    return {
      store: publicStore(store), storeSlug: input.storeSlug, fulfillmentType: input.fulfillmentType, currency: 'MZN', timezone: 'Africa/Maputo',
      acceptingOrders: menu.accepting_orders && store.accepting_orders,
      categories: [...new Map(page.map(({ category }) => [category.id, { id: category.id, name: category.name }])).values()],
      items: page.map(({ item, category }) => publicItem(item, category)),
      zones: menu.zones.map((zone) => ({ id: zone.id, name: zone.name, feeCents: zone.fee_cents, feeFormatted: formatMT(cents(zone.fee_cents)) })),
      hours: menu.hours,
      pagination: { offset: input.offset, limit: input.limit, total: matches.length, nextOffset: input.offset + input.limit < matches.length ? input.offset + input.limit : null },
      notice: 'Disponibilidade indicativa, sem reserva de stock. As escolhas e o total são validados no checkout. Os alergénios apresentados são apenas os registados pela loja; ausência de informação não garante ausência de alergénios.',
    };
  }
  if (name === 'quote_order' || name === 'prepare_checkout') {
    const input = agentToolSchemas[name].parse(args);
    const quote = await quoteOrder(input, deps);
    if (name === 'quote_order') return quote;
    let base: URL;
    try { base = new URL(deps.baseUrl); } catch { throw genericError(); }
    if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password) throw genericError();
    const url = new URL('/pedido-assistido', base.origin);
    try { url.hash = encodeAgentHandoff(input); } catch { throw new AgentToolError('A selecção é demasiado extensa. Reduz as escolhas e tenta novamente.', 'selection_too_large'); }
    return { ...quote, checkoutUrl: url.href };
  }
  throw new AgentToolError('Ferramenta não disponível neste canal público.', 'unknown_tool');
}
