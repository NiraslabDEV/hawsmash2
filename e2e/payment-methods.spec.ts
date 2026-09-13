import { expect, test, type Page } from '@playwright/test';
import { agentMenuFixture, agentOrderFixture } from '../apps/web/lib/agents/__tests__/fixtures';
import { rememberPendingCheckout } from '../apps/web/lib/payments/pending-checkout';

async function checkout(page: Page, emolaProvider: 'paysuite' | 'manual' | null) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/menu?**', (route) => route.fulfill({ json: {
    ...agentMenuFixture, payment_provider: 'mpesa', emola_provider: emolaProvider,
    emola_number: 'PLACEHOLDER_EMOLA_MANUAL', emola_name: 'PLACEHOLDER_TITULAR',
  } }));
  await page.route('**/api/account', (route) => route.fulfill({ json: { profile: null } }));
  await page.route('**/api/track', (route) => route.fulfill({ json: { ok: true } }));
  await page.context().addCookies([{ name: 'hs_store', value: 'loja-teste', url: 'http://127.0.0.1:3031' }]);
  await page.addInitScript((items) => {
    localStorage.setItem('cart', JSON.stringify(items));
    localStorage.setItem('cart_store', 'loja-teste');
  }, agentOrderFixture.items);
  await page.goto('/checkout');
  await page.getByRole('textbox', { name: 'Nome *', exact: true }).fill('PLACEHOLDER_CLIENTE');
  await page.getByRole('textbox', { name: 'Telefone *', exact: true }).fill('870000000');
  await page.getByRole('button', { name: 'Pagar agora' }).click();
  return errors;
}

test('e-Mola online coexiste com M-Pesa directo sem enviar msisdn', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await checkout(page, 'paysuite');
  await expect(page.getByRole('textbox', { name: 'Número M-Pesa *' })).toBeVisible();
  await page.getByRole('button', { name: /^e-Mola/ }).click();
  await expect(page.getByRole('textbox', { name: 'Número M-Pesa *' })).toHaveCount(0);
  await expect(page.getByText('Vais continuar para o pagamento e-Mola.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Cartão/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'output/playwright/payments/emola-online.png', fullPage: true });
  let payload: Record<string, unknown> = {};
  await page.route('**/api/payments', async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({ json: { orderId: 'PLACEHOLDER_ORDER', checkoutUrl: '/checkout?simulated=emola' } });
  });
  await page.getByRole('button', { name: /^Pagar \d+ MT$/i }).click();
  await expect(page).toHaveURL(/simulated=emola$/);
  expect(payload.paymentMethod).toBe('emola');
  expect(payload.customerPhone).toBe('870000000');
  expect(payload).not.toHaveProperty('msisdn');
  expect(payload).not.toHaveProperty('provider');
  expect(payload.clientCheckoutId).toMatch(/^[0-9a-f-]{36}$/);
  expect(errors).toEqual([]);
});

test('M-Pesa directo continua a enviar o seu número após trocar de método', async ({ page }) => {
  await checkout(page, 'paysuite');
  await page.getByRole('button', { name: /^e-Mola/ }).click();
  await page.getByRole('button', { name: /^M-Pesa/ }).click();
  await page.getByRole('textbox', { name: 'Número M-Pesa *' }).fill('840000000');
  let payload: Record<string, unknown> = {};
  const keys: unknown[] = [];
  await page.route('**/api/payments', async (route) => {
    payload = route.request().postDataJSON();
    keys.push(payload.clientCheckoutId);
    await route.fulfill({ json: { status: 'failed', message: 'PLACEHOLDER_FALHA_DEFINITIVA' } });
  });
  await page.getByRole('button', { name: /^Pagar \d+ MT$/i }).click();
  await expect(page.getByText('PLACEHOLDER_FALHA_DEFINITIVA')).toBeVisible();
  expect(payload).toMatchObject({ paymentMethod: 'mpesa', msisdn: '840000000' });
  await page.getByRole('button', { name: /^Pagar \d+ MT$/i }).click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[1]).not.toBe(keys[0]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'output/playwright/payments/mpesa-directo.png', fullPage: true });
});

