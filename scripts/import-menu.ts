#!/usr/bin/env node
// pnpm menu:import <ficheiro.json> [--dry-run]
// Importa um cardápio no formato canónico (docs/menu-format.md) para a BD via RPC import_menu.
// Valida + converte preços (centavos) com packages/core; envia para o Supabase com a service role.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeMenuImport } from '../packages/core/src/menu-import';
// @ts-expect-error — módulo .mjs sem tipos (partilhado com setup-client)
import { parseEnvFile } from './lib/validate-config.mjs';

const c = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

function fail(msg: string): never {
  console.error('\n' + c.red('✖ ' + msg) + '\n');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fileArg = args.find((a) => !a.startsWith('--'));

if (!fileArg) fail('Indica o ficheiro:  pnpm menu:import caminho/menu.json [--dry-run]');

const path = resolve(process.cwd(), fileArg);
if (!existsSync(path)) fail(`Ficheiro não encontrado: ${path}`);

let raw: unknown;
try {
  // remove BOM (ficheiros gerados em Windows/editores podem trazê-lo)
  raw = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
} catch (e) {
  fail('JSON inválido: ' + (e as Error).message);
}

let menu;
try {
  menu = normalizeMenuImport(raw);
} catch (e) {
  fail('Formato inválido: ' + (e as Error).message);
}

const nCats = menu.categories.length;
const nItems = menu.categories.reduce((s, cat) => s + cat.items.length, 0);
console.log(c.bold(`\n📋 ${nCats} categoria(s), ${nItems} item(s)`));
for (const cat of menu.categories) {
  console.log('  ' + c.bold(cat.name));
  for (const it of cat.items) {
    console.log(c.dim(`    - ${it.name}  ${(it.price_cents / 100).toFixed(2)} MT`));
  }
}

if (dryRun) {
  console.log(c.dim('\n--dry-run: nada foi escrito na BD.\n'));
  process.exit(0);
}

async function importToDb(): Promise<void> {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) fail('Falta .env com NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.');
  const env = parseEnvFile(readFileSync(envPath, 'utf8'));
  const url = (env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail('Falta NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.');

  const res = await fetch(`${url}/rest/v1/rpc/import_menu`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ p_payload: menu }),
  });

  if (!res.ok) fail(`Supabase RPC import_menu falhou (${res.status}): ${await res.text()}`);
  console.log(c.green('\n✔ Importado: ') + JSON.stringify(await res.json()) + '\n');
}

importToDb().catch((e) => fail((e as Error).message));
