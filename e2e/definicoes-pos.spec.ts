import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Aba POS do painel (migration 1067): o dono muda as definições do balcão de
 * uma loja, grava, e o que fica na BD é o que o POS vai ler.
 */

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error('E2E do POS exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY de staging.');
}

let admin: SupabaseClient;
let storeId: string;
let userId: string;
let before: { config: unknown } | null = null;

const password = 'E2E-DefPos-2026-Seguro!';
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `defpos-e2e-${suffix}@delivery.test`;
const nota = `E2E ${`${Date.now()}`.slice(-5)}`;

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
    .eq('slug', 'matola')
    .single();
  if (storeError || !store) throw new Error(`E2E POS: loja — ${storeError?.message}`);
  storeId = store.id;

  const { data: atual, error: readError } = await admin
    .from('store_pos_settings')
    .select('config')
    .eq('store_id', storeId)
    .maybeSingle();
  if (readError) throw new Error(`E2E POS: ler definições — ${readError.message}`);
  before = atual;

  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !user.user) throw new Error(`E2E POS: dono — ${userError?.message}`);
  userId = user.user.id;

  const { error: profileError } = await admin.from('staff_profiles').insert({
    user_id: userId,
    full_name: 'Dono E2E POS',
    role: 'owner',
    active: true,
  });
  if (profileError) throw new Error(`E2E POS: perfil — ${profileError.message}`);
});

test.afterAll(async () => {
  if (!admin) return;
  if (before) {
    await admin.from('store_pos_settings').update({ config: before.config }).eq('store_id', storeId);
  } else {
    await admin.from('store_pos_settings').delete().eq('store_id', storeId);
  }
  await admin.from('event_log').delete().eq('actor_user_id', userId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

test('o dono desliga o cartão, junta uma nota rápida e grava o POS da Matola', async ({ page }) => {
  await page.goto('/login?next=/definicoes-pos');
  await page.waitForLoadState('networkidle');
  await dismissCookies(page);
  await page.getByPlaceholder('dono@restaurante.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/definicoes-pos$/);
  await dismissCookies(page);

  await page.getByRole('button', { name: 'Matola', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meios de pagamento' })).toBeVisible();

  await page.getByLabel('Ligar Cartão').uncheck();
  await page.getByPlaceholder('Ex.: SEM PICLES').fill(nota);
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await expect(page.getByRole('button', { name: `Tirar ${nota.toUpperCase()}` })).toBeVisible();

  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('actualiza sozinho')).toBeVisible();

  await expect
    .poll(async () => {
      const { data } = await admin
        .from('store_pos_settings')
        .select('config')
        .eq('store_id', storeId)
        .single();
      const config = data?.config as {
        quickNotes?: string[];
        payments?: { methods?: Array<{ id: string; enabled: boolean }> };
      };
      return {
        nota: config?.quickNotes?.includes(nota.toUpperCase()) ?? false,
        cartao: config?.payments?.methods?.find((m) => m.id === 'credit_card')?.enabled,
      };
    })
    .toEqual({ nota: true, cartao: false });

  await page.screenshot({ path: 'output/playwright/definicoes-pos.png', fullPage: true });
});
