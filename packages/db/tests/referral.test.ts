/**
 * Testes de integração — F5.1: Indique e Ganhe + Cupom/Presente
 * Requer `supabase start` + `supabase db reset` antes de correr.
 *
 * Coberturas:
 *   (a) validate_referral: código inválido/expirado → { valid: false }
 *   (b) validate_referral: auto-resgate → { valid: false }
 *   (c) validate_referral: já resgatado → { valid: false }
 *   (d) create_order: auto-resgate → erro 'referral_auto_redemption'
 *   (e) create_order: 2º resgate → erro 'referral_already_redeemed'
 *   (f) create_order: item is_gift sem cupom → erro 'gift_item_not_authorized'
 *   (g) create_order: desconto adulterado no payload é ignorado (total recalculado)
 *   (h) create_order: discount_cents aplicado corretamente pelo servidor
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://localhost:54531';
const ANON_KEY     = process.env.SUPABASE_ANON_KEY        ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';

let admin: SupabaseClient;
let anon:  SupabaseClient;

let testMenuItemId: string;
let giftMenuItemId: string;
let codeId: string;
let discountCodeId: string;

const OWNER_PHONE    = '841000001';
const CUSTOMER_PHONE = '841000002';
const OTHER_PHONE    = '841000003';

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY);
  anon  = createClient(SUPABASE_URL, ANON_KEY);

  // Item normal (seed: Caril de Camarao)
  const { data: item } = await admin
    .from('menu_items')
    .select('id')
    .eq('name', 'Caril de Camarao')
    .single();
  if (!item) throw new Error('Item seed não encontrado — correr pnpm db:migrate');
  testMenuItemId = item.id;

  // Item brinde (is_gift = true) — criar se não existir
  const { data: cat } = await admin
    .from('menu_categories')
    .select('id')
    .limit(1)
    .single();
  if (!cat) throw new Error('Categoria seed não encontrada');

  // menu_items.name não tem constraint UNIQUE — upsert(onConflict:'name') falhava
  // silenciosamente (erro descartado) e o teste morria em "Falha ao criar item brinde".
  // Select-then-insert em vez de depender de uma constraint que não existe.
  const { data: existingGift } = await admin
    .from('menu_items')
    .select('id')
    .eq('name', 'Brinde Teste')
    .maybeSingle();

  let gift = existingGift;
  if (!gift) {
    const { data: created, error: createErr } = await admin
      .from('menu_items')
      .insert({ name: 'Brinde Teste', price_cents: 0, category_id: cat.id, available: true, is_gift: true, sort: 999 })
      .select('id')
      .single();
    if (createErr || !created) throw new Error(`Falha ao criar item brinde — ${createErr?.message}`);
    gift = created;
  }
  giftMenuItemId = gift.id;

  // Código de brinde (free_item). referral_codes.code é UNIQUE — upsert(onConflict)
  // torna o setup idempotente a reruns sem `supabase db reset` entre eles
  // (insert simples colidia com a linha 'TESTBRINDE' deixada por uma corrida anterior).
  const { data: rc, error: rcErr } = await admin
    .from('referral_codes')
    .upsert({
      code: 'TESTBRINDE',
      owner_phone: OWNER_PHONE,
      owner_name: 'Proprietário Teste',
      reward_type: 'free_item',
      reward_value: 0,
      gift_item_id: giftMenuItemId,
      max_redemptions: 5,
      active: true,
    }, { onConflict: 'code' })
    .select('id')
    .single();
  if (rcErr || !rc) throw new Error(`Falha ao criar código de brinde — ${rcErr?.message}`);
  codeId = rc.id;

  // Código de desconto em centavos (mesmo motivo: upsert por 'code')
  const { data: dc, error: dcErr } = await admin
    .from('referral_codes')
    .upsert({
      code: 'TESTDESC',
      owner_phone: OWNER_PHONE,
      owner_name: 'Proprietário Teste',
      reward_type: 'discount_cents',
      reward_value: 5000, // 50 MT
      max_redemptions: 10,
      active: true,
    }, { onConflict: 'code' })
    .select('id')
    .single();
  if (dcErr || !dc) throw new Error(`Falha ao criar código de desconto — ${dcErr?.message}`);
  discountCodeId = dc.id;
});

afterAll(async () => {
  // Limpar dados de teste
  if (codeId)        await admin.from('referral_codes').delete().eq('id', codeId);
  if (discountCodeId) await admin.from('referral_codes').delete().eq('id', discountCodeId);
  if (giftMenuItemId) await admin.from('menu_items').delete().eq('id', giftMenuItemId);
});

// ─── validate_referral ────────────────────────────────────────────────────────

describe('validate_referral', () => {
  it('(a) código inválido → valid: false', async () => {
    const { data } = await anon.rpc('validate_referral', {
      p_code: 'NAOEXISTE',
      p_phone: CUSTOMER_PHONE,
    });
    expect(data.valid).toBe(false);
    expect(data.reason).toBe('invalid_or_expired');
  });

  it('(b) auto-resgate (dono tenta usar o próprio código) → valid: false', async () => {
    const { data } = await anon.rpc('validate_referral', {
      p_code: 'TESTBRINDE',
      p_phone: OWNER_PHONE,
    });
    expect(data.valid).toBe(false);
    expect(data.reason).toBe('auto_redemption');
  });

  it('código válido por cliente diferente → valid: true', async () => {
    const { data } = await anon.rpc('validate_referral', {
      p_code: 'TESTBRINDE',
      p_phone: CUSTOMER_PHONE,
    });
    expect(data.valid).toBe(true);
    expect(data.reward_type).toBe('free_item');
  });
});

// ─── create_order — anti-abuso ───────────────────────────────────────────────

const basePayload = () => ({
  customerName: 'Cliente Teste',
  customerPhone: CUSTOMER_PHONE,
  fulfillmentType: 'pickup',
  paymentMethod: 'mpesa',
  items: [{ menuItemId: testMenuItemId, qty: 1 }],
});

describe('create_order — referral anti-abuso', () => {
  it('(d) auto-resgate → erro referral_auto_redemption', async () => {
    const { error } = await anon.rpc('create_order', {
      p_payload: {
        ...basePayload(),
        customerPhone: OWNER_PHONE,
        referralCode: 'TESTBRINDE',
      },
    });
    expect(error?.message).toContain('referral_auto_redemption');
  });

  it('(f) item is_gift sem cupom → erro gift_item_not_authorized', async () => {
    const { error } = await anon.rpc('create_order', {
      p_payload: {
        ...basePayload(),
        items: [{ menuItemId: giftMenuItemId, qty: 1 }],
      },
    });
    expect(error?.message).toContain('gift_item_not_authorized');
  });

  it('(g) desconto adulterado no payload é ignorado', async () => {
    const { data: orderId, error } = await anon.rpc('create_order', {
      p_payload: {
        ...basePayload(),
        customerPhone: OTHER_PHONE,
        referralCode: 'TESTDESC',
        discount_cents: 999999, // tentativa de fraude no payload
      },
    });
    expect(error).toBeNull();

    // O servidor recalcula: discount deve ser 5000 (reward_value), não 999999
    const { data: order } = await admin
      .from('orders')
      .select('discount_cents, subtotal_cents, total_cents')
      .eq('id', orderId)
      .single();
    expect(order?.discount_cents).toBe(5000);
    expect(order?.total_cents).toBe(order!.subtotal_cents - 5000);
  });

  it('(e) 2º resgate pelo mesmo telefone → erro referral_already_redeemed', async () => {
    // OTHER_PHONE já resgatou TESTDESC no teste anterior
    const { error } = await anon.rpc('create_order', {
      p_payload: {
        ...basePayload(),
        customerPhone: OTHER_PHONE,
        referralCode: 'TESTDESC',
      },
    });
    expect(error?.message).toContain('referral_already_redeemed');
  });
});
