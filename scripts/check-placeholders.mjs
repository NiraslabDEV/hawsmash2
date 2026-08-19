#!/usr/bin/env node
// Guarda de go-live: falha se algum dado PLACEHOLDER_ ainda estiver na BD.
// Correr contra produção antes de assinar a checklist de abertura (RUNBOOK §7).
//
// Uso: NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/check-placeholders.mjs

import { createClient } from '@supabase/supabase-js';

import { describePlaceholders, findPlaceholders } from './lib/release-guard.mjs';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  process.stderr.write('[guard] faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY\n');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const rows = [];

const { data: zones, error: zonesError } = await supabase
  .from('delivery_zones')
  .select('id,name,store_id');
if (zonesError) {
  process.stderr.write(`[guard] delivery_zones: ${zonesError.message}\n`);
  process.exit(1);
}
for (const zone of zones ?? []) {
  rows.push({ table: 'delivery_zones', column: 'name', id: zone.id, value: zone.name });
}

const { data: stores, error: storesError } = await supabase
  .from('stores')
  .select('slug,name,short_name,address,receipt_header,receipt_footer,mpesa_number,mpesa_name,emola_number,emola_name');
if (storesError) {
  process.stderr.write(`[guard] stores: ${storesError.message}\n`);
  process.exit(1);
}
for (const store of stores ?? []) {
  for (const [column, value] of Object.entries(store)) {
    if (column === 'slug') continue;
    rows.push({ table: 'stores', column, id: store.slug, value });
  }
}

const { data: staff, error: staffError } = await supabase
  .from('staff_profiles')
  .select('user_id,full_name');
if (staffError) {
  process.stderr.write(`[guard] staff_profiles: ${staffError.message}\n`);
  process.exit(1);
}
for (const member of staff ?? []) {
  rows.push({
    table: 'staff_profiles',
    column: 'full_name',
    id: member.user_id,
    value: member.full_name,
  });
}

const found = findPlaceholders(rows);
process.stdout.write(`[guard] ${describePlaceholders(found)}\n`);
process.exit(found.length === 0 ? 0 : 1);
