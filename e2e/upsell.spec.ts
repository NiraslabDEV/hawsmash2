import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error('E2E do upsell exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY de staging.');
}

let admin: SupabaseClient;

// O upsell vive de dados do cardápio: um burger com variantes (para a subida de
// gama) e itens marcados `is_upsell` (para acompanhar). Garante-se que ambos
// estão disponíveis nas duas lojas antes de medir o comportamento.
test.beforeAll(async () => {
  admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: items, error } = await admin
    .from('menu_items')
    .select('id,name')
    .in('name', ['Classic Smash', 'Coca-Cola']);
  if (error || items?.length !== 2) {
    throw new Error(`E2E upsell: cardápio incompleto — ${error?.message ?? 'itens em falta'}`);
  }

  const { error: prepareError } = await admin
    .from('store_items')
    .update({ available: true, track_stock: false })
    .in('menu_item_id', items.map((item) => item.id));
  if (prepareError) throw new Error(`E2E upsell: preparar itens — ${prepareError.message}`);
});

async function dismissCookies(page: Page) {
  await page
    .getByRole('button', { name: 'Recusar' })
    .click({ timeout: 8000 })
    .catch(() => {});
}

async function goToCart(page: Page) {
  await page.getByRole('button', { name: /Abrir carrinho/ }).click();
  await page.getByRole('button', { name: 'Finalizar pedido' }).click();
}

test('oferece subir de gama e uma bebida antes do pagamento', async ({ page }) => {
  await page.goto('/l/maputo');
  await dismissCookies(page);

  await page.getByRole('button', { name: 'Adicionar Classic Smash' }).first().click();
  await expect(page.getByText(/no carrinho/)).toBeVisible();

  await goToCart(page);
  await expect(page).toHaveURL(/\/upsell$/);

  // 1. Subida de gama: quem levou HAW é convidado a passar a WAGYU.
  const upgrade = page.getByRole('button', { name: /Passar Classic Smash para WAGYU/ });
  await expect(upgrade).toBeVisible();

  // 2. Sabor: a foto da bebida acompanha o sabor escolhido (herdado do 1.0).
  const fanta = page.locator('article.hs-upsell-card').filter({ hasText: 'Fanta' }).first();
  const antes = await fanta.locator('img').getAttribute('src');
  await fanta.locator('.hs-flavour', { hasText: 'Uva' }).click();
  await expect
    .poll(async () => fanta.locator('img').getAttribute('src'))
    .not.toBe(antes);

  // 3. Junta a bebida e marca a subida de gama; nada entra no carrinho antes do
  //    "Continuar" — é o que deixa o cliente mudar de ideias sem sustos.
  await fanta.getByRole('button', { name: /Adicionar Fanta/ }).click();
  await upgrade.click();

  await page.getByRole('button', { name: /Continuar para o pagamento/ }).click();
  await expect(page).toHaveURL(/\/checkout$/);

  const cart = JSON.parse(
    (await page.evaluate(() => window.localStorage.getItem('cart'))) ?? '[]',
  ) as { menuItemId: string; qty: number; variantId?: string }[];
  expect(cart).toHaveLength(2);

  const { data: wagyu } = await admin
    .from('menu_item_variants')
    .select('id, menu_items!inner(name)')
    .eq('name', 'WAGYU')
    .eq('menu_items.name', 'Classic Smash')
    .single();
  expect(cart.some((line) => line.variantId === wagyu?.id)).toBe(true);
});

test('não insiste com quem já leva bebida', async ({ page }) => {
  await page.goto('/l/maputo');
  await dismissCookies(page);

  // Só uma bebida no carrinho: não há burger para subir de gama e o cliente já
  // está servido — o ecrã de upsell salta sozinho para o pagamento.
  await page.getByRole('tab', { name: 'Bebidas' }).click();
  await page.getByRole('button', { name: 'Adicionar Coca-Cola' }).first().click();
  await expect(page.getByText(/no carrinho/)).toBeVisible();

  await goToCart(page);
  await expect(page).toHaveURL(/\/checkout$/);
});
