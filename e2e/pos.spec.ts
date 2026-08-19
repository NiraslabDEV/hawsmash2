import { expect, test } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !serviceKey || !anonKey) {
  throw new Error(
    'E2E do POS exige SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY de staging.',
  );
}

let admin: SupabaseClient;
let storeId: string;
let menuItemId: string;
let userId: string;
let deviceId: string;
let orderId: string | null = null;
let offlineOrderId: string | null = null;
let originalStoreItem: {
  available: boolean;
  track_stock: boolean;
  stock_qty: number;
};

const password = 'E2E-Pos-2026-Seguro!';
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `pos-e2e-${suffix}@delivery.test`;

test.beforeAll(async () => {
  admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: store, error: storeError } = await admin
    .from('stores')
    .select('id')
    .eq('slug', 'maputo')
    .single();
  if (storeError || !store) throw new Error(`E2E: loja Maputo — ${storeError?.message}`);
  storeId = store.id;

  const { data: item, error: itemError } = await admin
    .from('menu_items')
    .select('id')
    .eq('name', 'Classic Smash')
    .single();
  if (itemError || !item) throw new Error(`E2E: Classic Smash — ${itemError?.message}`);
  menuItemId = item.id;

  const { data: storeItem, error: storeItemError } = await admin
    .from('store_items')
    .select('available,track_stock,stock_qty')
    .eq('store_id', storeId)
    .eq('menu_item_id', menuItemId)
    .single();
  if (storeItemError || !storeItem) {
    throw new Error(`E2E: produto da loja — ${storeItemError?.message}`);
  }
  originalStoreItem = storeItem;
  const { error: prepareItemError } = await admin
    .from('store_items')
    .update({ available: true, track_stock: false })
    .eq('store_id', storeId)
    .eq('menu_item_id', menuItemId);
  if (prepareItemError) throw new Error(`E2E: preparar produto — ${prepareItemError.message}`);

  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !user.user) throw new Error(`E2E: criar gerente — ${userError?.message}`);
  userId = user.user.id;

  const authProbe = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: authProbeError } = await authProbe.auth.signInWithPassword({ email, password });
  if (authProbeError) throw new Error(`E2E: credenciais novas — ${authProbeError.message}`);
  await authProbe.auth.signOut();

  const { error: profileError } = await admin.from('staff_profiles').insert({
    user_id: userId,
    full_name: 'Gerente E2E POS',
    role: 'manager',
    active: true,
  });
  if (profileError) throw new Error(`E2E: perfil — ${profileError.message}`);

  const { error: storeAccessError } = await admin.from('staff_stores').insert({
    user_id: userId,
    store_id: storeId,
  });
  if (storeAccessError) throw new Error(`E2E: acesso à loja — ${storeAccessError.message}`);

  const { data: device, error: deviceError } = await admin
    .from('devices')
    .insert({
      store_id: storeId,
      kind: 'pos',
      label: 'POS Playwright',
      device_key_hash: `e2e-${suffix}`,
      active: true,
    })
    .select('id')
    .single();
  if (deviceError || !device) throw new Error(`E2E: terminal — ${deviceError?.message}`);
  deviceId = device.id;
});

test.afterAll(async () => {
  if (!admin) return;
  if (orderId) await admin.from('orders').delete().eq('id', orderId);
  if (offlineOrderId) await admin.from('orders').delete().eq('id', offlineOrderId);
  if (deviceId) await admin.from('devices').delete().eq('id', deviceId);
  if (originalStoreItem && storeId && menuItemId) {
    await admin
      .from('store_items')
      .update(originalStoreItem)
      .eq('store_id', storeId)
      .eq('menu_item_id', menuItemId);
  }
  if (userId) await admin.auth.admin.deleteUser(userId);
});

// O aviso de cookies só aparece quando há tags de marketing configuradas —
// depende dos dados do ambiente. O teste dispensa-o se ele não existir.
async function dismissCookies(page: import('@playwright/test').Page) {
  await page
    .getByRole('button', { name: 'Recusar' })
    .click({ timeout: 8000 })
    .catch(() => {});
}