test('e-Mola sem configuração fica disponível apenas por comprovativo', async ({ page }) => {
  await checkout(page, null);
  await expect(page.getByRole('button', { name: /^e-Mola/ })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Número M-Pesa *' })).toBeVisible();
  await page.getByRole('button', { name: 'Comprovativo já paguei' }).click();
  await page.getByRole('button', { name: 'e-Mola Comprovativo' }).click();
  let payload: Record<string, unknown> = {};
  await page.route('**/api/create-order', async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({ json: { orderId: 'PLACEHOLDER_ORDER' } });
  });
  await page.getByRole('button', { name: /^Pagar \d+ MT$/i }).click();
  await expect(page.getByText('PLACEHOLDER_EMOLA_MANUAL')).toBeVisible();
  expect(payload.paymentMethod).toBe('emola');
  expect(payload).not.toHaveProperty('msisdn');
});

test('e-Mola indisponível devolve ao comprovativo com o método preservado', async ({ page }) => {
  await checkout(page, 'paysuite');
  await page.getByRole('button', { name: /^e-Mola/ }).click();
  await page.route('**/api/payments', (route) => route.fulfill({ status: 503, json: {
    status: 'unavailable', message: 'Pagamento e-Mola indisponível. Usa o comprovativo.',
  } }));
  await page.getByRole('button', { name: /^Pagar \d+ MT$/i }).click();
  await expect(page.getByRole('button', { name: 'e-Mola Comprovativo' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Pagamento e-Mola indisponível. Usa o comprovativo.')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pending_order_id'))).toBeNull();
});

test('resposta e-Mola incerta acompanha o pedido existente', async ({ page }) => {
  await checkout(page, 'paysuite');
  await page.getByRole('button', { name: /^e-Mola/ }).click();
  let submissions = 0;
  await page.route('**/api/payments', (route) => {
    submissions++;
    return route.fulfill({ json: { orderId: '10000000-0000-4000-8000-000000000010', status: 'pending' } });
  });
  await page.route('**/api/payments/**', (route) => route.fulfill({ json: { status: 'pending' } }));
  await page.getByRole('button', { name: /^Pagar \d+ MT$/i }).click();
  await expect(page).toHaveURL(/\/payment\/return\/10000000-0000-4000-8000-000000000010$/);
  expect(await page.evaluate(() => localStorage.getItem('pending_order_id'))).toBe('10000000-0000-4000-8000-000000000010');
  expect(submissions).toBe(1);
});

test('depois de 45 segundos a saída acompanha a mesma encomenda sem novo checkout', async ({ page }) => {
  const orderId = '10000000-0000-4000-8000-000000000010';
  await page.clock.install();
  await page.route('**/api/payments/verify', (route) => route.fulfill({ json: { status: 'pending' } }));
  await page.goto(`/payment/return/${orderId}`);
  await expect(page.getByRole('heading', { name: /Confirma no telemóvel/i })).toBeVisible();
  await page.clock.fastForward(46_000);
  await expect(page.getByRole('link', { name: 'Acompanhar esta encomenda' })).toHaveAttribute('href', `/order-status/${orderId}`);
  await expect(page.getByRole('button', { name: 'Tentar outra vez' })).toHaveCount(0);
  await expect(page.locator('a[href="/checkout"]')).toHaveCount(0);
});

test('voltar atrás e mudar para comprovativo não duplica um pagamento incerto', async ({ page }) => {
  const orderId = '10000000-0000-4000-8000-000000000010';
  await checkout(page, 'paysuite');
  await page.getByRole('button', { name: /^e-Mola/ }).click();
  let payments = 0;
  let manual = 0;
  await page.route('**/api/payments', (route) => {
    payments++;
    return route.fulfill({ json: { orderId, status: 'pending' } });
  });
  await page.route('**/api/create-order', (route) => {
    manual++;
    return route.fulfill({ json: { orderId: 'PLACEHOLDER_DUPLICADO' } });
  });
  // Até uma falha ao consultar o estado conserva a referência conhecida.
  await page.route('**/api/payments/verify', (route) => route.fulfill({ status: 503, json: { error: 'PLACEHOLDER_SEM_REDE' } }));
  await page.getByRole('button', { name: /^Pagar \d+ MT$/i }).click();
  await expect(page).toHaveURL(new RegExp(`/payment/return/${orderId}$`));
  await page.goBack();
  await page.getByRole('textbox', { name: 'Nome *', exact: true }).fill('PLACEHOLDER_CLIENTE');
  await page.getByRole('textbox', { name: 'Telefone *', exact: true }).fill('870000000');
  await page.getByRole('button', { name: 'Comprovativo já paguei' }).click();
  await page.getByRole('button', { name: 'e-Mola Comprovativo' }).click();
  await page.getByRole('button', { name: /^Pagar \d+ MT$/i }).click();
  await expect(page).toHaveURL(new RegExp(`/payment/return/${orderId}$`));
  expect(payments).toBe(1);
  expect(manual).toBe(0);
});

