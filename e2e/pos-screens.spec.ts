// Captura de ecrãs do POS a 1366x768 — a resolução do AnyPOS100 da Matola,
// que é a mais apertada das duas lojas e portanto a que manda no desenho.
// NÃO finaliza vendas: só percorre os ecrãs e fotografa.
import { expect, test } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !serviceKey || !anonKey) {
  throw new Error('Screenshots do POS exigem as chaves de staging.');
}

const DIR = 'output/pos-screens';
let admin: SupabaseClient;
let storeId: string;
let userId: string;
let deviceId: string;

const password = 'E2E-Screens-2026-Seguro!';
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `pos-screens-${suffix}@delivery.test`;

test.use({ viewport: { width: 1366, height: 768 } });

test.beforeAll(async () => {
  admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: store, error: storeError } = await admin
    .from('stores').select('id').eq('slug', 'maputo').single();
  if (storeError || !store) throw new Error(`loja Maputo — ${storeError?.message}`);
  storeId = store.id;

  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (userError || !user.user) throw new Error(`criar gerente — ${userError?.message}`);
  userId = user.user.id;

  const { error: profileError } = await admin.from('staff_profiles').insert({
    user_id: userId, full_name: 'Gerente Screenshots', role: 'manager', active: true,
  });
  if (profileError) throw new Error(`perfil — ${profileError.message}`);

  const { error: accessError } = await admin.from('staff_stores').insert({
    user_id: userId, store_id: storeId,
  });
  if (accessError) throw new Error(`acesso — ${accessError.message}`);

  const { data: device, error: deviceError } = await admin.from('devices').insert({
    store_id: storeId, kind: 'pos', label: 'POS Screenshots',
    device_key_hash: `screens-${suffix}`, active: true,
  }).select('id').single();
  if (deviceError || !device) throw new Error(`terminal — ${deviceError?.message}`);
  deviceId = device.id;
});

test.afterAll(async () => {
  if (!admin) return;
  if (deviceId) await admin.from('devices').delete().eq('id', deviceId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

test('captura os ecrãs do POS a 1366x768', async ({ page }) => {
  await page.addInitScript((id) => {
    window.localStorage.setItem('hs_pos_device_id', id);
  }, deviceId);

  await page.goto('/login?next=/pos');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Recusar' }).click({ timeout: 5000 }).catch(() => {});
  await page.getByPlaceholder('dono@restaurante.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/pos$/);

  // PIN obrigatório na primeira entrada
  await expect(page.getByText('CRIAR PIN')).toBeVisible();
  await page.screenshot({ path: `${DIR}/00-criar-pin.png` });
  await page.getByLabel('PIN', { exact: true }).fill('4826');
  await page.getByLabel('Confirmar PIN').fill('4826');
  await page.getByRole('button', { name: 'Guardar PIN' }).click();
  await page.getByRole('button', { name: 'Recusar' }).click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // 1. Grelha com carrinho vazio
  await page.screenshot({ path: `${DIR}/01-grelha-vazia.png` });

  // 2. Carrinho carregado — clica nos primeiros produtos que encontrar
  const cards = page.locator('section button').filter({ hasText: /MT/ });
  const total = await cards.count();
  console.log(`>>> produtos visíveis na grelha: ${total}`);
  for (let i = 0; i < Math.min(total, 5); i++) {
    await cards.nth(i).click();
    await page.waitForTimeout(200);
  }
  await cards.nth(0).click();
  await cards.nth(0).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/02-carrinho-cheio.png` });

  // 3. Teclado de dinheiro com troco
  await page.getByRole('button', { name: 'PAGAR' }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${DIR}/04-funil-acompanhar.png` });
  await page.getByRole('button', { name: 'Continuar →' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${DIR}/05-funil-sobremesa.png` });
  await page.getByRole('button', { name: 'Ir pagar →' }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${DIR}/03a-pagamento.png` });
  await page.getByRole('button', { name: /^Recebido:/ }).click().catch(() => {});
  await page.waitForTimeout(300);
  for (const key of ['5', '0', '0', '0']) {
    await page.getByRole('button', { name: key, exact: true }).click().catch(() => {});
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/03-pagamento-troco.png` });

  console.log(`>>> screenshots em ${DIR}`);
});
