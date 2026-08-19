/**
 * Testes de integração — stock management + heartbeats (F2.3)
 * Requer `supabase start` + `supabase db reset` antes de correr.
 *
 * Coberturas:
 *   (a) Dedução atómica de stock em confirm_payment
 *   (b) Trigger: stock_qty=0 → available=false
 *   (c) Rollback total quando item esgota dentro da transação
 *   (d) Concorrência: 2 pedidos a disputar o último item → só 1 confirma
 *   (e) Ajuste manual de stock com logging
 *   (f) Device heartbeats (upsert, get_device_status)
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL  = process.env.SUPABASE_URL  ?? 'http://localhost:54531';
const ANON_KEY      = process.env.SUPABASE_ANON_KEY        ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';

const TEST_EMAIL    = 'stock-staff@delivery.test';
const TEST_PASSWORD = 'test-stock-123!';

let admin:      SupabaseClient;
let staff:      SupabaseClient;
let anon:       SupabaseClient;
let testUserId: string;
let menuItemId: string;

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

  // Get a menu item that tracks stock
  const { data: item, error } = await admin
    .from('menu_items')
    .select('id, stock_qty, track_stock, available')
    .eq('name', 'Caril de Camarao')
    .single();
  if (error || !item) throw new Error(`Setup: item não encontrado — ${error?.message}`);
  menuItemId = item.id;

  // Ensure stock tracking is enabled and we have stock
  await admin
    .from('menu_items')
    .update({
      stock_qty: 10,
      track_stock: true,
      available: true
    })
    .eq('id', menuItemId);
});

afterAll(async () => {
  if (testUserId) await admin.auth.admin.deleteUser(testUserId);
});

afterEach(async () => {
  // Reset stock for menu item
  await admin
    .from('menu_items')
    .update({ 
      stock_qty: 10,
      track_stock: true,
      available: true
    })
    .eq('id', menuItemId);

  // Limpar pedidos de teste (cascata elimina payments + print_jobs + order_items + event_log)
  await admin
    .from('orders')
    .delete()
    .like('customer_name', 'Stock%');

  // Limpar device_heartbeats
  await admin
    .from('device_heartbeats')
    .delete()
    .neq('id', 'never');
});

// Helper: cria pedido digital via anon RPC
async function createDigitalOrder(customerName: string, qty = 1): Promise<string> {
  const { data: orderId, error } = await anon.rpc('create_order', {
    p_payload: {
      items:          [{ menuItemId, qty }],
      customerName:   customerName,
      fulfillmentType: 'pickup',
      paymentMethod:  'mpesa',
      flow:           'digital',
    },
  });
  if (error || !orderId) throw new Error(`create_order falhou: ${error?.message}`);
  return orderId as string;
}

// ─── (a) Dedução atómica de stock em confirm_payment ────────────────────────────

describe('(a) Dedução atómica de stock em confirm_payment', () => {
  it('deduz stock correctamente quando há quantidade suficiente', async () => {
    // Set initial stock
    await admin
      .from('menu_items')
      .update({ stock_qty: 10, track_stock: true, available: true })
      .eq('id', menuItemId);

    const orderId = await createDigitalOrder('Stock Test 1', 3);
    const idempotencyKey = `order_${orderId}`;

    // Confirm payment
    const { data: result, error } = await staff.rpc('confirm_payment', {
      p_idempotency_key: idempotencyKey,
      p_order_id:        orderId,
      p_provider:        'mock',
      p_provider_ref:    'mock_ref_stock_001',
      p_method:          'mpesa',
      p_amount_cents:    ITEM_PRICE * 3,
    });

    expect(error).toBeNull();
    expect(result).toBe('ok');

    // Check stock was deducted
    const { data: item } = await admin
      .from('menu_items')
      .select('stock_qty')
      .eq('id', menuItemId)
      .single();
    expect(item!.stock_qty).toBe(7); // 10 - 3
  });

  it('não deduz stock quando track_stock=false', async () => {
    // Disable stock tracking
    await admin
      .from('menu_items')
      .update({ stock_qty: 10, track_stock: false, available: true })
      .eq('id', menuItemId);

    const initialStock = 10;
    const orderId = await createDigitalOrder('Stock Test 2', 3);
    const idempotencyKey = `order_${orderId}`;

    // Confirm payment
    const { data: result, error } = await staff.rpc('confirm_payment', {
      p_idempotency_key: idempotencyKey,
      p_order_id:        orderId,
      p_provider:        'mock',
      p_provider_ref:    'mock_ref_stock_002',
      p_method:          'mpesa',
      p_amount_cents:    ITEM_PRICE * 3,
    });

    expect(error).toBeNull();
    expect(result).toBe('ok');

    // Check stock was NOT deducted
    const { data: item } = await admin
      .from('menu_items')
      .select('stock_qty')
      .eq('id', menuItemId)
      .single();
    expect(item!.stock_qty).toBe(initialStock); // Still 10
  });
});

// ─── (b) Trigger: stock_qty=0 → available=false ──────────────────────────────────

describe('(b) Trigger: stock_qty=0 → available=false', () => {
  it('marca available=false quando stock chega a zero', async () => {
    // Set stock to 1
    await admin
      .from('menu_items')
      .update({ stock_qty: 1, track_stock: true, available: true })
      .eq('id', menuItemId);

    // Create and confirm order for the last item
    const orderId = await createDigitalOrder('Stock Test 3', 1);
    const idempotencyKey = `order_${orderId}`;

    await staff.rpc('confirm_payment', {
      p_idempotency_key: idempotencyKey,
      p_order_id:        orderId,
      p_provider:        'mock',
      p_provider_ref:    'mock_ref_stock_003',
      p_method:          'mpesa',
      p_amount_cents:    ITEM_PRICE,
    });

    // Check available is false
    const { data: item } = await admin
      .from('menu_items')
      .select('stock_qty, available')
      .eq('id', menuItemId)
      .single();
    expect(item!.stock_qty).toBe(0);
    expect(item!.available).toBe(false);
  });

  it('mantém available=false mesmo quando stock é aumentado manualmente', async () => {
    // Set stock to 0 and available to false
    await admin
      .from('menu_items')
      .update({ stock_qty: 0, track_stock: true, available: false })
      .eq('id', menuItemId);

    // Manually increase stock
    await admin
      .from('menu_items')
      .update({ stock_qty: 5 })
      .eq('id', menuItemId);

    // available should still be false (manual decision required)
    const { data: item } = await admin
      .from('menu_items')
      .select('stock_qty, available')
      .eq('id', menuItemId)
      .single();
    expect(item!.stock_qty).toBe(5);
    expect(item!.available).toBe(false);
  });
});

// ─── (c) Rollback total quando item esgota dentro da transação ─────────────────

describe('(c) Rollback total quando item esgota', () => {
  it('create_order já rejeita (fail-fast) quando o stock é insuficiente — nunca chega a confirm_payment', async () => {
    // NOTA: migration 20260614000020_stock_check_on_create_order.sql tornou este
    // caso fail-fast de propósito ("dá erro imediato ao cliente no front" em vez
    // de deixar o pedido nascer e falhar só na aprovação). O teste original
    // assumia que create_order aceitava qty > stock e que o rollback acontecia
    // dentro de confirm_payment — isso já não é verdade; create_order rejeita
    // primeiro. A garantia atómica em confirm_payment continua coberta pelo
    // teste de concorrência (d), onde cada pedido individual pede uma
    // quantidade válida no momento da criação.
    await admin
      .from('menu_items')
      .update({ stock_qty: 2, track_stock: true, available: true })
      .eq('id', menuItemId);

    const { data: orderId, error } = await anon.rpc('create_order', {
      p_payload: {
        items:          [{ menuItemId, qty: 5 }], // pede 5, só há 2
        customerName:   'Stock Test 4',
        fulfillmentType: 'pickup',
        paymentMethod:  'mpesa',
        flow:           'digital',
      },
    });

    expect(orderId).toBeNull();
    expect(error).toBeTruthy();
    expect(error!.message).toContain('out_of_stock');

    // Stock não foi tocado; nenhum pedido chegou a ser criado
    const { data: item } = await admin
      .from('menu_items')
      .select('stock_qty')
      .eq('id', menuItemId)
      .single();
    expect(item!.stock_qty).toBe(2);

    const { count } = await admin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('customer_name', 'Stock Test 4');
    expect(count).toBe(0);
  });
});

// ─── (d) Concorrência: 2 pedidos a disputar o último item ───────────────────────

describe('(d) Concorrência: 2 pedidos disputam último item', () => {
  it('só 1 pedido confirma quando há stock suficiente para apenas 1', async () => {
    // Set stock to 1
    await admin
      .from('menu_items')
      .update({ stock_qty: 1, track_stock: true, available: true })
      .eq('id', menuItemId);

    // Create two orders simultaneously
    const order1Id = await createDigitalOrder('Stock Test 5a', 1);
    const order2Id = await createDigitalOrder('Stock Test 5b', 1);

    // Try to confirm both payments simultaneously (race condition)
    const results = await Promise.allSettled([
      staff.rpc('confirm_payment', {
        p_idempotency_key: `order_${order1Id}`,
        p_order_id:        order1Id,
        p_provider:        'mock',
        p_provider_ref:    'mock_ref_stock_005a',
        p_method:          'mpesa',
        p_amount_cents:    ITEM_PRICE,
      }),
      staff.rpc('confirm_payment', {
        p_idempotency_key: `order_${order2Id}`,
        p_order_id:        order2Id,
        p_provider:        'mock',
        p_provider_ref:    'mock_ref_stock_005b',
        p_method:          'mpesa',
        p_amount_cents:    ITEM_PRICE,
      }),
    ]);

    // One should succeed, one should fail.
    // supabase-js nunca rejeita a promise do .rpc() — resolve sempre com
    // { data, error }. `r.value` é esse objeto, não a string 'ok' diretamente
    // (bug do teste: o filtro original comparava r.value === 'ok', que nunca
    // era verdade, dando sempre successCount=0).
    const successCount = results.filter(r =>
      r.status === 'fulfilled' && r.value.data === 'ok' && !r.value.error
    ).length;
    const failureCount = results.filter(r =>
      r.status === 'rejected' ||
      (r.status === 'fulfilled' && (r.value.data !== 'ok' || r.value.error))
    ).length;

    expect(successCount).toBe(1);
    expect(failureCount).toBe(1);

    // Stock should be 0 (only one order succeeded)
    const { data: item } = await admin
      .from('menu_items')
      .select('stock_qty')
      .eq('id', menuItemId)
      .single();
    expect(item!.stock_qty).toBe(0);

    // One order should be paid, one should still be awaiting_payment
    const { data: orders } = await admin
      .from('orders')
      .select('id, status')
      .in('id', [order1Id, order2Id]);
    
    const paidOrders = orders!.filter(o => o.status === 'paid');
    const awaitingOrders = orders!.filter(o => o.status === 'awaiting_payment');
    
    expect(paidOrders.length).toBe(1);
    expect(awaitingOrders.length).toBe(1);
  });
});

// ─── (e) Ajuste manual de stock com logging ─────────────────────────────────────

describe('(e) Ajuste manual de stock com logging', () => {
  it('ajusta stock correctamente e loga evento', async () => {
    // Set initial stock
    await admin
      .from('menu_items')
      .update({ stock_qty: 10, track_stock: true, available: true })
      .eq('id', menuItemId);

    // Adjust stock
    const { data: result, error } = await staff.rpc('adjust_stock', {
      p_menu_item_id: menuItemId,
      p_new_qty:      15,
      p_reason:       'Reposição de stock',
      p_adjusted_by:  'staff@test.com',
    });

    expect(error).toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.old_qty).toBe(10);
    expect(result!.new_qty).toBe(15);
    expect(result!.diff).toBe(5);

    // Check stock was updated
    const { data: item } = await admin
      .from('menu_items')
      .select('stock_qty')
      .eq('id', menuItemId)
      .single();
    expect(item!.stock_qty).toBe(15);

    // Check event was logged
    const { data: events } = await admin
      .from('event_log')
      .select('type, payload')
      .eq('type', 'stock.adjusted');
    
    expect(events!.length).toBeGreaterThan(0);
    const lastEvent = events![events!.length - 1];
    expect(lastEvent.payload.menu_item_id).toBe(menuItemId);
    expect(lastEvent.payload.old_qty).toBe(10);
    expect(lastEvent.payload.new_qty).toBe(15);
    expect(lastEvent.payload.reason).toBe('Reposição de stock');
    expect(lastEvent.payload.adjusted_by).toBe('staff@test.com');
  });

  it('recusa stock negativo', async () => {
    const { data: result, error } = await staff.rpc('adjust_stock', {
      p_menu_item_id: menuItemId,
      p_new_qty:      -5,
      p_reason:       'Teste inválido',
    });

    expect(error).toBeTruthy();
    expect(error?.message).toContain('invalid_stock_qty');
  });

  it('recusa ajuste sem razão', async () => {
    const { data: result, error } = await staff.rpc('adjust_stock', {
      p_menu_item_id: menuItemId,
      p_new_qty:      20,
      p_reason:       '',
    });

    expect(error).toBeTruthy();
    expect(error?.message).toContain('adjust_reason_required');
  });

  it('recusa ajuste em item sem track_stock', async () => {
    // Disable stock tracking
    await admin
      .from('menu_items')
      .update({ track_stock: false })
      .eq('id', menuItemId);

    const { data: result, error } = await staff.rpc('adjust_stock', {
      p_menu_item_id: menuItemId,
      p_new_qty:      20,
      p_reason:       'Teste track_stock',
    });

    expect(error).toBeTruthy();
    expect(error?.message).toContain('stock_not_tracked');
  });
});

// ─── (f) Device heartbeats ──────────────────────────────────────────────────────

describe('(f) Device heartbeats', () => {
  it('upsert heartbeat correctamente', async () => {
    const { data: result, error } = await staff.rpc('upsert_heartbeat', {
      p_device_id: 'printer-001',
      p_kind:      'printer',
    });

    expect(error).toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.device_id).toBe('printer-001');
    expect(result!.kind).toBe('printer');

    // Check heartbeat was created
    const { data: heartbeat } = await admin
      .from('device_heartbeats')
      .select('*')
      .eq('id', 'printer-001')
      .single();
    
    expect(heartbeat).not.toBeNull();
    expect(heartbeat!.kind).toBe('printer');
    expect(heartbeat!.last_seen_at).toBeTruthy();
  });

  it('actualiza heartbeat existente', async () => {
    // Create initial heartbeat
    await staff.rpc('upsert_heartbeat', {
      p_device_id: 'printer-002',
      p_kind:      'printer',
    });

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 100));

    // Update heartbeat
    const { data: result } = await staff.rpc('upsert_heartbeat', {
      p_device_id: 'printer-002',
      p_kind:      'printer',
    });

    expect(result!.success).toBe(true);

    // Should still have only one record
    const { data: heartbeats } = await admin
      .from('device_heartbeats')
      .select('*')
      .eq('id', 'printer-002');
    
    expect(heartbeats).not.toBeNull();
    expect(heartbeats!.length).toBe(1);
  });

  it('get_device_status retorna status online/offline', async () => {
    // Create heartbeat that's online
    await staff.rpc('upsert_heartbeat', {
      p_device_id: 'printer-online',
      p_kind:      'printer',
    });

    // Create heartbeat that's offline (old)
    await admin
      .from('device_heartbeats')
      .insert({
        id: 'printer-offline',
        kind: 'printer',
        last_seen_at: new Date(Date.now() - 120000).toISOString(), // 2 minutes ago
      });

    const { data: result, error } = await staff.rpc('get_device_status');

    expect(error).toBeNull();
    expect(result!.threshold_seconds).toBe(60);
    expect(Array.isArray(result!.devices)).toBe(true);

    const onlineDevice = result!.devices.find((d: any) => d.id === 'printer-online');
    const offlineDevice = result!.devices.find((d: any) => d.id === 'printer-offline');

    expect(onlineDevice!.online).toBe(true);
    expect(offlineDevice!.online).toBe(false);
  });

  it('recusa kind inválido em upsert_heartbeat', async () => {
    const { data: result, error } = await staff.rpc('upsert_heartbeat', {
      p_device_id: 'invalid',
      p_kind:      'invalid_kind',
    });

    expect(error).toBeTruthy();
    expect(error?.message).toContain('invalid_device_kind');
  });
});