import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://localhost:54731';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';

let admin: SupabaseClient;
let storeId: string;
let orderId: string;
const technicalJobIds: string[] = [];
const technicalDeviceIds: string[] = [];

beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: store, error: storeError } = await admin
    .from('stores')
    .select('id')
    .eq('slug', 'maputo')
    .single();
  if (storeError || !store) throw new Error(`Setup F3: loja — ${storeError?.message}`);
  storeId = store.id;

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const { data: order, error: orderError } = await admin
    .from('orders')
    .insert({
      store_id: storeId,
      order_number: `F3-${suffix}`,
      status: 'paid',
      flow: 'manual',
      fulfillment_type: 'pickup',
      channel: 'counter',
      customer_name: 'Teste impressão F3',
      subtotal_cents: 30000,
      total_cents: 30000,
      payment_method: 'cash',
    })
    .select('id')
    .single();
  if (orderError || !order) throw new Error(`Setup F3: pedido — ${orderError?.message}`);
  orderId = order.id;
});

afterAll(async () => {
  if (technicalJobIds.length > 0) {
    await admin.from('print_jobs').delete().in('id', technicalJobIds);
  }
  if (orderId) await admin.from('orders').delete().eq('id', orderId);
  if (technicalDeviceIds.length > 0) {
    await admin.from('devices').delete().in('id', technicalDeviceIds);
  }
});

describe('F3 — heartbeat e watchdog', () => {
  it('regista e actualiza o bridge na tabela devices da loja', async () => {
    const deviceId = crypto.randomUUID();
    technicalDeviceIds.push(deviceId);

    const first = await admin.rpc('bridge_heartbeat', {
      p_device_id: deviceId,
      p_store_id: storeId,
      p_app_version: '2.0.0-teste',
    });
    const second = await admin.rpc('bridge_heartbeat', {
      p_device_id: deviceId,
      p_store_id: storeId,
      p_app_version: '2.0.1-teste',
    });
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();

    const { data: devices, error } = await admin
      .from('devices')
      .select('id,store_id,kind,label,app_version,active,last_seen_at')
      .eq('id', deviceId);
    expect(error).toBeNull();
    expect(devices).toHaveLength(1);
    expect(devices?.[0]).toMatchObject({
      store_id: storeId,
      kind: 'bridge',
      label: 'Print bridge',
      app_version: '2.0.1-teste',
      active: true,
    });
    expect(devices?.[0].last_seen_at).toBeTruthy();
  });

  it('recoloca jobs presos na fila e encerra os que esgotaram tentativas', async () => {
    const staleAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: jobs, error: insertError } = await admin
      .from('print_jobs')
      .insert([
        {
          store_id: storeId,
          order_id: null,
          station: 'counter',
          kind: 'test',
          payload: { test: true, message: 'Watchdog recupera' },
          status: 'printing',
          attempts: 1,
          claimed_at: staleAt,
        },
        {
          store_id: storeId,
          order_id: null,
          station: 'counter',
          kind: 'test',
          payload: { test: true, message: 'Watchdog encerra' },
          status: 'printing',
          attempts: 3,
          claimed_at: staleAt,
        },
      ])
      .select('id');
    expect(insertError).toBeNull();
    technicalJobIds.push(...(jobs?.map((job) => job.id) ?? []));

    const result = await admin.rpc('recover_stale_print_jobs', { p_store_id: storeId });
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ requeued: 1, failed: 1 });

    const { data: recovered } = await admin
      .from('print_jobs')
      .select('id,status,claimed_at')
      .in('id', technicalJobIds.slice(-2))
      .order('attempts');
    expect(recovered).toEqual([
      { id: jobs?.[0].id, status: 'queued', claimed_at: null },
      { id: jobs?.[1].id, status: 'failed', claimed_at: null },
    ]);

    const { data: events } = await admin
      .from('event_log')
      .select('type,payload')
      .in('payload->>job_id', technicalJobIds.slice(-2));
    expect(events?.map((event) => event.type).sort()).toEqual([
      'print.watchdog_failed',
      'print.watchdog_requeued',
    ]);
  });
});

describe('F3 — schema da fila de impressão', () => {
  it('impede dois jobs iguais para o mesmo pedido', async () => {
    const job = {
      store_id: storeId,
      order_id: orderId,
      station: 'kitchen',
      kind: 'order',
      reprint_seq: 0,
      payload: { order_number: 'F3-TESTE' },
    };

    const first = await admin.from('print_jobs').insert(job).select('id').single();
    const duplicate = await admin.from('print_jobs').insert(job);

    expect(first.error).toBeNull();
    expect(duplicate.error?.code).toBe('23505');
  });

  it('aceita uma reimpressão com sequência superior', async () => {
    const { data, error } = await admin
      .from('print_jobs')
      .insert({
        store_id: storeId,
        order_id: orderId,
        station: 'kitchen',
        kind: 'order',
        reprint_seq: 1,
        payload: { order_number: 'F3-TESTE' },
      })
      .select('reprint_seq')
      .single();

    expect(error).toBeNull();
    expect(data?.reprint_seq).toBe(1);
  });

  it('aceita jobs técnicos sem pedido associado', async () => {
    const { data, error } = await admin
      .from('print_jobs')
      .insert({
        store_id: storeId,
        order_id: null,
        station: 'counter',
        kind: 'test',
        payload: { test: true, message: 'Teste F3' },
      })
      .select('id,kind')
      .single();

    expect(error).toBeNull();
    expect(data?.kind).toBe('test');
    if (data?.id) technicalJobIds.push(data.id);
  });

  it('rejeita tipos de job fora do contrato', async () => {
    const { error } = await admin.from('print_jobs').insert({
      store_id: storeId,
      order_id: null,
      station: 'counter',
      kind: 'apagar_vendas',
      payload: {},
    });

    expect(error?.code).toBe('23514');
  });
});