async function enterPos(page: import('@playwright/test').Page) {
  await page.addInitScript((linkedDeviceId) => {
    window.localStorage.setItem('hs_pos_device_id', linkedDeviceId);
  }, deviceId);

  await page.goto('/login?next=/pos');
  await page.waitForLoadState('networkidle');
  await dismissCookies(page);
  await page.getByPlaceholder('dono@restaurante.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/pos$/);
}

test('vende em dinheiro com troco e anula com motivo', async ({ page }) => {
  await enterPos(page);
  await expect(page.getByText('CRIAR PIN')).toBeVisible();
  await page.getByLabel('PIN', { exact: true }).fill('4826');
  await page.getByLabel('Confirmar PIN').fill('4826');
  await page.getByRole('button', { name: 'Guardar PIN' }).click();
  await dismissCookies(page);

  await page.getByRole('button', { name: /Classic Smash/ }).click();
  await page.getByRole('button', { name: /^Recebido:/ }).click();
  await page.getByRole('button', { name: '5', exact: true }).click();
  await page.getByRole('button', { name: '0', exact: true }).click();
  await page.getByRole('button', { name: '0', exact: true }).click();
  await expect(page.getByText('Troco: 200 MT')).toBeVisible();

  await page.getByRole('button', { name: 'FINALIZAR VENDA' }).click();
  await expect(page.getByText('VENDA REGISTADA')).toBeVisible();

  await expect.poll(async () => {
    const { data } = await admin
      .from('event_log')
      .select('order_id')
      .eq('actor_user_id', userId)
      .eq('type', 'counter.sale_created')
      .not('order_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    orderId = data?.order_id ?? null;
    return orderId;
  }).not.toBeNull();

  await expect(page.getByText('VENDA REGISTADA')).toBeHidden();
  await page.getByRole('button', { name: /Reimprimir talão #/ }).click();
  await expect(page.getByText(/Talão em fila · via 1/)).toBeVisible();
  await expect.poll(async () => {
    if (!orderId) return 0;
    const { count } = await admin
      .from('event_log')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', orderId)
      .eq('actor_user_id', userId)
      .eq('type', 'print.reprinted');
    return count ?? 0;
  }).toBe(1);

  const voidButton = page.getByRole('button', { name: /Anular #/ });
  await expect(voidButton).toBeVisible();
  await voidButton.click();
  await page.getByPlaceholder('Motivo obrigatório').fill('Cliente pediu correcção no balcão');
  await page.getByRole('button', { name: 'Confirmar anulação' }).click();

  await expect.poll(async () => {
    if (!orderId) return null;
    const { data } = await admin.from('orders').select('status').eq('id', orderId).single();
    return data?.status ?? null;
  }).toBe('cancelled');

  const { data: audit } = await admin
    .from('event_log')
    .select('actor_user_id,payload')
    .eq('order_id', orderId)
    .eq('type', 'counter.sale_voided')
    .single();
  expect(audit?.actor_user_id).toBe(userId);
  expect(audit?.payload).toMatchObject({ reason: 'Cliente pediu correcção no balcão' });
});

test('guarda a venda com a rede desligada e sincroniza ao regressar', async ({ context, page }) => {
  await enterPos(page);
  await expect(page.getByRole('button', { name: /Classic Smash/ })).toBeVisible();

  if (await page.getByText('CRIAR PIN').isVisible()) {
    await page.getByLabel('PIN', { exact: true }).fill('4826');
    await page.getByLabel('Confirmar PIN').fill('4826');
    await page.getByRole('button', { name: 'Guardar PIN' }).click();
  } else if (await page.getByText('POS BLOQUEADO').isVisible()) {
    await page.getByLabel('PIN', { exact: true }).fill('4826');
    await page.getByRole('button', { name: 'Desbloquear' }).click();
  }

  await dismissCookies(page);

  await context.setOffline(true);
  await expect(page.getByText('SEM LIGAÇÃO · 0 vendas por sincronizar')).toBeVisible();

  await page.getByRole('button', { name: /Classic Smash/ }).click();
  await page.getByRole('button', { name: 'M-Pesa', exact: true }).click();
  await page.getByRole('button', { name: 'FINALIZAR VENDA' }).click();

  await expect(page.getByText('VENDA GUARDADA OFFLINE')).toBeVisible();
  await expect(page.getByText('SEM LIGAÇÃO · 1 venda por sincronizar')).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText('1 venda sincronizada')).toBeVisible();

  await expect.poll(async () => {
    const { data } = await admin
      .from('event_log')
      .select('order_id')
      .eq('actor_user_id', userId)
      .eq('type', 'counter.sale_created')
      .not('order_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    offlineOrderId = data?.order_id ?? null;
    return offlineOrderId;
  }).not.toBeNull();

  const { data: syncedOrder } = await admin
    .from('orders')
    .select('store_id,status,needs_review')
    .eq('id', offlineOrderId)
    .single();
  expect(syncedOrder).toMatchObject({
    store_id: storeId,
    status: 'paid',
    needs_review: false,
  });
});
