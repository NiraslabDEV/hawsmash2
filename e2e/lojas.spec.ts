import { expect, test, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error('E2E das lojas exige SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY de staging.');
}

let admin: SupabaseClient;
let storeId: string;
let userId: string;
let createdZoneId: string | null = null;

const password = 'E2E-Lojas-2026-Seguro!';
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `lojas-e2e-${suffix}@delivery.test`;
const zoneName = `Zona E2E ${`${Date.now()}`.slice(-5)}`;

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
  if (storeError || !store) throw new Error(`E2E lojas: loja — ${storeError?.message}`);
  storeId = store.id;

  const { data: user, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userError || !user.user) throw new Error(`E2E lojas: dono — ${userError?.message}`);
  userId = user.user.id;

  const { error: profileError } = await admin.from('staff_profiles').insert({
    user_id: userId,
    full_name: 'Dono E2E Lojas',
    role: 'owner',
    active: true,
  });
  if (profileError) throw new Error(`E2E lojas: perfil — ${profileError.message}`);
});

test.afterAll(async () => {
  if (!admin) return;
  if (createdZoneId) await admin.from('delivery_zones').delete().eq('id', createdZoneId);
  await admin.from('stores').update({ accepting_orders: true }).eq('id', storeId);
  await admin.from('event_log').delete().eq('actor_user_id', userId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

test('fecha a loja com motivo e cria uma zona de entrega pelo painel', async ({ page }) => {
  await page.goto('/login?next=/lojas');
  await page.waitForLoadState('networkidle');
  await dismissCookies(page);
  await page.getByPlaceholder('dono@restaurante.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/lojas$/);
  await dismissCookies(page);

  await page.getByRole('button', { name: 'Matola', exact: true }).click();
  await expect(page.getByText('/matola')).toBeVisible();

  // Kill switch com motivo obrigatório.
  await page.getByLabel('Motivo (fica no registo)').fill('Ensaio E2E');
  await page.getByRole('button', { name: 'Fechar loja agora' }).click();
  await expect(page.getByText('deixou de aceitar pedidos')).toBeVisible();

  await expect
    .poll(async () => {
      const { data } = await admin
        .from('stores')
        .select('accepting_orders')
        .eq('id', storeId)
        .single();
      return data?.accepting_orders ?? null;
    })
    .toBe(false);

  const { data: events } = await admin
    .from('event_log')
    .select('type,payload')
    .eq('actor_user_id', userId)
    .eq('type', 'store.accepting_orders_changed')
    .order('created_at', { ascending: false })
    .limit(1);
  expect(events?.[0].payload).toMatchObject({ accepting_orders: false, reason: 'Ensaio E2E' });

  // Zona de entrega guardada pelo painel, com a taxa em centavos no servidor.
  await page.getByLabel('Zona').fill(zoneName);
  await page.getByLabel('Taxa (MT)').fill('200');
  await page.getByRole('button', { name: 'Adicionar zona' }).click();
  await expect(page.getByText('Zona de entrega guardada.')).toBeVisible();

  await expect
    .poll(async () => {
      const { data } = await admin
        .from('delivery_zones')
        .select('id,fee_cents')
        .eq('store_id', storeId)
        .eq('name', zoneName)
        .maybeSingle();
      createdZoneId = data?.id ?? null;
      return data?.fee_cents ?? null;
    })
    .toBe(20000);

  await expect(page.getByText(zoneName)).toBeVisible();

  // Reabrir deixa a loja como estava.
  await page.getByLabel('Motivo (fica no registo)').fill('Fim do ensaio');
  await page.getByRole('button', { name: 'Reabrir loja' }).click();
  await expect(page.getByText('voltou a aceitar pedidos')).toBeVisible();
});
