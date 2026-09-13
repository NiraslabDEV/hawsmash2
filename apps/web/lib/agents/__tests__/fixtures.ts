export const agentIds = {
  store: '10000000-0000-4000-8000-000000000001',
  category: '10000000-0000-4000-8000-000000000002',
  item: '10000000-0000-4000-8000-000000000003',
  variant: '10000000-0000-4000-8000-000000000004',
  addon: '10000000-0000-4000-8000-000000000005',
  group: '10000000-0000-4000-8000-000000000006',
  option: '10000000-0000-4000-8000-000000000007',
  otherOption: '10000000-0000-4000-8000-000000000008',
  zone: '10000000-0000-4000-8000-000000000009',
};
export const agentStoresFixture = [{
  slug: 'loja-teste', name: 'PLACEHOLDER_LOJA_TESTE', short_name: 'PLACEHOLDER_TESTE',
  address: null, phone: null, maps_url: null, accepting_orders: true,
  delivery_enabled: true, pickup_enabled: true, open_now: true,
  hours: [{ dow: 1, opens: '10:00:00', closes: '22:00:00', active: true }],
}];
export const agentMenuFixture = {
  store: { id: agentIds.store, ...agentStoresFixture[0] }, accepting_orders: true,
  payment_provider: 'manual', mpesa_number: 'PLACEHOLDER_NAO_EXPOR',
  hours: agentStoresFixture[0].hours,
  zones: [{ id: agentIds.zone, name: 'PLACEHOLDER_ZONA_TESTE', fee_cents: 15000, sort: 0 }],
  categories: [{ id: agentIds.category, name: 'PLACEHOLDER_CATEGORIA_TESTE', items: [{
    id: agentIds.item, name: 'PLACEHOLDER_PRODUTO_TESTE', description: 'Produto de teste',
    price_cents: 30000, available: true, photo_url: null,
    variants: [{ id: agentIds.variant, name: 'PLACEHOLDER_VARIANTE_TESTE', price_cents: 40000, is_default: true }],
    addons: [{ id: agentIds.addon, name: 'PLACEHOLDER_ADICIONAL_TESTE', price_cents: 2500 }],
    modifier_groups: [{ id: agentIds.group, name: 'PLACEHOLDER_ESCOLHA_TESTE', selection_type: 'multi', min_select: 1, max_select: 2, free_quantity: 1, extra_price_cents: 1000,
      options: [{ id: agentIds.option, name: 'PLACEHOLDER_OPCAO_TESTE', price_cents: 500 }, { id: agentIds.otherOption, name: 'PLACEHOLDER_OUTRA_OPCAO_TESTE', price_cents: 0 }],
    }],
  }] }],
};
export const agentOrderFixture = {
  storeSlug: 'loja-teste', fulfillmentType: 'delivery' as const, deliveryZoneId: agentIds.zone,
  items: [{ menuItemId: agentIds.item, qty: 2, variantId: agentIds.variant, addonIds: [agentIds.addon], modifiers: [{ groupId: agentIds.group, optionIds: [agentIds.option, agentIds.otherOption] }] }],
};
