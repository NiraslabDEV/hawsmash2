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
let copiesBefore: number | null = null;

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

  const { data: loja, error: copiesError } = await admin
    .from('stores')
    .select('kitchen_ticket_copies')
    .eq('id', storeId)
    .single();
  if (copiesError) throw new Error(`E2E POS: vias — ${copiesError.message}`);
  copiesBefore = loja.kitchen_ticket_copies;

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
  if (copiesBefore !== null) {
    await admin.from('stores').update({ kitchen_ticket_copies: copiesBefore }).eq('id', storeId);
  }
  if (before) {
    await admin.from('store_pos_settings').update({ config: before.config }).eq('store_id', storeId);
  } else {
    await admin.from('store_pos_settings').delete().eq('store_id', storeId);
  }
  await admin.from('event_log').delete().eq('actor_user_id', userId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

async function entrarNaMatola(page: Page) {
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
}

async function configDaMatola() {
  const { data } = await admin.from('store_pos_settings').select('config').eq('store_id', storeId).single();
  return data?.config as {
    quickNotes?: string[];
    payments?: { methods?: Array<{ id: string; enabled: boolean }> };
    upsell?: { steps?: { companion?: { productIds?: string[] } } };
  };
}

test('o dono escolhe os produtos do passo Acompanhar só para a Matola', async ({ page }) => {
  await entrarNaMatola(page);

  // Arranca do que o Cardápio oferece hoje; tira-se o primeiro.
  await page.getByRole('button', { name: /Escolher para esta loja/ }).first().click();
  const lista = page.locator('ol').first().locator('li');
  await expect(lista.first()).toBeVisible();
  const antes = await lista.count();
  expect(antes).toBeGreaterThan(1);
  await page.getByRole('button', { name: / do upsell$/ }).first().click();
  await expect(lista).toHaveCount(antes - 1);

  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('actualiza em até 2 minutos')).toBeVisible();

  await expect
    .poll(async () => (await configDaMatola())?.upsell?.steps?.companion?.productIds?.length ?? 0)
    .toBe(antes - 1);
});

test('o dono põe 3 vias e a via do cliente no modelo Cozinha, e vê-o na pré-visualização', async ({ page }) => {
  await entrarNaMatola(page);
  await expect(page.getByRole('heading', { name: 'Impressão' })).toBeVisible();

  await page.getByRole('button', { name: '3', exact: true }).click();
  const viaCliente = page.locator('div.rounded-xl', { hasText: 'Via do cliente' }).filter({
    has: page.getByRole('button', { name: 'Cozinha', exact: true }),
  });
  await viaCliente.first().getByRole('button', { name: 'Cozinha', exact: true }).click();

  // A pré-visualização da via do cliente deixa de ter preços.
  const papel = page.getByLabel('Pré-visualização do talão');
  await expect(papel).toContainText('VIA DO CLIENTE');
  await expect(papel).not.toContainText('TOTAL');

  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('actualiza em até 2 minutos')).toBeVisible();

  await expect
    .poll(async () => {
      const config = (await configDaMatola()) as { printing?: { templates?: { cliente?: string } } };
      const { data: loja } = await admin.from('stores').select('kitchen_ticket_copies').eq('id', storeId).single();
      return { modelo: config?.printing?.templates?.cliente, vias: loja?.kitchen_ticket_copies };
    })
    .toEqual({ modelo: 'cozinha', vias: 3 });

  await page
    .locator('section', { has: page.getByRole('heading', { name: 'Impressão' }) })
    .screenshot({ path: 'output/playwright/definicoes-pos-impressao.png' });
});

test('o dono desliga o cartão, junta uma nota rápida e grava o POS da Matola', async ({ page }) => {
  await entrarNaMatola(page);

  await page.getByLabel('Ligar Cartão').uncheck();
  await page.getByPlaceholder('Ex.: SEM PICLES').fill(nota);
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await expect(page.getByRole('button', { name: `Tirar ${nota.toUpperCase()}` })).toBeVisible();

  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('actualiza em até 2 minutos')).toBeVisible();

  await expect
    .poll(async () => {
      const config = await configDaMatola();
      return {
        nota: config?.quickNotes?.includes(nota.toUpperCase()) ?? false,
        cartao: config?.payments?.methods?.find((m) => m.id === 'credit_card')?.enabled,
      };
    })
    .toEqual({ nota: true, cartao: false });

  await page.screenshot({ path: 'output/playwright/definicoes-pos.png', fullPage: true });
});
