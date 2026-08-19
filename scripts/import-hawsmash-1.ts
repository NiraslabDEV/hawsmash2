#!/usr/bin/env tsx
/**
 * Importação do HAWSMASH 1.0 → HAWSMASH 2.0 (CLAUDE.md §15).
 *
 * Por omissão faz **dry-run**: lê o Supabase antigo, aplica as regras de
 * `scripts/lib/import-mapping.ts` e imprime o relatório de contagens para
 * conferir com o 1.0. Só escreve com `--apply`, e nunca contra produção sem
 * `--i-know-this-is-live`.
 *
 * BLOQUEIO: B-009 — falta a chave de leitura do projecto antigo, por isso este
 * script nunca correu contra dados reais.
 *
 * Uso:
 *   LEGACY_SUPABASE_URL=… LEGACY_SERVICE_KEY=… \
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *   pnpm tsx scripts/import-hawsmash-1.ts [--apply] [--store maputo]
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  aggregateCustomers,
  buildReport,
  mapCategory,
  mapOrder,
  mapOrderItem,
  mapProduct,
  type LegacyCategory,
  type LegacyOrder,
  type LegacyOrderItem,
  type LegacyProduct,
} from './lib/import-mapping';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const storeIndex = args.indexOf('--store');
const storeSlug = storeIndex >= 0 ? args[storeIndex + 1] : 'maputo';

const PAGE_SIZE = 1000;

function log(message: string) {
  process.stdout.write(`[import] ${message}\n`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} em falta. Sem acesso ao Supabase do 1.0 a importação não corre (B-009).`,
    );
  }
  return value;
}

/** Paginação explícita: a API corta em silêncio e já custou um relatório errado. */
async function fetchAll<T>(client: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; ; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await client
      .from(table)
      .select(columns)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Leitura de ${table} falhou: ${error.message}`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

async function main(): Promise<void> {
  const legacy = createClient(requireEnv('LEGACY_SUPABASE_URL'), requireEnv('LEGACY_SERVICE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  log(`a ler o HAWSMASH 1.0 (${apply ? 'MODO ESCRITA' : 'dry-run'})…`);

  const [categories, products, orders, items] = await Promise.all([
    fetchAll<LegacyCategory>(legacy, 'product_categories', 'id,name,sort,active'),
    fetchAll<LegacyProduct>(
      legacy,
      'products',
      'id,name,category_id,description,price_single,price_haw,price_wagyu,image_url,available,sort',
    ),
    fetchAll<LegacyOrder>(
      legacy,
      'orders',
      'id,order_number,customer_name,customer_phone,customer_email,fulfillment,delivery_address,delivery_zone,payment_method,subtotal_mt,delivery_fee_mt,total_mt,customer_notes,status,created_at',
    ),
    fetchAll<LegacyOrderItem>(
      legacy,
      'order_items',
      'order_id,product_name,variant,unit_price_mt,qty,line_total_mt',
    ),
  ]);

  const report = buildReport({ categories, products, orders, items });
  log('relatório de contagens (conferir com o painel do 1.0):');
  log(`  categorias:      ${report.categories}`);
  log(`  produtos:        ${report.products}`);
  log(`  pedidos:         ${report.orders}`);
  log(`  linhas de item:  ${report.order_items}`);
  log(`  clientes únicos: ${report.customers}`);
  log(`  facturado (pagos): ${(report.revenue_cents / 100).toFixed(2)} MT`);

  if (!apply) {
    log('dry-run terminado — nada foi escrito. Repetir com --apply depois de conferir.');
    return;
  }

  const target = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: store, error: storeError } = await target
    .from('stores')
    .select('id,slug')
    .eq('slug', storeSlug)
    .single();
  if (storeError || !store) throw new Error(`Loja de destino ${storeSlug} não encontrada.`);

  const categoryIdByLegacy = new Map<string, string>();
  for (const category of categories) {
    const mapped = mapCategory(category);
    const { data, error } = await target
      .from('menu_categories')
      .upsert({ name: mapped.name, sort: mapped.sort, active: mapped.active }, { onConflict: 'name' })
      .select('id')
      .single();
    if (error || !data) throw new Error(`Categoria ${mapped.name}: ${error?.message}`);
    categoryIdByLegacy.set(category.id, data.id);
  }
  log(`categorias importadas: ${categoryIdByLegacy.size}`);

  let importedProducts = 0;
  for (const product of products) {
    const mapped = mapProduct(product, categoryIdByLegacy);
    const { error } = await target.from('menu_items').upsert(
      {
        category_id: mapped.category_id,
        name: mapped.name,
        description: mapped.description,
        price_cents: mapped.price_cents,
        photo_url: mapped.photo_url,
        available: mapped.available,
        sort: mapped.sort,
      },
      { onConflict: 'name' },
    );
    if (error) throw new Error(`Produto ${mapped.name}: ${error.message}`);
    importedProducts += 1;
  }
  log(`produtos importados: ${importedProducts}`);

  const itemsByOrder = new Map<string, LegacyOrderItem[]>();
  for (const item of items) {
    itemsByOrder.set(item.order_id, [...(itemsByOrder.get(item.order_id) ?? []), item]);
  }

  let importedOrders = 0;
  for (const order of orders) {
    const mapped = mapOrder(order, store.id);
    const { data: inserted, error } = await target
      .from('orders')
      .upsert(
        {
          store_id: mapped.store_id,
          order_number: mapped.order_number,
          status: mapped.status,
          flow: mapped.flow,
          channel: mapped.channel,
          fulfillment_type: mapped.fulfillment_type,
          customer_name: mapped.customer_name,
          customer_phone: mapped.customer_phone,
          customer_email: mapped.customer_email,
          address: mapped.address,
          subtotal_cents: mapped.subtotal_cents,
          delivery_fee_cents: mapped.delivery_fee_cents,
          total_cents: mapped.total_cents,
          payment_method: mapped.payment_method,
          notes: mapped.notes,
          created_at: mapped.created_at,
        },
        { onConflict: 'order_number' },
      )
      .select('id')
      .single();
    if (error || !inserted) throw new Error(`Pedido ${mapped.order_number}: ${error?.message}`);

    const orderItems = (itemsByOrder.get(order.id) ?? []).map((item) =>
      mapOrderItem(item, inserted.id, store.id),
    );
    if (orderItems.length > 0) {
      await target.from('order_items').delete().eq('order_id', inserted.id);
      const { error: itemsError } = await target.from('order_items').insert(orderItems);
      if (itemsError) throw new Error(`Itens do pedido ${mapped.order_number}: ${itemsError.message}`);
    }
    importedOrders += 1;
  }
  log(`pedidos importados: ${importedOrders}`);

  const customers = aggregateCustomers(orders);
  for (const customer of customers) {
    const { error } = await target.from('customers').upsert(
      {
        phone: customer.phone,
        name: customer.name,
        orders_count: customer.orders_count,
        total_spent_cents: customer.total_spent_cents,
        last_seen_at: customer.last_order_at,
      },
      { onConflict: 'phone' },
    );
    if (error) throw new Error(`Cliente ${customer.phone}: ${error.message}`);
  }
  log(`clientes agregados: ${customers.length}`);
  log('importação concluída.');
}

main().catch((error) => {
  process.stderr.write(`[import] FALHOU: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
