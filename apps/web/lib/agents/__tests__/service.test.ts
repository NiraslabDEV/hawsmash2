import { describe, expect, it, vi } from 'vitest';
import { executeAgentTool, AgentToolError } from '../service';
import { agentOrderSchema } from '../schemas';
import { decodeAgentHandoff, encodeAgentHandoff } from '../handoff';
import { agentIds, agentMenuFixture, agentOrderFixture, agentStoresFixture } from './fixtures';

function setup() {
  const menu = structuredClone(agentMenuFixture);
  const stores = structuredClone(agentStoresFixture);
  const rpc = vi.fn(async (name: string) => ({ data: name === 'get_menu' ? menu : stores, error: null }));
  return { menu, stores, rpc, deps: { rpc, baseUrl: 'https://restaurante.example' } };
}
describe('ferramentas públicas de agentes', () => {
  it('calcula preços do catálogo da loja: variante substitui base, extras e entrega somam em centavos', async () => {
    const { deps, rpc } = setup();
    const quote = await executeAgentTool('quote_order', agentOrderFixture, deps);
    expect(quote).toMatchObject({ subtotalCents: 88000, deliveryFeeCents: 15000, totalCents: 103000, currency: 'MZN', requiresScheduling: false });
    expect(quote.lines).toMatchObject([{ qty: 2, unitPriceCents: 44000, lineTotalCents: 88000 }]);
    expect(quote.totalFormatted).toMatch(/MT$/);
    expect(rpc).toHaveBeenCalledWith('get_menu', { p_store_slug: 'loja-teste', p_channel: 'delivery', p_include_unavailable: false });
    expect(rpc.mock.calls.every(([name]) => ['get_menu', 'list_public_stores'].includes(name))).toBe(true);
  });
  it('rejeita preços, notas, dados pessoais, campos extra e IDs/quantidades inválidos', () => {
    for (const extra of [{ price: 1 }, { customerPhone: 'PLACEHOLDER_TELEFONE' }, { checkoutUrl: 'https://evil.example' }]) expect(agentOrderSchema.safeParse({ ...agentOrderFixture, ...extra }).success).toBe(false);
    for (const extra of [{ price_cents: 1 }, { notes: 'dados pessoais' }, { qty: 0 }, { qty: 1.2 }, { qty: 51 }, { menuItemId: '../admin' }]) expect(agentOrderSchema.safeParse({ ...agentOrderFixture, items: [{ ...agentOrderFixture.items[0], ...extra }] }).success).toBe(false);
    expect(agentOrderSchema.safeParse({ ...agentOrderFixture, items: Array(21).fill(agentOrderFixture.items[0]) }).success).toBe(false);
    expect(agentOrderSchema.safeParse({ ...agentOrderFixture, items: Array(3).fill({ ...agentOrderFixture.items[0], qty: 50 }) }).success).toBe(false);
  });
  it('rejeita opções duplicadas, adicionais duplicados e grupos duplicados', () => {
    const item = agentOrderFixture.items[0];
    for (const extra of [{ addonIds: [agentIds.addon, agentIds.addon] }, { modifiers: [item.modifiers[0], item.modifiers[0]] }, { modifiers: [{ groupId: agentIds.group, optionIds: [agentIds.option, agentIds.option] }] }]) expect(agentOrderSchema.safeParse({ ...agentOrderFixture, items: [{ ...item, ...extra }] }).success).toBe(false);
  });
  it('rejeita produto/variante/adicional/grupo/opção de outra loja ou produto e escolhas obrigatórias omitidas', async () => {
    const { deps } = setup();
    const item = agentOrderFixture.items[0];
    for (const extra of [{ menuItemId: agentIds.zone }, { variantId: agentIds.zone }, { addonIds: [agentIds.zone] }, { modifiers: [] }, { modifiers: [{ groupId: agentIds.zone, optionIds: [agentIds.option] }] }, { modifiers: [{ groupId: agentIds.group, optionIds: [agentIds.zone] }] }]) await expect(executeAgentTool('quote_order', { ...agentOrderFixture, items: [{ ...item, ...extra }] }, deps)).rejects.toBeInstanceOf(AgentToolError);
  });
  it('exige escolha explícita da variante e zona válida, sem escolher loja automaticamente', async () => {
    const { deps } = setup();
    await expect(executeAgentTool('quote_order', { ...agentOrderFixture, items: [{ menuItemId: agentIds.item, qty: 1, modifiers: agentOrderFixture.items[0].modifiers }] }, deps)).rejects.toBeInstanceOf(AgentToolError);
    await expect(executeAgentTool('quote_order', { ...agentOrderFixture, deliveryZoneId: agentIds.item }, deps)).rejects.toBeInstanceOf(AgentToolError);
    await expect(executeAgentTool('get_menu', {}, deps)).rejects.toThrow();
    await expect(executeAgentTool('get_menu', { storeSlug: 'outra-loja' }, deps)).rejects.toBeInstanceOf(AgentToolError);
  });
  it('pickup usa o catálogo público delivery, sem taxa e sem aceitar zona', async () => {
    const { deps } = setup();
    const { deliveryZoneId: _zone, ...input } = agentOrderFixture;
    const result = await executeAgentTool('quote_order', { ...input, fulfillmentType: 'pickup' }, deps);
    expect(result).toMatchObject({ totalCents: 88000, deliveryFeeCents: 0 });
    expect(agentOrderSchema.safeParse({ ...agentOrderFixture, fulfillmentType: 'pickup' }).success).toBe(false);
  });
  it('bloqueia kill switch, canais desligados e catálogo de loja diferente', async () => {
    for (const mutate of [({ menu }: ReturnType<typeof setup>) => { menu.accepting_orders = false; }, ({ stores }: ReturnType<typeof setup>) => { stores[0].delivery_enabled = false; }, ({ menu }: ReturnType<typeof setup>) => { menu.store.slug = 'outra-loja'; }]) {
      const current = setup(); mutate(current);
      await expect(executeAgentTool('quote_order', agentOrderFixture, current.deps)).rejects.toBeInstanceOf(AgentToolError);
    }
  });
  it('loja fechada exige agendamento e não promete disponibilidade reservada', async () => {
    const { deps, stores } = setup(); stores[0].open_now = false;
    const result = await executeAgentTool('quote_order', agentOrderFixture, deps);
    expect(result).toMatchObject({ requiresScheduling: true, hours: stores[0].hours });
    expect(result.notice).toMatch(/não reserva stock/i);
  });
  it('rejeita esgotados e nunca apresenta stock limitado como reserva', async () => {
    const { deps, menu } = setup(); menu.categories[0].items[0].available = false;
    await expect(executeAgentTool('quote_order', agentOrderFixture, deps)).rejects.toBeInstanceOf(AgentToolError);
  });
  it('agrega stock do mesmo produto em várias linhas e omite quantidades internas do cardápio público', async () => {
    const { deps, menu } = setup();
    Object.assign(menu.categories[0].items[0], { track_stock: true, stock_qty: 1 });
    const line = { ...agentOrderFixture.items[0], qty: 1 };
    await expect(executeAgentTool('quote_order', { ...agentOrderFixture, items: [line, line] }, deps)).rejects.toThrow('A quantidade escolhida ultrapassa o stock disponível deste produto.');
    const listed = await executeAgentTool('get_menu', { storeSlug: 'loja-teste' }, deps);
    expect(JSON.stringify(listed)).not.toMatch(/stock_qty|track_stock/);
  });
  it('trava preços negativos, fracções e overflow de soma ou multiplicação', async () => {
    for (const price of [-1, 1.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
      const { deps, menu } = setup(); menu.categories[0].items[0].variants[0].price_cents = price;
      await expect(executeAgentTool('quote_order', agentOrderFixture, deps)).rejects.toBeInstanceOf(AgentToolError);
    }
  });
  it('faz allowlist recursiva de campos e pagina produtos pesquisados', async () => {
    const { deps, menu, stores } = setup();
    Object.assign(menu, { service_key: 'SEGREDO', company_cost: 10 });
    Object.assign(menu.categories[0].items[0], { cost_cents: 800, secret: 'SEGREDO' });
    Object.assign(menu.categories[0].items[0].variants[0], { cost_cents: 900 });
    Object.assign(menu.categories[0].items[0].modifier_groups[0].options[0], { secret: 'SEGREDO' });
    Object.assign(stores[0], { paysuite_api_key: 'SEGREDO', owner_email: 'SEGREDO' });
    for (const name of ['get_menu', 'list_stores'] as const) {
      const result = await executeAgentTool(name, name === 'get_menu' ? { storeSlug: 'loja-teste', query: 'produto', limit: 1 } : {}, deps);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/SEGREDO|cost_cents|payment_provider|mpesa_number|owner_email/);
      if (name === 'get_menu') expect(result).toMatchObject({ items: [{ id: agentIds.item }], pagination: { offset: 0, limit: 1, total: 1, nextOffset: null } });
    }
    expect(await executeAgentTool('get_menu', { storeSlug: 'loja-teste', offset: 1 }, deps)).toMatchObject({ items: [], pagination: { total: 1, nextOffset: null } });
  });
  it('prepare_checkout é repetível, sem escritas, e só transporta escolhas por fragmento', async () => {
    const { deps, rpc } = setup();
    const a = await executeAgentTool('prepare_checkout', agentOrderFixture, deps);
    const b = await executeAgentTool('prepare_checkout', agentOrderFixture, deps);
    expect(a).toEqual(b);
    const url = new URL(a.checkoutUrl as string);
    expect(url.origin).toBe(deps.baseUrl); expect(url.pathname).toBe('/pedido-assistido'); expect(url.search).toBe('');
    expect(decodeAgentHandoff(url.hash)).toEqual(agentOrderFixture);
    expect(decodeURIComponent(url.hash)).not.toMatch(/price|total|phone|customer|notes/);
    expect(rpc.mock.calls.every(([name]) => ['get_menu', 'list_public_stores'].includes(name))).toBe(true);
  });
  it('não propaga erros internos das RPCs', async () => {
    const deps = { baseUrl: 'https://restaurante.example', rpc: vi.fn(async () => ({ data: null, error: { message: 'SEGREDO_DO_SERVIDOR' } })) };
    await expect(executeAgentTool('list_stores', {}, deps)).rejects.toThrow('Não foi possível consultar o restaurante. Tenta novamente.');
  });
});
describe('handoff sem dados pessoais', () => {
  it('valida versão, tamanho, formato e campos, incluindo conteúdo forjado', () => {
    expect(decodeAgentHandoff(encodeAgentHandoff(agentOrderFixture))).toEqual(agentOrderFixture);
    for (const hash of ['', '#cart=%', '#cart=' + 'a'.repeat(24001), '#cart=' + encodeURIComponent(JSON.stringify({ v: 2, selection: agentOrderFixture })), '#cart=' + encodeURIComponent(JSON.stringify({ v: 1, selection: { ...agentOrderFixture, customerPhone: 'SEGREDO' } }))]) expect(() => decodeAgentHandoff(hash)).toThrow();
  });
});