for (const status of ['failed', 'paid'] as const) {
  test(`a confirmação ${status} decide se o mesmo carrinho pode abrir nova tentativa`, async ({ page }) => {
    const orderId = '10000000-0000-4000-8000-000000000010';
    await checkout(page, 'paysuite');
    await page.getByRole('button', { name: /^e-Mola/ }).click();
    let snapshot = '';
    rememberPendingCheckout({ getItem: () => null, setItem: (_key, value) => { snapshot = value; }, removeItem: () => {} }, orderId, 'loja-teste', agentOrderFixture.items);
    await page.evaluate((value) => localStorage.setItem('pending_checkout', value), snapshot);
    await page.route('**/api/payments/verify', (route) => route.fulfill({ json: { status } }));
    let payments = 0;
    await page.route('**/api/payments', (route) => {
      payments++;
      return route.fulfill({ json: { orderId: '10000000-0000-4000-8000-000000000011', status: 'pending' } });
    });
    await page.getByRole('button', { name: /^Pagar \d+ MT$/i }).click();
    const expectedId = status === 'failed' ? '10000000-0000-4000-8000-000000000011' : orderId;
    await expect(page).toHaveURL(new RegExp(`/payment/return/${expectedId}$`));
    expect(payments).toBe(status === 'failed' ? 1 : 0);
  });
}

test('resposta perdida antes do orderId reutiliza a chave após recarregar', async ({ page }) => {
  await checkout(page, 'paysuite');
  await page.getByRole('button', { name: /^e-Mola/ }).click();
  const keys: string[] = [];
  await page.route('**/api/payments', async (route) => {
    const payload = route.request().postDataJSON();
    keys.push(payload.clientCheckoutId);
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('checkout_attempt') || '{}'));
    expect(persisted.key).toBe(payload.clientCheckoutId);
    if (keys.length === 1) { await route.abort('failed'); return; }
    await route.fulfill({ json: { orderId: '10000000-0000-4000-8000-000000000010', status: 'pending' } });
  });
  await page.route('**/api/payments/verify', (route) => route.fulfill({ json: { status: 'pending' } }));
  await page.getByRole('button', { name: /^Pagar \d+ MT$/i }).click();
  await expect(page.getByText('Não conseguimos confirmar a resposta.', { exact: false })).toBeVisible();
  await page.reload();
  await page.getByRole('textbox', { name: 'Nome *', exact: true }).fill('PLACEHOLDER_CLIENTE');
  await page.getByRole('textbox', { name: 'Telefone *', exact: true }).fill('870000000');
  await page.getByRole('button', { name: 'Pagar agora' }).click();
  await page.getByRole('button', { name: /^e-Mola/ }).click();
  await page.getByRole('button', { name: /^Pagar \d+ MT$/i }).click();
  await expect(page).toHaveURL(/\/payment\/return\/10000000-0000-4000-8000-000000000010$/);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

test('sem conseguir guardar a chave o checkout não envia pagamento', async ({ page }) => {
  await checkout(page, 'paysuite');
  await page.getByRole('button', { name: /^e-Mola/ }).click();
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'checkout_attempt') throw new Error('PLACEHOLDER_STORAGE_BLOQUEADO');
      setItem.call(this, key, value);
    };
  });
  let payments = 0;
  await page.route('**/api/payments', (route) => { payments++; return route.abort(); });
  await page.getByRole('button', { name: /^Pagar \d+ MT$/i }).click();
  await expect(page.getByText('Não conseguimos guardar a referência do pagamento neste navegador.', { exact: false })).toBeVisible();
  expect(payments).toBe(0);
});

for (const status of ['paid', 'cancelled'] as const) {
  test(`replay e-Mola ${status} sem URL abre o pedido existente`, async ({ page }) => {
    const orderId = '10000000-0000-4000-8000-000000000010';
    await checkout(page, 'paysuite');
    await page.getByRole('button', { name: /^e-Mola/ }).click();
    await page.route('**/api/payments', (route) => route.fulfill({ json: { orderId, status } }));
    await page.route('**/api/payments/verify', (route) => route.fulfill({ json: { status: 'paid' } }));
    await page.getByRole('button', { name: /^Pagar \d+ MT$/i }).click();
    await expect(page).toHaveURL(new RegExp(`/${status === 'paid' ? 'payment/return' : 'order-status'}/${orderId}$`));
  });
}
