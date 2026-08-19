#!/usr/bin/env node
// pnpm setup:client
// Valida .env + config/brand.ts de um cliente novo e aplica as migrations no Supabase.
// Single-tenant turnkey — ver CLAUDE.md secção 15 e README.md.
//
// Uso:
//   pnpm setup:client          valida e corre `supabase db reset` (migrations + seed)
//   pnpm setup:client --check  só valida (não toca na BD) — bom para CI

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseEnvFile, validateEnv, validateBrandSource } from './lib/validate-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const checkOnly = args.some((a) => ['--check', '--check-only', '--dry-run'].includes(a));

const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

function fail(msg) {
  console.error('\n' + c.red('✖ ' + msg) + '\n');
  process.exit(1);
}

console.log(c.bold('\n🚀 Delivery OS — setup:client\n'));

// 1. .env existe?
const envPath = join(ROOT, '.env');
if (!existsSync(envPath)) {
  fail('Não existe .env na raiz.\n  Copia o exemplo:  cp .env.example .env   e preenche os valores.');
}
const env = parseEnvFile(readFileSync(envPath, 'utf8'));

// 2. config/brand.ts existe?
const brandPath = join(ROOT, 'config', 'brand.ts');
if (!existsSync(brandPath)) {
  fail('Não existe config/brand.ts.\n  Copia o exemplo:  cp config/brand.example.ts config/brand.ts');
}
const brandSrc = readFileSync(brandPath, 'utf8');

// 3. validar
const envResult = validateEnv(env);
const brandResult = validateBrandSource(brandSrc);
const errors = [...envResult.errors, ...brandResult.errors];
const warnings = [...envResult.warnings, ...brandResult.warnings];

if (warnings.length) {
  console.log(c.yellow('Avisos:'));
  for (const w of warnings) console.log('  ' + c.yellow('⚠ ') + w);
  console.log('');
}

if (errors.length) {
  console.log(c.red('Erros de configuração (corrige antes de continuar):'));
  for (const e of errors) console.log('  ' + c.red('✖ ') + e);
  fail(`${errors.length} erro(s). Corrige o .env / config/brand.ts e corre de novo.`);
}

console.log(c.green('✔ .env e config/brand.ts válidos.\n'));

if (checkOnly) {
  console.log(c.dim('Modo --check: validação apenas, sem correr migrations.\n'));
  process.exit(0);
}

// 4. aplicar migrations
console.log(c.bold('A aplicar migrations no Supabase (supabase db reset)...\n'));

const version = spawnSync('supabase', ['--version'], { stdio: 'ignore', shell: true });
if (version.status !== 0) {
  fail(
    'Supabase CLI não encontrado.\n' +
      '  Instala: https://supabase.com/docs/guides/cli\n' +
      '  Depois corre de novo, ou aplica as migrations manualmente (supabase db push).'
  );
}

const reset = spawnSync('supabase', ['db', 'reset'], { stdio: 'inherit', shell: true, cwd: ROOT });
if (reset.status !== 0) {
  fail(
    'supabase db reset falhou.\n' +
      '  Verifica se o projeto está ligado (supabase link) ou a correr localmente (supabase start).'
  );
}

console.log(
  c.green('\n✔ Setup completo.') +
    '\n  Próximo passo: configurar settings/menu/zonas no admin e fazer deploy.\n'
);
