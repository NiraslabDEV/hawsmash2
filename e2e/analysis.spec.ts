import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const user = { id: '90000000-0000-4000-8000-000000000001', aud: 'authenticated', email: 'PLACEHOLDER@example.invalid' };
const sales = {
  store_id: null, revenue_cents: 1704000, avg_ticket_cents: 43692, total_orders: 39,
  previous: { revenue_cents: 1420000, total_orders: 32 }, avg_time_minutes: 28,
  pickup_vs_delivery: [{ fulfillment_type: 'delivery', count: 4, revenue_cents: 260000 }, { fulfillment_type: 'pickup', count: 35, revenue_cents: 1444000 }],
  top_items: [{ name: 'PLACEHOLDER Classic Smash', qty: 36 }, { name: 'PLACEHOLDER Double Smash', qty: 18 }],
  by_method: [{ method: 'cash', cents: 900000 }, { method: 'mpesa', cents: 804000 }],
  hourly: [{ hour: 12, count: 5 }, { hour: 13, count: 10 }, { hour: 14, count: 19 }, { hour: 15, count: 5 }],
  top_customers: [{ customer_name: 'PLACEHOLDER Cliente', customer_phone: '', order_count: 8, total_cents: 320000 }],
  period_buckets: [220000, 310000, 185000, 460000, 200000, 329000].map((revenue_cents, i) => ({ bucket: `2026-09-${18 + i}T10:00:00Z`, revenue_cents })),
};
const channel = { channel: 'organic_social', sessions: 240, orders: 18, revenue_cents: 830000, conversion_pct: 7.5 };
const acquisition = { totals: { orders: 39, revenue_cents: 1704000, sessions: 480 }, by_channel: [channel, { ...channel, channel: 'direct', sessions: 240, orders: 21, revenue_cents: 874000 }], by_source: [], by_campaign: [{ campaign: 'PLACEHOLDER Campanha', source: 'instagram', channel: 'organic_social', orders: 18, revenue_cents: 830000 }], discovery: [channel] };
const funnel = { funnel: { total_sessions: 480, step_menu: 450, step_cart: 120, step_checkout: 140, step_payment: 70, step_purchase: 39, pct_menu_to_cart: 26.7, pct_cart_to_checkout: 116.7, pct_checkout_to_payment: 50, pct_payment_to_purchase: 55.7, pct_overall: 8.1 }, by_source: [{ channel: 'organic_social', source: 'instagram', medium: 'social', campaign: 'PLACEHOLDER Campanha', sessions: 240, carts: 60, checkouts: 70, purchases: 18, revenue_cents: 830000, pct_cart: 25, pct_conv: 7.5 }] };

