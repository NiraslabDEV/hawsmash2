import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error('E2E da loja exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY de staging.');
}

let admin: SupabaseClient;
const storeIds: Record<string, string> = {};
const createdOrderIds: string[] = [];
const suffix = `${Date.now()}`.slice(-6);

test.beforeAll(async () => {
  admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: stores, error } = await admin
    .from('stores')
    .select('id,slug')
    .in('slug', ['maputo', 'matola']);
  if (error || stores?.length !== 2) throw new Error(`E2E loja: lojas — ${error?.message}`);
  for (const store of stores) storeIds[store.slug] = store.id;

  const { data: item, error: itemError } = await admin
    .from('menu_items')
    .select('id')
    .eq('name', 'Classic Smash')
    .single();
  if (itemError || !item) throw new Error(`E2E loja: item — ${itemError?.message}`);

  const { error: prepareError } = await admin
    .from('store_items')
    .update({ available: true, track_stock: false })
    .eq('menu_item_id', item.id)
    .in('store_id', Object.values(storeIds));
  if (prepareError) throw new Error(`E2E loja: preparar item — ${prepareError.message}`);
});

test.afterAll(async () => {
  if (!admin || createdOrderIds.length === 0) return;
  await admin.from('stock_movements').delete().in('order_id', createdOrderIds);
  await admin.from('orders').delete().in('id', createdOrderIds);
});

// O aviso de cookies aparece depois da hidratação e fica por cima do ecrã de
// produto; sai do caminho antes de qualquer clique de venda.
async function dismissCookies(page: Page) {
  await page
    .getByRole('button', { name: 'Recusar' })
    .click({ timeout: 8000 })
    .catch(() => {});
}

async function addClassicSmash(page: Page) {
  await dismissCookies(page);
  await page.getByRole('button', { name: 'Adicionar Classic Smash' }).first().click();
  // Classic Smash tem tamanhos: o cartão abre o ecrã de produto antes de somar.
  const confirm = page.getByRole('button', { name: /^Adicionar · / });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.getByText(/no carrinho/)).toBeVisible();
}

async function orderFromStore(page: Page, slug: string, customerName: string) {
  await page.goto(`/l/${slug}`);
  await expect(page.getByRole('button', { name: 'Trocar de loja' })).toBeVisible();
  await addClassicSmash(page);

  await page.goto('/checkout');
  await dismissCookies(page);
  await page.getByPlaceholder('Seu nome').fill(customerName);
  await page.getByPlaceholder('+258 XX XXX XXX').fill(`+2588${suffix}01`);
  await page.getByRole('button', { name: /Levantamento/ }).click();
  await page.getByRole('button', { name: 'Criar Pedido' }).click();
  await expect(page.getByText('Pagamento Manual')).toBeVisible();

  const { data: order } = await admin
    .from('orders')
    .select('id,store_id,order_number')
    .eq('customer_name', customerName)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (order?.id) createdOrderIds.push(order.id);
  return order;
}

test('pedido em Maputo e pedido na Matola caem em lojas diferentes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Escolhe a tua loja' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Ver cardápio de Maputo/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Ver cardápio de Matola/ })).toBeVisible();

  const maputo = await orderFromStore(page, 'maputo', `E2E Maputo ${suffix}`);
  expect(maputo?.store_id).toBe(storeIds.maputo);
  expect(maputo?.order_number?.startsWith('MPT-')).toBe(true);

  const matola = await orderFromStore(page, 'matola', `E2E Matola ${suffix}`);
  expect(matola?.store_id).toBe(storeIds.matola);
  expect(matola?.order_number?.startsWith('MTL-')).toBe(true);
});

test('trocar de loja avisa e esvazia o carrinho', async ({ page }) => {
  await page.goto('/l/maputo');
  await addClassicSmash(page);

  await page.getByRole('button', { name: 'Trocar de loja' }).click();
  await expect(page.getByText(/o teu carrinho é esvaziado/)).toBeVisible();
  await page.getByRole('button', { name: /Matola/ }).click();

  await expect(page).toHaveURL(/\/l\/matola$/);
  expect(await page.evaluate(() => window.localStorage.getItem('cart'))).toBe('[]');
  expect(await page.evaluate(() => document.cookie)).toContain('hs_store=matola');
});
