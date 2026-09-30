import { expect, test, type Page } from '@playwright/test';

type Filters = { limit?: number; offset?: number; store?: string; status?: string; search?: string; day?: string; date_from?: string; date_to?: string };
const allOrders = Array.from({ length: 125 }, (_, index) => ({
  id: `91000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  order_number: `TESTE-${String(index + 1).padStart(3, '0')}`,
  store_slug: index < 110 ? 'loja-a' : 'loja-b', store_name: index < 110 ? 'Loja A' : 'Loja B',
  status: index % 2 ? 'ready' : 'paid', flow: 'manual', fulfillment_type: 'pickup',
  customer_name: `PLACEHOLDER_CLIENTE_${index + 1}`, customer_phone: '',
  total_cents: 10000, payment_method: 'cash', created_at: '2026-01-01T10:00:00Z',
  scheduled_for: null, payment_proof_path: null, items: [],
}));

async function openPanel(page: Page, delayStoreA = false, dayAware = false) {
  const requests: Filters[] = [];
  await page.addInitScript(() => {
    const user = { id: '90000000-0000-4000-8000-000000000001', aud: 'authenticated', email: 'PLACEHOLDER@example.invalid' };
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = [btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), btoa(JSON.stringify({ sub: user.id, role: 'authenticated', exp })), 'PLACEHOLDER_SIGNATURE'].join('.');
    localStorage.setItem('sb-127-auth-token', JSON.stringify({ access_token: token, refresh_token: 'PLACEHOLDER_REFRESH', expires_at: exp, expires_in: 3600, token_type: 'bearer', user }));
  });
  await page.route('http://127.0.0.1:3020/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (pathname.endsWith('/staff_profiles')) body = { role: 'owner' };
    else if (pathname.endsWith('/stores')) body = [{ slug: 'loja-a', short_name: 'Loja A' }, { slug: 'loja-b', short_name: 'Loja B' }];
    else if (pathname.endsWith('/settings')) body = { accepting_orders: true };
    else if (pathname.endsWith('/get_order_stats')) body = { ativos: 125, pedidos_hoje: 125, faturado_hoje: 0, em_preparo: 0, prontos: 62, cancelados_hoje: 0, avg_rating: null, status_counts: { paid: 63, ready: 62 } };
    else if (pathname.endsWith('/get_device_status')) body = { devices: [], threshold_seconds: 60 };
    else if (pathname.endsWith('/orders')) body = [];
    else if (pathname.endsWith('/get_orders')) {
      const filters = route.request().postDataJSON().p_filters as Filters;
      requests.push(filters);
      // Com `dayAware`, a RPC simula a 1110: só os 10 primeiros são do dia em
      // curso, e as contagens por estado seguem o recorte da lista.
      const base = allOrders.filter((order, index) => (!filters.store || order.store_slug === filters.store)
        && (!dayAware || filters.day !== 'current' || index < 10)
        && (!filters.search || order.order_number.includes(filters.search) || order.customer_name.includes(filters.search)));
      const matching = base.filter((order) => !filters.status || order.status === filters.status);
      if (delayStoreA && filters.store === 'loja-a') await new Promise((resolve) => setTimeout(resolve, 600));
      const statusCounts = base.reduce<Record<string, number>>((acc, order) => ({ ...acc, [order.status]: (acc[order.status] ?? 0) + 1 }), {});
      body = {
        orders: matching.slice(filters.offset ?? 0, (filters.offset ?? 0) + (filters.limit ?? 100)), total: matching.length, limit: filters.limit, offset: filters.offset,
        ...(dayAware ? { status_counts: statusCounts } : {}),
      };
    }
    await route.fulfill({ json: body, headers: { 'Access-Control-Allow-Origin': 'http://127.0.0.1:3019', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, X-Client-Info' } }).catch(() => {});
  });
  await page.goto('/pedidos');
  await expect(page.getByRole('heading', { name: 'Pedidos', exact: true })).toBeVisible();
  return requests;
}

test('página 13 mostra pedidos além de 100 e reinicia filtros antes da consulta', async ({ page }) => {
  const requests = await openPanel(page);
  await expect(page.getByText('Exibindo 1 a 10 de 125 pedidos')).toBeVisible();
  await page.getByRole('button', { name: 'Página 13', exact: true }).click();
  await expect(page.getByText('Exibindo 121 a 125 de 125 pedidos')).toBeVisible();
  await expect(page.getByRole('cell', { name: /TESTE-125/ })).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ limit: 10, offset: 120 });
  await page.screenshot({ path: 'output/orders/pagina-13.png', fullPage: true });

  await page.getByRole('combobox', { name: 'Loja', exact: true }).selectOption('loja-a');
  await expect(page.getByText('Exibindo 1 a 10 de 110 pedidos')).toBeVisible();
  expect(requests.filter((request) => request.store === 'loja-a')[0]).toMatchObject({ offset: 0 });
  await page.getByRole('button', { name: 'Página 2', exact: true }).click();
  await expect(page.getByText('Exibindo 11 a 20 de 110 pedidos')).toBeVisible();
  await page.getByRole('combobox', { name: 'Estado dos pedidos' }).selectOption('ready');
  await expect(page.getByText('Exibindo 1 a 10 de 55 pedidos')).toBeVisible();
  expect(requests.filter((request) => request.status === 'ready')[0]).toMatchObject({ store: 'loja-a', offset: 0 });
  await page.screenshot({ path: 'output/orders/pedidos-filtrados.png', fullPage: true });
});

test('uma resposta atrasada não troca os pedidos da loja seleccionada', async ({ page }) => {
  const requests = await openPanel(page, true);
  await expect(page.getByText('Exibindo 1 a 10 de 125 pedidos')).toBeVisible();
  await page.getByRole('combobox', { name: 'Loja', exact: true }).selectOption('loja-a');
  await expect.poll(() => requests.some((request) => request.store === 'loja-a')).toBe(true);
  await page.getByRole('combobox', { name: 'Loja', exact: true }).selectOption('loja-b');
  await expect(page.getByText('Exibindo 1 a 10 de 15 pedidos')).toBeVisible();
  await expect(page.getByRole('cell', { name: /TESTE-111/ })).toBeVisible();
  // Esperar a resposta da loja anterior para provar que não reaparece no ecrã.
  await page.waitForTimeout(800);
  await expect(page.getByRole('cell', { name: /TESTE-111/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /TESTE-001/ })).toHaveCount(0);
});

test('abre só com o dia em curso; o histórico e o dia escolhido vão ao servidor', async ({ page }) => {
  const requests = await openPanel(page, false, true);
  await expect(page.getByText('Exibindo 1 a 10 de 10 pedidos')).toBeVisible();
  expect(requests[0]).toMatchObject({ day: 'current', offset: 0 });
  // As abas contam o dia, não as 125 de sempre do get_order_stats.
  await expect(page.getByRole('button', { name: /^Pagos\s*5$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Prontos\s*5$/ })).toBeVisible();
  await expect(page.getByText('Ao fechar o dia no Caixa, passam para o Histórico.')).toBeVisible();
  await page.screenshot({ path: 'output/orders/dia-actual.png', fullPage: true });

  await page.getByRole('combobox', { name: 'Período' }).selectOption('history');
  await expect(page.getByText('Exibindo 1 a 10 de 125 pedidos')).toBeVisible();
  expect(requests.at(-1)).not.toHaveProperty('day');
  await expect(page.getByRole('button', { name: /^Prontos\s*62$/ })).toBeVisible();

  await page.getByLabel('Dia do histórico').fill('2026-09-28');
  await expect.poll(() => requests.at(-1)).toMatchObject({
    date_from: '2026-09-27T22:00:00.000Z',
    date_to: '2026-09-28T21:59:59.999Z',
    offset: 0,
  });
  await page.screenshot({ path: 'output/orders/historico-dia.png', fullPage: true });

  await page.getByRole('combobox', { name: 'Período' }).selectOption('current');
  await expect(page.getByText('Exibindo 1 a 10 de 10 pedidos')).toBeVisible();
  expect(requests.at(-1)).toMatchObject({ day: 'current' });
  expect(requests.at(-1)).not.toHaveProperty('date_from');
});