async function setup(page: Page, state: { fail: boolean; empty: boolean; slow: boolean; manager: boolean; noStore?: boolean; failSales?: boolean } = { fail: false, empty: false, slow: false, manager: false }) {
  const requests: Array<{ name: string; params: Record<string, unknown> }> = [];
  await page.addInitScript((u) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = [btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), btoa(JSON.stringify({ sub: u.id, role: 'authenticated', exp })), 'PLACEHOLDER_SIGNATURE'].join('.');
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: token, refresh_token: 'PLACEHOLDER_REFRESH', expires_at: exp, expires_in: 3600, token_type: 'bearer', user: u }));
  }, user);
  await page.route('http://127.0.0.1:3020/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1)!;
    const params = route.request().postDataJSON() ?? {};
    let body: unknown = {};
    let status = 200;
    if (name === 'user') body = user;
    if (name === 'staff_profiles') body = { role: state.manager ? 'manager' : 'owner' };
    if (name === 'staff_stores') body = state.noStore ? [] : [{ store_id: 'store-b' }];
    if (name === 'stores') body = [{ id: 'store-a', short_name: 'Loja A' }, { id: 'store-b', short_name: 'Loja B' }];
    if (name === 'settings') body = { accepting_orders: true };
    if (name.startsWith('get_')) requests.push({ name, params });
    if (name === 'get_sales_metrics') {
      if (state.slow && params.p_store_id === 'store-a') await new Promise((r) => setTimeout(r, 700));
      body = { ...sales, total_orders: params.p_store_id === 'store-b' ? 8 : params.p_store_id === 'store-a' ? 99 : 39 };
      if (state.empty) body = { ...sales, revenue_cents: 0, avg_ticket_cents: 0, total_orders: 0, avg_time_minutes: 0, previous: null, pickup_vs_delivery: [], top_items: [], by_method: [], hourly: [], top_customers: [], period_buckets: [] };
    }
    if (name === 'get_upsell_metrics') body = {orders:2,units:3,revenue_cents:15000,margin_cents:null,lines_without_cost:1,views:10,accepts:3,products:[{menu_item_id:'test',name_snapshot:'PLACEHOLDER Oferta',kind:'companion',placement:'online_companion',units:3,orders:2,revenue_cents:15000,margin_cents:null,lines_without_cost:1}]};
    if (name === 'get_funnel_metrics') body = state.empty ? { ...funnel, funnel: { ...funnel.funnel, total_sessions: 0, step_menu: 0, step_cart: 0, step_checkout: 0, step_payment: 0, step_purchase: 0, pct_overall: null }, by_source: [] } : funnel;
    if (name === 'get_attribution_report') body = state.empty ? { ...acquisition, totals: { orders: 0, revenue_cents: 0, sessions: 0 }, by_channel: [], by_campaign: [], discovery: [] } : acquisition;
    if (state.failSales && name === 'get_sales_metrics') { status = 503; body = { message: 'PLACEHOLDER_FAILURE' }; }
    if (state.fail && ['get_funnel_metrics', 'get_attribution_report'].includes(name)) { status = 503; body = { message: 'PLACEHOLDER_FAILURE' }; }
    await route.fulfill({ status, json: body, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } }).catch(() => {});
  });
  await page.goto('/analise');
  await expect(page.getByRole('heading', { name: 'Análise', exact: true })).toBeVisible();
  if (state.noStore || state.failSales) await expect(page.locator('.insights').getByRole('alert')).toBeVisible();
  else await expect(page.locator('.insight-metric').first()).toBeVisible();
  return requests;
}

