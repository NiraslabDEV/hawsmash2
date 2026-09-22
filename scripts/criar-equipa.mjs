#!/usr/bin/env node
/**
 * Criar a equipa de uma instalação — idempotente.
 *
 * Existe por causa de um ovo e uma galinha: criar equipa pelo painel exige uma
 * sessão de `owner` já existente, porque a rota confirma o perfil de quem
 * chama e nunca um campo do corpo (`apps/web/app/api/staff/route.ts`). Numa
 * base de dados acabada de migrar não há conta nenhuma, e por isso o painel
 * não consegue criar a primeira.
 *
 * O que este script faz, por esta ordem:
 *
 *   1. garante o utilizador em `auth` (cria se faltar, reaproveita se existir);
 *   2. escreve o PRIMEIRO dono em `staff_profiles`/`staff_stores` com a chave
 *      de serviço — é o único atalho, e só para essa linha;
 *   3. entra como esse dono e cria toda a gente pelo caminho normal do produto
 *      (`set_staff_access`, `set_staff_pin`), que valida os papéis e deixa
 *      rasto em `event_log`.
 *
 * Correr duas vezes não duplica nada: o utilizador é procurado pelo email e as
 * RPC são de escrita idempotente.
 *
 * Uso:
 *   node scripts/criar-equipa.mjs [--ficheiro CREDENCIAIS-EQUIPA.json] [--dry-run]
 *
 * Ambiente: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 * O ficheiro de entrada tem emails e PIN em texto simples — por isso o nome
 * começa por CREDENCIAIS, que o .gitignore já trava. Ver scripts/equipa.exemplo.json.
 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const PAPEIS = ['owner', 'manager', 'cashier', 'kitchen'];

function argumento(nome, omissao = null) {
  const i = process.argv.indexOf(`--${nome}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : omissao;
}

const FICHEIRO = argumento('ficheiro', 'CREDENCIAIS-EQUIPA.json');
const ENSAIO = process.argv.includes('--dry-run');

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  console.error('Faltam SUPABASE_URL, SUPABASE_ANON_KEY ou SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

/** Password de arranque: só serve para vincular o terminal e criar o PIN (§7.1). */
function gerarPassword() {
  return `Hs-${randomBytes(9).toString('base64url')}-2026`;
}

function ler() {
  let cru;
  try {
    cru = readFileSync(FICHEIRO, 'utf8');
  } catch {
    console.error(`Não encontrei ${FICHEIRO}. Copia scripts/equipa.exemplo.json e preenche-o.`);
    process.exit(1);
  }
  const dados = JSON.parse(cru);
  const pessoas = dados.pessoas ?? [];
  if (pessoas.length === 0) {
    console.error(`${FICHEIRO} não tem ninguém em "pessoas".`);
    process.exit(1);
  }

  const problemas = [];
  for (const [i, p] of pessoas.entries()) {
    if (!p.email) problemas.push(`pessoa ${i + 1}: falta "email"`);
    if (!p.nome) problemas.push(`pessoa ${i + 1}: falta "nome"`);
    if (!PAPEIS.includes(p.papel)) {
      problemas.push(`pessoa ${i + 1} (${p.email}): "papel" tem de ser ${PAPEIS.join(' | ')}`);
    }
    if (p.pin != null && !/^[0-9]{4,6}$/.test(String(p.pin))) {
      problemas.push(`pessoa ${i + 1} (${p.email}): "pin" tem de ter 4 a 6 algarismos`);
    }
  }
  if (!pessoas.some((p) => p.papel === 'owner')) {
    problemas.push('nenhuma pessoa com papel "owner" — sem isso não há por onde começar');
  }
  if (problemas.length > 0) {
    console.error(`Problemas em ${FICHEIRO}:`);
    for (const p of problemas) console.error(`  · ${p}`);
    process.exit(1);
  }
  return pessoas;
}

/** Procura o utilizador pelo email; cria-o se faltar. Devolve id e se é novo. */
async function garantirUtilizador(admin, pessoa) {
  // A API de admin não tem procura por email, por isso pagina-se. Uma equipa de
  // restaurante cabe folgadamente nas primeiras páginas.
  for (let pagina = 1; pagina <= 20; pagina += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: 200 });
    if (error) throw new Error(`listar utilizadores: ${error.message}`);
    const achado = data.users.find((u) => u.email?.toLowerCase() === pessoa.email.toLowerCase());
    if (achado) return { id: achado.id, novo: false, password: pessoa.password ?? null };
    if (data.users.length < 200) break;
  }

  const password = pessoa.password ?? gerarPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email: pessoa.email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`criar ${pessoa.email}: ${error?.message}`);
  return { id: data.user.id, novo: true, password };
}

