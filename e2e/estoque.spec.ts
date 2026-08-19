import { expect, test } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !serviceKey || !anonKey) {
  throw new Error(
    'E2E do estoque exige SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY de staging.',
  );
}

let admin: SupabaseClient;
let storeId: string;
let menuItemId: string;
let userId: string;
let originalStoreItem: {
  available: boolean;
  track_stock: boolean;
  stock_qty: number;
  low_stock_qty: number;
};

const password = 'E2E-Estoque-2026-Seguro!';
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `estoque-e2e-${suffix}@delivery.test`;

test.beforeAll(async () => {
  admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: store, error: storeError } = await admin
    .from('stores')
    .select('id')
    .eq('slug', 'maputo')
    .single();
  if (storeError || !store) throw new Error(`E2E estoque: loja — ${storeError?.message}`);
  storeId = store.id;

  const { data: item, error: itemError } = await admin
    .from('menu_items')
    .select('id')
    .eq('name', 'Classic Smash')
    .single();
  if (itemError || !item) throw new Error(`E2E estoque: item — ${itemError?.message}`);
  menuItemId = item.id;

  const { data: storeItem, error: storeItemError } = await admin
    .from('store_items')
    .select('available,track_stock,stock_qty,low_stock_qty')
    .eq('store_id', storeId)
    .eq('menu_item_id', menuItemId)
    .single();
  if (storeItemError || !storeItem) {
    throw new Error(`E2E estoque: store_item — ${storeItemError?.message}`);
  }
  originalStoreItem = storeItem;

  const { error: prepareError } = await admin
    .from('store_items')
    .update({ available: true, track_stock: true, stock_qty: 2, low_stock_qty: 2 })
    .eq('store_id', storeId)
    .eq('menu_item_id', menuItemId);
  if (prepareError) throw new Error(`E2E estoque: preparar — ${prepareError.message}`);

  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !user.user) throw new Error(`E2E estoque: gerente — ${userError?.message}`);
  userId = user.user.id;

  const { error: profileError } = await admin.from('staff_profiles').insert({
    user_id: userId,
    full_name: 'Gerente E2E Estoque',
    role: 'manager',
    active: true,
  });
  if (profileError) throw new Error(`E2E estoque: perfil — ${profileError.message}`);

  const { error: accessError } = await admin
    .from('staff_stores')
    .insert({ user_id: userId, store_id: storeId });
  if (accessError) throw new Error(`E2E estoque: acesso — ${accessError.message}`);
});

test.afterAll(async () => {
  if (!admin) return;
  await admin.from('stock_movements').delete().eq('created_by', userId);
  await admin.from('event_log').delete().eq('actor_user_id', userId);
  if (originalStoreItem && storeId && menuItemId) {
    await admin
      .from('store_items')
      .update(originalStoreItem)
      .eq('store_id', storeId)
      .eq('menu_item_id', menuItemId);
  }
  if (userId) await admin.auth.admin.deleteUser(userId);
});

test('regista uma entrada de estoque e vê o movimento no histórico', async ({ page }) => {
  await page.goto('/login?next=/estoque');
  await page.waitForLoadState('networkidle');
  const rejectCookies = page.getByRole('button', { name: 'Recusar' });
  if (await rejectCookies.isVisible()) await rejectCookies.click();
  await page.getByPlaceholder('dono@restaurante.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/estoque$/);

  const row = page.getByRole('row', { name: /Classic Smash/ });
  await expect(row).toBeVisible();
  await expect(row.getByText('Crítico')).toBeVisible();

  await row.getByRole('button', { name: 'Entrada' }).click();
  await page.getByLabel('Quantidade').fill('6');
  await page.getByLabel('Motivo').fill('Entrega do fornecedor');
  await page.getByRole('button', { name: 'Registar' }).click();

  await expect(page.getByText('Entrada registada em Classic Smash.')).toBeVisible();
  await expect(row.getByText('Em stock')).toBeVisible();

  await expect
    .poll(async () => {
      const { data } = await admin
        .from('store_items')
        .select('stock_qty')
        .eq('store_id', storeId)
        .eq('menu_item_id', menuItemId)
        .single();
      return data?.stock_qty ?? null;
    })
    .toBe(8);

  const { data: movement } = await admin
    .from('stock_movements')
    .select('delta,reason,qty_after,note,created_by')
    .eq('created_by', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  expect(movement).toMatchObject({
    delta: 6,
    reason: 'receive',
    qty_after: 8,
    note: 'Entrega do fornecedor',
  });

  await expect(page.getByText('Entrega do fornecedor')).toBeVisible();
});