async function audit(page: Page) {
  const result = await new AxeBuilder({ page }).include('.insights').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('vendas e aquisição: desktop, contraste AA, teclado e versão móvel', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await setup(page);
  await expect(page.locator('.insight-metric').first()).toContainText('17');
  await audit(page);
  await page.screenshot({ path: 'output/playwright/analysis-vendas-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Aquisição', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Sessões no site')).toBeVisible();
  await audit(page);
  await page.screenshot({ path: 'output/playwright/analysis-aquisicao-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await audit(page);
  await page.screenshot({ path: 'output/playwright/analysis-aquisicao-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Vendas', exact: true }).click();
  await audit(page);
  await page.screenshot({ path: 'output/playwright/analysis-vendas-mobile.png', fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '30 dias' }).click();
  await expect(page.locator('.insight-metric').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('filtros preservados nas duas vistas e respostas atrasadas ignoradas', async ({ page }) => {
  const requests = await setup(page, { fail: false, empty: false, slow: true, manager: false });
  await page.getByRole('button', { name: 'Loja A', exact: true }).click();
  await expect.poll(() => requests.some((r) => r.params.p_store_id === 'store-a')).toBe(true);
  await page.getByRole('button', { name: 'Loja B', exact: true }).click();
  await expect(page.locator('.insight-metric').nth(1)).toContainText('8');
  await page.waitForTimeout(900);
  await expect(page.locator('.insight-metric').nth(1)).toContainText('8');
  await page.getByRole('button', { name: '30 dias' }).click();
  await page.getByRole('button', { name: 'Aquisição', exact: true }).click();
  await expect(page.getByText('Sessões no site')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Loja B', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const last = requests.filter((r) => r.name === 'get_funnel_metrics').at(-1)!;
  expect(last.params.p_store_id).toBe('store-b');
  expect(Math.round((Date.now() - Date.parse(last.params.p_from as string)) / 86400000)).toBe(30);
});

test('falha de aquisição não oculta vendas e permite repetir', async ({ page }) => {
  const state = { fail: true, empty: false, slow: false, manager: false };
  await setup(page, state);
  await page.getByRole('button', { name: 'Aquisição', exact: true }).click();
  await expect(page.locator('.insights').getByRole('alert')).toContainText('indisponíveis');
  state.fail = false;
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByText('Sessões no site')).toBeVisible();
  await expect(page.locator('.insights').getByRole('alert')).toHaveCount(0);
});

test('estados vazios são explícitos nas duas vistas', async ({ page }) => {
  await setup(page, { fail: false, empty: true, slow: false, manager: false });
  await expect(page.getByText('Ainda não há vendas neste período')).toBeVisible();
  await page.getByRole('button', { name: 'Aquisição', exact: true }).click();
  await expect(page.getByText('Sem sessões neste período.')).toBeVisible();
  await audit(page);
});

test('gerente só dispõe da sua loja e exportação usa Maputo', async ({ page }) => {
  const requests = await setup(page, { fail: false, empty: false, slow: false, manager: true });
  await expect(page.getByRole('button', { name: 'Todas', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Loja A', exact: true })).toHaveCount(0);
  expect(requests.filter((r) => r.name === 'get_sales_metrics').every((r) => r.params.p_store_id === 'store-b')).toBe(true);
  await page.getByLabel('De', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Até', { exact: true }).fill('2026-09-24');
  let url = '';
  await page.route('**/api/reports/export-sales?**', async (route) => { url = route.request().url(); await route.fulfill({ contentType: 'text/csv', body: 'data,valor\n2026-09-01,100' }); });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descarregar CSV' }).click();
  expect((await download).suggestedFilename()).toBe('pagamentos-2026-09-01-a-2026-09-24.csv');
  const params = new URL(url).searchParams;
  expect(params.get('from')).toBe('2026-08-31T22:00:00.000Z');
  expect(params.get('to')).toBe('2026-09-24T22:00:00.000Z');
  expect(params.get('store_id')).toBe('store-b');
});


test('falha das vendas mantém aquisição disponível e recupera sem recarregar', async ({ page }) => {
  const state = { fail: false, empty: false, slow: false, manager: false, failSales: true };
  await setup(page, state);
  await expect(page.locator('.insights').getByRole('alert')).toContainText('As vendas estão indisponíveis');
  await page.getByRole('button', { name: 'Aquisição', exact: true }).click();
  await expect(page.getByText('Sessões no site')).toBeVisible();
  await page.getByRole('button', { name: 'Vendas', exact: true }).click();
  state.failSales = false;
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.locator('.insight-metric').first()).toBeVisible();
});

test('gerente sem loja não consulta métricas consolidadas', async ({ page }) => {
  const requests = await setup(page, { fail: false, empty: false, slow: false, manager: true, noStore: true });
  await expect(page.locator('.insights').getByRole('alert')).toContainText('Não tem uma loja activa atribuída');
  expect(requests.filter((r) => ['get_sales_metrics', 'get_funnel_metrics', 'get_attribution_report'].includes(r.name))).toEqual([]);
});

test('reflow a 320px, tabelas por teclado e falha de exportação recuperável', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByText('Ver valores do gráfico', { exact: true }).click();
  await expect(page.getByRole('region', { name: 'Valores da facturação' })).toBeVisible();
  await audit(page);
  await page.route('**/api/reports/export-sales?**', (route) => route.fulfill({ status: 503, json: { error: 'Não foi possível gerar o ficheiro.' } }));
  await page.getByRole('button', { name: 'Descarregar CSV' }).click();
  await expect(page.locator('.insight-export').getByRole('alert')).toContainText('Não foi possível gerar');
  await expect(page.getByRole('button', { name: 'Descarregar CSV' })).toBeEnabled();
  await page.getByRole('button', { name: 'Aquisição', exact: true }).click();
  await audit(page);
});


test('download atravessa a API real com sessão do navegador sem cookies de autenticação', async ({ page }) => {
  await setup(page);
  expect((await page.context().cookies()).filter((cookie) => cookie.name.startsWith('sb-'))).toHaveLength(0);
  await page.getByLabel('De', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Até', { exact: true }).fill('2026-09-24');
  await page.getByLabel('Conteúdo').selectOption('orders');
  await page.getByLabel('Formato', { exact: true }).selectOption('standard');
  const [download, response] = await Promise.all([
    page.waitForEvent('download'),
    page.waitForResponse((response) => response.url().includes('/api/reports/export-sales?')),
    page.getByRole('button', { name: 'Descarregar CSV' }).click(),
  ]);
  expect(response.status()).toBe(200);
  expect(response.request().headers().authorization).toMatch(/^Bearer /);
  expect(response.headers()['x-export-payment-count']).toBe('2');
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv.split('\r\n').filter(Boolean)).toHaveLength(2);
  expect(csv).toContain('TESTE-CSV-001');
  expect(csv).toContain(',436.92,436.92,0.00,cash + mpesa,MZN,1');
  await page.getByText('Importar para WinREST ou outro software', { exact: true }).click();
  await expect(page.getByText(/O formato WinREST ainda não está validado/)).toBeVisible();
  await audit(page);
  await page.locator('.insight-export').screenshot({ path: 'output/playwright/analysis-exportacao.png' });
});

 test('POS separado e origem Online enviada ao servidor', async ({page}) => {
  const requests = await setup(page);
  await page.getByRole('group', {name:'Filtrar por origem'}).getByRole('button',{name:'Online',exact:true}).click();
  await expect.poll(() => requests.filter(r => r.name === 'get_sales_metrics').at(-1)?.params.p_origin).toBe('online');
  await page.getByRole('navigation',{name:'Vistas da análise'}).getByRole('button',{name:'POS',exact:true}).click();
  await expect.poll(() => requests.filter(r => r.name === 'get_sales_metrics').at(-1)?.params.p_origin).toBe('pos');
  await expect(page.getByText('O desempenho das vendas criadas no balcão e nas mesas.')).toBeVisible();
  await audit(page);
  await page.setViewportSize({width:320,height:800});
  await audit(page);
  await page.screenshot({path:'output/playwright/analysis-pos-mobile.png',fullPage:true});
 });

test('upsells mostram receita, aceitação e custo desconhecido sem inventar lucro', async ({page}) => {
 const requests = await setup(page);
 const panel=page.getByRole('region',{name:'Desempenho dos upsells'});
 await expect(panel.getByText('PLACEHOLDER Oferta')).toBeVisible();
 await expect(panel.getByText('Por apurar').first()).toBeVisible();
 await expect(panel.getByText('Ofertas vistas')).toBeVisible();
 await page.getByRole('button',{name:'Aquisição',exact:true}).click();
 await expect.poll(()=>requests.filter(r=>r.name==='get_upsell_metrics').at(-1)?.params.p_origin).toBe('online');
 await audit(page);
});

test('ofertas online rastreiam vista/aceitação e preservam a origem no carrinho', async ({page}) => {
 await setup(page);
 const events: Array<Record<string,unknown>>=[];
 await page.route('**/api/track',async route=>{events.push(route.request().postDataJSON());await route.fulfill({json:{ok:true}});});
 await page.route('**/api/menu?**',async route=>route.fulfill({json:{upsell_enabled:true,categories:[{id:'category',name:'PLACEHOLDER Cardápio',items:[
  {id:'burger',name:'PLACEHOLDER Burger',price_cents:10000,available:true,variants:[{id:'base',name:'Base',price_cents:10000},{id:'premium',name:'Premium',price_cents:15000}]},
  {id:'drink',name:'PLACEHOLDER Bebida',price_cents:5000,available:true,is_upsell:true}
 ]}]}}));
 await page.evaluate(()=>localStorage.setItem('cart',JSON.stringify([{menuItemId:'burger',variantId:'base',qty:1}])));
 await page.goto('/upsell');
 await expect(page.getByRole('button',{name:'Passar PLACEHOLDER Burger para Premium'})).toBeVisible();
 await expect.poll(()=>events.filter(e=>e.type==='upsell_view').length).toBe(2);
 await page.getByRole('button',{name:'Passar PLACEHOLDER Burger para Premium'}).click();
 await page.locator('.hs-upsell-card').getByRole('button',{name:/Juntar|Adicionar/i}).click();
 await page.locator('.hs-upsell-cta').getByRole('button').click();
 await expect.poll(async()=>page.evaluate(()=>JSON.parse(localStorage.getItem('cart') ?? '[]').find((x:{menuItemId:string})=>x.menuItemId==='burger')?.upsell?.kind)).toBe('upgrade');
 const cart=await page.evaluate(()=>JSON.parse(localStorage.getItem('cart') ?? '[]'));
 expect(cart.find((x:{menuItemId:string})=>x.menuItemId==='drink').upsell).toMatchObject({kind:'companion',qty:1});
 expect(cart.find((x:{menuItemId:string})=>x.menuItemId==='burger').upsell).toMatchObject({kind:'upgrade',fromVariantId:'base',qty:1});
 await expect.poll(()=>events.filter(e=>e.type==='upsell_accept').length).toBe(2);
});
