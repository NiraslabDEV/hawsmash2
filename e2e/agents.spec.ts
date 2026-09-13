import { expect, test } from '@playwright/test';
import { agentOrderFixture } from '../apps/web/lib/agents/__tests__/fixtures';

test('carrinho preparado pelo agente chega intacto ao checkout, mesmo após recarregar', async ({ page, request }) => {
  const prepared = await request.post('/api/agents/tools', { data: { name: 'prepare_checkout', arguments: agentOrderFixture } });
  expect(prepared.ok()).toBe(true);
  const { result } = await prepared.json();
  expect(result.totalCents).toBe(103000);
  const writes: string[] = [];
  page.on('request', (entry) => {
    if (/\/api\/(create-order|payments)(\/|$)/.test(new URL(entry.url()).pathname)) writes.push(entry.url());
  });
  await page.goto(result.checkoutUrl);
  await expect(page.getByRole('heading', { name: 'Revê o teu pedido' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar carrinho e continuar' }).click();
  await expect(page).toHaveURL(/\/checkout\?store=loja-teste$/);
  await expect(page.getByRole('combobox', { name: 'ZONA DE ENTREGA' })).toHaveValue(agentOrderFixture.deliveryZoneId);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('cart') || '[]'))).toEqual(agentOrderFixture.items);
  await expect(page.getByRole('button', { name: 'PAGAR 1030 MT' })).toBeVisible();
  await page.reload();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('cart') || '[]'))).toEqual(agentOrderFixture.items);
  expect(writes).toEqual([]);
});

test('abrir e repetir a revisão não altera o carrinho sem confirmação', async ({ page, request }) => {
  const { result } = await (await request.post('/api/agents/tools', { data: { name: 'prepare_checkout', arguments: agentOrderFixture } })).json();
  await page.goto('/');
  const previous = [{ menuItemId: agentOrderFixture.items[0].menuItemId, qty: 1, notes: 'PLACEHOLDER_NOTA_PRIVADA' }];
  await page.evaluate((cart) => { localStorage.setItem('cart', JSON.stringify(cart)); localStorage.setItem('cart_store', 'outra-loja'); }, previous);
  await page.goto(result.checkoutUrl);
  await expect(page.getByRole('button', { name: 'Substituir carrinho e continuar' })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cart') || '[]'))).toEqual(previous);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Substituir carrinho e continuar' })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cart') || '[]'))).toEqual(previous);
});
