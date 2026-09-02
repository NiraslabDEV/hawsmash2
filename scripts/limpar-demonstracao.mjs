#!/usr/bin/env node
// pnpm client:limpar-demo
//
// Esvazia os dados de demonstração de uma instalação NOVA.
//
// Porquê isto existe: as migrations do motor trazem dados a sério lá dentro —
// o cardápio, as lojas e as zonas de quem veio antes. Numa base de dados nova,
// `supabase db reset` deixa a instalação com duas lojas, treze produtos e
// dezoito pedidos que não são do cliente. Ou se limpa, ou o primeiro ecrã que
// o dono vê é o restaurante de outra pessoa (ROADMAP-PRODUTO P3).
//
// O que NÃO faz: não toca no schema, nas funções, nas policies nem nas contas
// de equipa. Só apaga linhas operacionais.
//
// Uso:
//   node scripts/limpar-demonstracao.mjs                      relatório, não apaga nada
//   node scripts/limpar-demonstracao.mjs --sim --projecto=abc  apaga
//
// `--projecto` tem de bater certo com o host do SUPABASE_URL. É de propósito:
// o erro que custa caro não é escrever mal o comando, é corrê-lo apontado à
// base de dados errada. Assim é preciso olhar para onde se está a apontar.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createClient } from '@supabase/supabase-js';

import { parseEnvFile } from './lib/validate-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const executar = args.includes('--sim');
const projectoPedido = (args.find((a) => a.startsWith('--projecto=')) ?? '').split('=')[1] ?? '';

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

/**
 * Coluna usada como filtro neutro do DELETE, por tabela.
 *
 * O cliente Supabase exige sempre um filtro — de propósito, para não haver
 * DELETE sem WHERE por distracção. A maioria das tabelas tem `id`; as de
 * chave composta (store_id + outra coisa) e a `customers` (chave = telefone)
 * não têm, e sem isto o script dizia que apagou e não apagava.
 */
const CHAVE = {
  store_ingredients: 'store_id',
  store_items: 'store_id',
  store_hours: 'store_id',
  order_counters: 'store_id',
  customers: 'phone',
};

/**
 * Ordem de apagamento: filhos antes dos pais.
 *
 * Há cascatas na base de dados, mas contar com elas às cegas é como não saber
 * o que se apagou. Aqui a ordem está escrita, e o que sobrar aparece no fim.
 */
const ORDEM = [
  'ingredient_movements',
  'recipe_items',
  'store_ingredients',
  'ingredients',
  'stock_movements',
  'print_jobs',
  'payments',
  'order_items',
  'orders',
  'cash_movements',
  'cash_sessions',
  'order_counters',
  'store_items',
  'store_hours',
  'delivery_zones',
  'tables',
  'devices',
  'menu_item_variants',
  'menu_addons',
  'menu_items',
  'menu_categories',
  'analytics_events',
  'referral_codes',
  'customers',
  'event_log',
  'stores',
  'brand_settings',
];

// `--env=` porque a instalação nova raramente é a que está no .env da raiz:
// esse aponta para a instalação onde se está a trabalhar todos os dias.
const envPedido = (args.find((a) => a.startsWith('--env=')) ?? '').split('=')[1] ?? '';
const ficheiroEnv = envPedido
  ? (envPedido.startsWith('.') || !envPedido.includes(':') ? join(ROOT, envPedido) : envPedido)
  : existsSync(join(ROOT, '.env'))
    ? join(ROOT, '.env')
    : join(ROOT, '.env.local');
if (!existsSync(ficheiroEnv)) fail(`Não existe o ficheiro de ambiente: ${ficheiroEnv}`);

const env = parseEnvFile(readFileSync(ficheiroEnv, 'utf8'));
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) fail('Falta SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.');

const host = new URL(url).host;

console.log(c.bold('\n🧹 Limpar dados de demonstração\n'));
console.log('  Base de dados: ' + c.bold(host));

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function contar(tabela) {
  const { count, error } = await supabase.from(tabela).select('*', { count: 'exact', head: true });
  if (error) return null; // tabela não existe nesta versão do schema
  return count ?? 0;
}

const antes = {};
for (const tabela of ORDEM) antes[tabela] = await contar(tabela);

const comLinhas = ORDEM.filter((t) => (antes[t] ?? 0) > 0);
if (comLinhas.length === 0) {
  console.log(c.green('\n✔ Já não há dados operacionais. Nada a fazer.\n'));
  process.exit(0);
}

console.log('\n  A apagar:');
for (const tabela of comLinhas) console.log(`    ${tabela.padEnd(22)} ${antes[tabela]}`);

if (!executar) {
  console.log(
    c.yellow('\n  Relatório apenas — nada foi apagado.') +
      `\n  Para apagar mesmo:  node scripts/limpar-demonstracao.mjs --sim --projecto=${host.split('.')[0]}\n`,
  );
  process.exit(0);
}

if (!projectoPedido || !host.startsWith(projectoPedido)) {
  fail(
    `--projecto não bate certo com a base de dados ligada.\n` +
      `  Ligado a: ${host}\n` +
      `  Recebido: ${projectoPedido || '(vazio)'}\n` +
      `  Confirma que é mesmo esta a instalação nova antes de repetir.`,
  );
}

/**
 * O segundo guarda, e o que interessa mesmo.
 *
 * Uma instalação nova acabou de correr as migrations: os dados que lá estão
 * nasceram há minutos. Uma instalação a operar tem pedidos espalhados por
 * semanas. Se há história, isto não é uma instalação nova — e este script não
 * é para aqui chamado, por muito que o `--projecto` esteja bem escrito.
 *
 * Escrever mal um comando não é o erro que custa caro. Correr o comando certo
 * na base de dados errada é.
 */
const DIAS_TOLERADOS = 2;
const { data: maisAntigo } = await supabase
  .from('orders')
  .select('created_at')
  .order('created_at', { ascending: true })
  .limit(1);

const primeiro = maisAntigo?.[0]?.created_at;
if (primeiro) {
  const dias = (Date.now() - new Date(primeiro).getTime()) / 86_400_000;
  if (dias > DIAS_TOLERADOS && !args.includes('--tem-historico-e-eu-sei')) {
    fail(
      `Esta base de dados tem história: o pedido mais antigo é de há ${Math.floor(dias)} dias.\n` +
        `  Isso não é uma instalação nova — é uma operação a andar.\n` +
        `  Se souberes mesmo o que estás a fazer, repete com --tem-historico-e-eu-sei.`,
    );
  }
}

for (const tabela of ORDEM) {
  if ((antes[tabela] ?? 0) === 0) continue;
  const coluna = CHAVE[tabela] ?? 'id';
  const { error } = await supabase.from(tabela).delete().not(coluna, 'is', null);
  if (error) console.log(c.yellow(`    ⚠ ${tabela}: ${error.message}`));
}

console.log('\n  Depois:');
let sobrou = 0;
for (const tabela of comLinhas) {
  const restante = await contar(tabela);
  if ((restante ?? 0) > 0) {
    sobrou += restante;
    console.log(c.yellow(`    ${tabela.padEnd(22)} ${restante} (não apagou)`));
  }
}

if (sobrou > 0) {
  console.log(
    c.yellow('\n⚠ Ficaram linhas por apagar — provavelmente presas por uma chave estrangeira.') +
      '\n  Vê a lista acima antes de abrir a loja.\n',
  );
  process.exit(1);
}

console.log(
  c.green('\n✔ Instalação limpa.') +
    '\n  Próximo passo no painel: Equipa → Lojas → Aparência → Cardápio.\n',
);
