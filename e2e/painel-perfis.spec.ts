import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * O menu do painel segue o perfil — e o URL escrito à mão também.
 * Antes, o Balcão não via a aba Marketing mas entrava em /marketing pelo URL.
 */

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error('E2E do painel exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY de staging.');
}

let admin: SupabaseClient;
let userId: string;

const password = 'E2E-Perfis-2026-Seguro!';
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `perfis-e2e-${suffix}@delivery.test`;

async function dismissCookies(page: Page) {
  await page
    .getByRole('button', { name: 'Recusar' })
    .click({ timeout: 8000 })
    .catch(() => {});
}

test.beforeAll(async () => {
  admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: store, error: storeError } = await admin
    .from('stores')
    .select('id')
    .eq('slug', 'maputo')
    .single();
  if (storeError || !store) throw new Error(`E2E perfis: loja — ${storeError?.message}`);

  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !user.user) throw new Error(`E2E perfis: caixa — ${userError?.message}`);
  userId = user.user.id;

  const { error: profileError } = await admin.from('staff_profiles').insert({
    user_id: userId,
    full_name: 'Caixa E2E Perfis',
    role: 'cashier',
    active: true,
  });
  if (profileError) throw new Error(`E2E perfis: perfil — ${profileError.message}`);

  const { error: accessError } = await admin
    .from('staff_stores')
    .insert({ user_id: userId, store_id: store.id });
  if (accessError) throw new Error(`E2E perfis: acesso — ${accessError.message}`);
});

test.afterAll(async () => {
  if (!admin || !userId) return;
  await admin.from('event_log').delete().eq('actor_user_id', userId);
  await admin.auth.admin.deleteUser(userId);
});

test('o Balcão vê Pedidos e Caixa, e /marketing pelo URL devolve-o a Pedidos', async ({ page }) => {
  await page.goto('/login?next=/pedidos');
  await page.waitForLoadState('networkidle');
  await dismissCookies(page);
  await page.getByPlaceholder('dono@restaurante.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/pedidos$/);
  await dismissCookies(page);

  const menu = page.locator('nav').first();
  await expect(menu.getByRole('link', { name: 'Pedidos' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Caixa' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Marketing' })).toHaveCount(0);

  await page.goto('/marketing');
  await expect(page).toHaveURL(/\/pedidos$/);
  await expect(page.getByRole('heading', { name: /Marketing/ })).toHaveCount(0);
});
