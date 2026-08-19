/**
 * Testes de integração — payments + confirm_payment (F2.1)
 * Requer `supabase start` + `supabase db reset` antes de correr.
 *
 * Coberturas:
 *   (a) create_order com flow=digital → status=awaiting_payment
 *   (b) confirm_payment happy path → 'ok', order='paid', print_job criado
 *   (c) confirm_payment duplicado → 'duplicate' (idempotência)
 *   (d) confirm_payment amount_mismatch → não confirma, loga evento
 *   (e) confirm_payment invalid_state → payment confirmado, order não transiciona
 *   (f) get_menu inclui payment_provider e mpesa_number
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL  = process.env.SUPABASE_URL  ?? 'http://localhost:54531';
const ANON_KEY      = process.env.SUPABASE_ANON_KEY        ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';

const TEST_EMAIL    = 'payments-staff@delivery.test';
const TEST_PASSWORD = 'test-staff-pay-123!';

let admin:      SupabaseClient;
let staff:      SupabaseClient;
let anon:       SupabaseClient;
let menuItemId: string;
let testUserId: string;

const ITEM_PRICE = 65000; // Caril de Camarao (seed)

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY);
  anon  = createClient(SUPABASE_URL, ANON_KEY);

  const { data: created } = await admin.auth.admin.createUser({
    email:         TEST_EMAIL,
    password:      TEST_PASSWORD,
    email_confirm: true,
  });
  testUserId = created.user?.id ?? '';

  staff = createClient(SUPABASE_URL, ANON_KEY);
  const { error: signInErr } = await staff.auth.signInWithPassword({
    email: TEST_EMAIL, password: TEST_PASSWORD,
  });
  if (signInErr) throw new Error(`Autenticação falhou: ${signInErr.message}`);

  const { data: item, error } = await admin
    .from('menu_items')
    .select('id')
    .eq('name', 'Caril de Camarao')
    .single();
  if (error || !item) throw new Error(`Setup: item não encontrado — ${error?.message}`);
  menuItemId = item.id;
});

afterAll(async () => {
  if (testUserId) await admin.auth.admin.deleteUser(testUserId);
});

afterEach(async () => {
  // Limpar pedidos de teste (cascata elimina payments + print_jobs + order_items + event_log)
  await admin
    .from('orders')
    .delete()
    .eq('customer_name', 'Teste Digital');
});

// Helper: cria pedido digital via anon RPC
async function createDigitalOrder(qty = 1): Promise<string> {
  const { data: orderId, error } = await anon.rpc('create_order', {
    p_payload: {
      items:          [{ menuItemId, qty }],
      customerName:   'Teste Digital',
      fulfillmentType: 'pickup',
      paymentMethod:  'mpesa',
      flow:           'digital',
    },
  });
  if (error || !orderId) throw new Error(`create_order falhou: ${error?.message}`);
  return orderId as string;
}

// ─── (a) create_order flow=digital ──────────────────────────────────────────

describe('(a) create_order flow=digital', () => {
  it('cria pedido com status=awaiting_payment e flow=digital', async () => {
    const orderId = await createDigitalOrder(1);

    const { data: order } = await admin
      .from('orders')
      .select('status, flow, total_cents')
      .eq('id', orderId)
      .single();

    expect(order!.status).toBe('awaiting_payment');
    expect(order!.flow).toBe('digital');
    expect(order!.total_cents).toBe(ITEM_PRICE);
  });

  it('create_order sem flow → status=awaiting_approval (retrocompat)', async () => {
    const { data: orderId } = await anon.rpc('create_order', {
      p_payload: {
        items:          [{ menuItemId, qty: 1 }],
        customerName:   'Teste Digital',
        fulfillmentType: 'pickup',
        paymentMethod:  'mpesa',
      },
    });

    const { data: order } = await admin
      .from('orders')
      .select('status, flow')
      .eq('id', orderId)
      .single();

    expect(order!.status).toBe('awaiting_approval');
    expect(order!.flow).toBe('manual');
  });
});

// ─── (b) confirm_payment happy path ─────────────────────────────────────────

describe('(b) confirm_payment — happy path', () => {
  it("retorna 'ok', order fica 'paid', print_job criado", async () => {
    const orderId        = await createDigitalOrder(1);
    const idempotencyKey = `order_${orderId}`;

    const { data: result, error } = await staff.rpc('confirm_payment', {
      p_idempotency_key: idempotencyKey,
      p_order_id:        orderId,
      p_provider:        'mock',
      p_provider_ref:    'mock_ref_001',
      p_method:          'mpesa',
      p_amount_cents:    ITEM_PRICE,
      p_raw_webhook:     { event: 'payment.success', test: true },
    });

    expect(error).toBeNull();
    expect(result).toBe('ok');

    // Order deve estar 'paid'
    const { data: order } = await admin
      .from('orders').select('status').eq('id', orderId).single();
    expect(order!.status).toBe('paid');

    // print_job deve ter sido criado
    const { data: jobs } = await admin
      .from('print_jobs').select('station, status').eq('order_id', orderId);
    expect(jobs!.length).toBe(1);
    expect(jobs![0].station).toBe('kitchen');
    expect(jobs![0].status).toBe('queued');

    // Payment record confirmado
    const { data: payment } = await admin
      .from('payments').select('status, provider').eq('idempotency_key', idempotencyKey).single();
    expect(payment!.status).toBe('confirmed');
    expect(payment!.provider).toBe('mock');
  });
});

// ─── (c) idempotência ────────────────────────────────────────────────────────

describe('(c) confirm_payment — idempotência', () => {
  it("segunda chamada com mesmo idempotency_key → 'duplicate'", async () => {
    const orderId        = await createDigitalOrder(1);
    const idempotencyKey = `order_${orderId}`;
    const args = {
      p_idempotency_key: idempotencyKey,
      p_order_id:        orderId,
      p_provider:        'mock',
      p_provider_ref:    'mock_ref_002',
      p_method:          'mpesa',
      p_amount_cents:    ITEM_PRICE,
    };

    const { data: first }  = await staff.rpc('confirm_payment', args);
    const { data: second } = await staff.rpc('confirm_payment', args);

    expect(first).toBe('ok');
    expect(second).toBe('duplicate');

    // Apenas 1 payment record
    const { data: payments } = await admin
      .from('payments').select('id').eq('order_id', orderId);
    expect(payments!.length).toBe(1);
  });
});

// ─── (d) amount_mismatch ─────────────────────────────────────────────────────

describe('(d) confirm_payment — amount_mismatch', () => {
  it("montante errado → 'amount_mismatch', order permanece awaiting_payment", async () => {
    const orderId = await createDigitalOrder(1);

    const { data: result } = await staff.rpc('confirm_payment', {
      p_idempotency_key: `order_${orderId}_mismatch`,
      p_order_id:        orderId,
      p_provider:        'mock',
      p_provider_ref:    'mock_ref_003',
      p_method:          'mpesa',
      p_amount_cents:    1, // errado (deveria ser ITEM_PRICE)
    });

    expect(result).toBe('amount_mismatch');

    const { data: order } = await admin
      .from('orders').select('status').eq('id', orderId).single();
    expect(order!.status).toBe('awaiting_payment'); // não transicionou

    // Evento de mismatch logado
    const { data: events } = await admin
      .from('event_log')
      .select('type').eq('order_id', orderId).eq('type', 'payment.amount_mismatch');
    expect(events!.length).toBe(1);
  });
});

// ─── (e) invalid_state ───────────────────────────────────────────────────────

describe('(e) confirm_payment — invalid_state', () => {
  it("pedido já entregue → 'invalid_state', payment confirmado mas order não muda", async () => {
    const orderId = await createDigitalOrder(1);

    // Forçar pedido para 'delivered' diretamente
    await admin
      .from('orders')
      .update({ status: 'delivered', updated_at: new Date().toISOString() })
      .eq('id', orderId);

    const { data: result } = await staff.rpc('confirm_payment', {
      p_idempotency_key: `order_${orderId}`,
      p_order_id:        orderId,
      p_provider:        'mock',
      p_provider_ref:    'mock_ref_004',
      p_method:          'mpesa',
      p_amount_cents:    ITEM_PRICE,
    });

    expect(result).toBe('invalid_state');

    // Order continua 'delivered'
    const { data: order } = await admin
      .from('orders').select('status').eq('id', orderId).single();
    expect(order!.status).toBe('delivered');

    // Payment foi criado mas o estado do order não mudou
    const { data: payment } = await admin
      .from('payments').select('status').eq('order_id', orderId).single();
    expect(payment!.status).toBe('confirmed');
  });
});

// ─── (f) get_menu inclui payment_settings ────────────────────────────────────

describe('(f) get_menu com payment_settings', () => {
  it('retorna payment_provider e mpesa_number no topo', async () => {
    const { data, error } = await anon.rpc('get_menu');

    expect(error).toBeNull();
    expect(data).toHaveProperty('payment_provider');
    expect(data).toHaveProperty('mpesa_number');
    expect(data).toHaveProperty('emola_number');
    expect(data).toHaveProperty('accepting_orders');
    expect(Array.isArray(data.categories)).toBe(true);
    expect(Array.isArray(data.zones)).toBe(true);
  });
});