async function main() {
  const pessoas = ler();
  const admin = createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: lojas, error: lojasError } = await admin.from('stores').select('id,slug');
  if (lojasError) throw new Error(`ler lojas: ${lojasError.message}`);
  const porSlug = new Map(lojas.map((l) => [l.slug, l.id]));

  const desconhecidas = pessoas.flatMap((p) => (p.lojas ?? []).filter((s) => !porSlug.has(s)));
  if (desconhecidas.length > 0) {
    console.error(`Lojas que não existem nesta base de dados: ${[...new Set(desconhecidas)].join(', ')}`);
    console.error(`Existem: ${[...porSlug.keys()].join(', ')}`);
    process.exit(1);
  }

  if (ENSAIO) {
    console.log(`Ensaio — nada será escrito. ${FICHEIRO} descreve ${pessoas.length} pessoa(s):\n`);
    for (const p of pessoas) {
      const lojasTexto = (p.lojas ?? []).join(', ') || (p.papel === 'owner' ? 'todas' : '(nenhuma)');
      console.log(`  ${p.papel.padEnd(8)} ${p.email.padEnd(34)} ${p.nome.padEnd(22)} ${lojasTexto}`);
    }
    return;
  }

  const relatorio = [];

  // 1. O primeiro dono entra pela chave de serviço — é o arranque, e é o único
  //    sítio onde se escreve nas tabelas da equipa sem passar pelas RPC.
  const dono = pessoas.find((p) => p.papel === 'owner');
  const contaDono = await garantirUtilizador(admin, dono);

  const { error: perfilError } = await admin
    .from('staff_profiles')
    .upsert(
      { user_id: contaDono.id, full_name: dono.nome, role: 'owner', active: true },
      { onConflict: 'user_id' },
    );
  if (perfilError) throw new Error(`perfil do dono: ${perfilError.message}`);

  for (const slug of dono.lojas ?? []) {
    const { error } = await admin
      .from('staff_stores')
      .upsert({ user_id: contaDono.id, store_id: porSlug.get(slug) }, { onConflict: 'user_id,store_id' });
    if (error) throw new Error(`loja ${slug} do dono: ${error.message}`);
  }
  relatorio.push({ ...dono, id: contaDono.id, novo: contaDono.novo, password: contaDono.password });

  // 2. Daqui para a frente é o caminho do produto: sessão de dono + RPC. Assim
  //    valida-se o que o painel validaria e fica rasto em event_log (§6).
  if (!contaDono.password) {
    console.error(
      `\nO dono ${dono.email} já existia e o ficheiro não traz a password dele.\n` +
        `Sem ela não abro sessão, e o resto da equipa cria-se pelas RPC.\n` +
        `Acrescenta "password" a essa pessoa em ${FICHEIRO} e corre outra vez.`,
    );
    process.exit(1);
  }

  const sessao = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: loginError } = await sessao.auth.signInWithPassword({
    email: dono.email,
    password: contaDono.password,
  });
  if (loginError) throw new Error(`entrar como ${dono.email}: ${loginError.message}`);

  for (const pessoa of pessoas) {
    const conta =
      pessoa.email === dono.email
        ? contaDono
        : await garantirUtilizador(admin, pessoa);

    if (pessoa.email !== dono.email) {
      // Mesma ordem do painel (`apps/web/app/api/staff/route.ts`): a linha de
      // perfil nasce pela chave de serviço, e é a RPC que decide papel, lojas e
      // auditoria. `set_staff_access` actualiza — não cria — e sem este passo
      // responde `staff_not_found`.
      const { error: perfilNovoError } = await admin
        .from('staff_profiles')
        .upsert(
          { user_id: conta.id, full_name: pessoa.nome, role: pessoa.papel, active: true },
          { onConflict: 'user_id' },
        );
      if (perfilNovoError) throw new Error(`perfil de ${pessoa.email}: ${perfilNovoError.message}`);

      const { error } = await sessao.rpc('set_staff_access', {
        p_user_id: conta.id,
        p_role: pessoa.papel,
        p_store_ids: (pessoa.lojas ?? []).map((s) => porSlug.get(s)),
        p_active: true,
        p_full_name: pessoa.nome,
      });
      if (error) throw new Error(`acesso de ${pessoa.email}: ${error.message}`);
      relatorio.push({ ...pessoa, id: conta.id, novo: conta.novo, password: conta.password });
    }

    if (pessoa.pin != null) {
      const { error } = await sessao.rpc('set_staff_pin', {
        p_user_id: conta.id,
        p_pin: String(pessoa.pin),
      });
      if (error) throw new Error(`PIN de ${pessoa.email}: ${error.message}`);
    }
  }

  console.log(`\nEquipa criada em ${URL}\n`);
  console.log('papel    email                              nome                   PIN  password');
  console.log('─'.repeat(100));
  for (const r of relatorio) {
    const pin = r.pin != null ? String(r.pin) : ' — ';
    const pass = r.novo ? r.password : '(já existia)';
    console.log(
      `${r.papel.padEnd(8)} ${r.email.padEnd(34)} ${r.nome.padEnd(22)} ${pin.padEnd(4)} ${pass}`,
    );
  }
  console.log(
    '\nAs passwords acima só aparecem uma vez. Guarda-as em CREDENCIAIS-ACESSOS.md,\n' +
      'entrega a cada pessoa só o que é dela, e confirma na aba Equipa do painel.',
  );
}

main().catch((erro) => {
  console.error(`\nFalhou: ${erro.message}`);
  process.exit(1);
});
