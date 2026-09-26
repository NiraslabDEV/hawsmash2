#!/usr/bin/env node
/**
 * Valida referências documentais reconhecíveis a tabelas/views e RPCs.
 * Só lê Markdown e a cadeia SQL local através de buildCatalog; não executa SQL.
 *
 * node scripts/docs/check-schema.mjs [--root directorio] [--json]
 *
 * Limite deliberado: nomes em linguagem natural sem contexto de dados não são
 * classificáveis com segurança. Reconhece código inline, contratos em tabelas,
 * listas de dados/RPCs, chamadas .rpc/.from e SQL fenced. Não valida colunas,
 * argumentos, autorização nem execução. Funções JavaScript não viram RPCs pelo
 * simples facto de terem parênteses. Excepções são exactas por ficheiro/token.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildCatalog } from './schema-catalog.mjs';
import { forbidden } from './lib.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rootDocs = ['README.md', 'CLAUDE.md', 'AGENTS.md', 'ROADMAP.md', 'ROADMAP-PRODUTO.md', 'BLOQUEIOS.md', 'apps/web/app/(public)/CLAUDE.md'];
const excludedDocs = new Set(['docs/AUDITORIA-DOCUMENTACAO.md']);
const excludedDirs = new Set(['legacy', 'engine', 'historico']);
const identifier = '[a-z_][a-z0-9_]*(?:\\.[a-z_][a-z0-9_]*)?';
const functionPrefix = /^(?:get|create|save|set|list|delete|close|open|adjust|confirm|advance|void|sync|account|pos|record|ensure|claim|complete|report|export|bind|lock|unlock|start|call|update|audit|submit|join|validate|enqueue|recover|consume|restore|build|auth|normalize|assert|fanout|price|table|campaign|attr)_/;
const tablePrefix = /^(?:store|cash|order|menu|stock|staff|customer|ingredient|recipe|conversion|analytics|chat)_/;
const primitiveWords = new Set(['uuid', 'text', 'integer', 'int', 'jsonb', 'boolean', 'bool', 'bigint', 'timestamptz', 'date', 'smallint', 'numeric', 'true', 'false', 'null', 'anon', 'authenticated', 'service_role', 'public', 'private', 'owner', 'manager', 'cashier', 'kitchen', 'security', 'definer', 'invoker']);
const tableContext = /\b(?:tabelas?|tables?|views?|singleton|schema|dados|catálogo|registo|associação|matriz|entidade|operacionais|column|coluna)\b/i;
const functionContext = /\b(?:rpcs?|funções? sql|funções? (?:públicas?|privadas?)|procedures?|assinaturas?|helpers? private)\b/i;
const stripMarkup = (s) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '');
const normalToken = (s) => s.replace(/\s*\([^]*$/, '').trim();
const basename = (name) => name.split('.').at(-1);

async function documents(root) {
  const result = [];
  async function walk(dir) {
    if (forbidden(dir)) return;
    let entries;
    try { entries = await readdir(path.join(root, dir), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const relative = `${dir}/${entry.name}`;
      if (forbidden(relative)) continue;
      if (entry.isDirectory() && !excludedDirs.has(entry.name)) await walk(relative);
      else if (entry.isFile() && entry.name.endsWith('.md') && !excludedDocs.has(relative)) result.push(relative);
    }
  }
  await walk('docs');
  for (const file of rootDocs) {
    if (forbidden(file)) continue;
    try { await readFile(path.join(root, file), 'utf8'); result.push(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return [...new Set(result)].sort();
}

function candidates(file, text, known) {
  const found = [];
  const add = (kind, token, line, origin) => {
    token = normalToken(token);
    if (!new RegExp(`^${identifier}$`).test(token) || primitiveWords.has(token)) return;
    found.push({ file, line, kind, token, origin });
  };
  const lines = text.split(/\r?\n/);
  let heading = ''; let fence = null; let tableHeaders = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]; const number = i + 1;
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})\s*(\w*)/);
    if (fenceMatch) { fence = fence ? null : (fenceMatch[2].toLowerCase() || 'plain'); continue; }
    if (/^#{1,6}\s/.test(line)) { heading = stripMarkup(line); tableHeaders = null; }
    if (fence === 'sql') {
      for (const m of line.matchAll(new RegExp(`\\b(?:create(?: or replace)?|alter|drop)\\s+function(?: if exists)?\\s+(${identifier})\\s*\\(`, 'gi'))) add('function', m[1].toLowerCase(), number, 'DDL SQL');
      for (const m of line.matchAll(new RegExp(`\\b(?:create|alter|drop)\\s+(?:table|view)(?: if (?:not )?exists)?\\s+(${identifier})`, 'gi'))) add('table', m[1].toLowerCase(), number, 'DDL SQL');
      for (const m of line.matchAll(new RegExp(`\\b(?:from|join|into|update)\\s+(${identifier})`, 'gi'))) add('table', m[1].toLowerCase(), number, 'consulta SQL');
    }
    // Chamadas de SDK são inequívocas, mesmo num snippet TypeScript.
    for (const m of line.matchAll(/\.rpc\(\s*['"]([a-z_][\w.]*)['"]/g)) add('function', m[1], number, '.rpc');
    for (const m of line.matchAll(/\.from\(\s*['"]([a-z_][\w.]*)['"]/g)) add('table', m[1], number, '.from');
    if (fence) continue;

    const markdownCells = /^\s*\|/.test(line) ? line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((s) => s.trim()) : null;
    if (markdownCells && /^\s*\|\s*:?-{3}/.test(lines[i + 1] ?? '')) tableHeaders = markdownCells.map(stripMarkup);
    if (!markdownCells && line.trim()) tableHeaders = null;
    if (markdownCells && tableHeaders && !markdownCells.every((c) => /^:?-+:?$/.test(c))) {
      markdownCells.forEach((value, column) => {
        const label = tableHeaders[column] ?? '';
        const isFunctions = /\b(?:rpcs?|assinaturas?|funções|função SQL)\b/i.test(label) || /^função$/i.test(label) && tableHeaders.some((header) => /^trigger$/i.test(header));
        const isTables = /\b(?:tabela|tabelas|view|views)\b/i.test(label) && !/fonte|caminho/i.test(label);
        if (!isFunctions && !isTables) return;
        // Células catalogais: lista de nomes/assinaturas, não frases de descrição.
        const valueWithoutLinks = value.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
        for (const m of valueWithoutLinks.matchAll(new RegExp(`(?<![\\w/.-])(${identifier})(?=\\s*\\(|[,;\\x60 ·]|$)`, 'g'))) {
          const token = m[1];
          const codeName = valueWithoutLinks.includes('`' + token + '`') || valueWithoutLinks.includes('`' + token + '(');
          if (token.includes('.') && !/^(?:public|private|auth|storage)\./.test(token) && !known.tables.has(token.split('.')[0])) continue;
          if (primitiveWords.has(token) || known.nonRelations.has(token)) continue;
          if (known.tables.has(token)) add('table', token, number, `coluna ${label}`);
          else if (known.functions.has(token) || known.historicalFunctions.has(token)) add('function', token, number, `coluna ${label}`);
          else if (isFunctions && (!isTables || functionPrefix.test(basename(token))) && (codeName || token.includes('_') || token.includes('.'))) add('function', token, number, `coluna ${label}`);
          else if (isTables && (codeName || token.includes('_') || token.includes('.'))) add('table', token, number, `coluna ${label}`);
        }
      });
    }

    for (const match of line.matchAll(/(`+)([^]*?)\1/g)) {
      const value = match[2].trim();
      if (!value || /(?:\.(?:md|sql|mjs|tsx?|json|yml|yaml|toml)|https?:\/\/|[A-Za-z]:[\\/])/.test(value)) continue;
      const surrounding = `${heading} ${line.slice(Math.max(0, match.index - 95), match.index)} ${line.slice(match.index + match[0].length, match.index + match[0].length + 55)}`;
      const before = line.slice(Math.max(0, match.index - 45), match.index);
      const explicitRpc = /\b(?:rpcs?|função sql)\s*(?:chamada\s*)?[:—-]?\s*$/i.test(before);
      const explicitTable = /\b(?:tabelas?|views?|singleton)\s*[:—-]?\s*$/i.test(before);
      const nonContract = /\b(?:polic(?:y|ies)|trigger|erro|devolve|mensagem|cookie)\s*[:—-]?\s*$/i.test(before);
      // Uma família como private.attr_* não é um objecto chamado private.attr_.
      if (/^(?:public|private)\.[a-z_]+\*$/.test(value)) {
        const prefix = value.slice(0, -1);
        if (![...known.functions, ...known.tables].some((name) => name.startsWith(prefix))) add('function', prefix, number, 'família SQL sem correspondências');
        continue;
      }
      const calls = [...value.matchAll(new RegExp(`(?<![\\w.])(${identifier})\\s*\\(`, 'g'))];
      for (const call of calls) {
        const token = call[1];
        if (explicitTable || known.tables.has(token) && !explicitRpc) add('table', token, number, 'colunas de tabela inline');
        else if (/^(?:public|private)\./.test(token) || known.functions.has(token) || functionPrefix.test(token) || explicitRpc) add('function', token, number, 'assinatura inline');
      }
      // A lista de argumentos de uma assinatura não é lista de tabelas/RPCs.
      if (calls.length) continue;
      for (const tokenMatch of value.matchAll(new RegExp(`(?<![\\w/.-])(${identifier})(?![\\w/.-])`, 'g'))) {
        let token = tokenMatch[1];
        if (nonContract && !explicitRpc && !explicitTable || known.nonRelations.has(token) && !explicitRpc && !explicitTable) continue;
        if (/^(?:public|private)\./.test(token)) {
          add(known.functions.has(token) || known.historicalFunctions.has(token) || functionContext.test(surrounding) && !known.tables.has(token) ? 'function' : 'table', token, number, 'nome qualificado'); continue;
        }
        if (token.includes('.')) {
          const base = token.split('.')[0];
          if (known.tables.has(base)) add('table', base, number, 'coluna qualificada');
          else if (tablePrefix.test(base) && /(?:_id|_at|_cents)$/.test(token.split('.')[1])) add('table', base, number, 'coluna de tabela desconhecida');
          else if (/^(?:auth|storage)\./.test(token)) add('table', token, number, 'objecto da plataforma');
          continue;
        }
        if (known.functions.has(token)) { add('function', token, number, 'nome conhecido inline'); continue; }
        if (known.tables.has(token)) { add('table', token, number, 'nome conhecido inline'); continue; }
        if (known.columns.has(token) || primitiveWords.has(token) || /^p_|_cents$|_id$|_at$/.test(token)) continue;
        if (explicitRpc || functionPrefix.test(token) && functionContext.test(surrounding)) add('function', token, number, 'contrato de RPC inline');
        else if (explicitTable || tablePrefix.test(token) && tableContext.test(surrounding)) add('table', token, number, 'contrato de tabela inline');
      }
    }
    // Frases explícitas sem backticks: «RPC foo_bar», «tabela foo_bar».
    for (const m of line.matchAll(/\b(RPC|tabela|view)\s+([a-z][a-z0-9_]*_[a-z0-9_]+)\b/gi)) add(m[1].toLowerCase() === 'rpc' ? 'function' : 'table', m[2], number, 'nome textual explícito');
  }
  return [...new Map(found.map((r) => [`${r.file}:${r.line}:${r.kind}:${r.token}`, r])).values()];
}

export async function checkSchema(root = defaultRoot) {
  const catalog = await buildCatalog(root);
  const allTables = [...catalog.tables.map((t) => t.name), ...catalog.views.map((v) => v.name)];
  const functions = new Set(catalog.functions.flatMap((f) => [f.name, basename(f.name)]));
  const tables = new Set(allTables.flatMap((name) => [name, basename(name)]));
  const columns = new Set(catalog.tables.flatMap((t) => t.columns));
  const historicalFunctions = new Set(catalog.declaredFunctionNames);
  const nonRelations = new Set([...catalog.tables.flatMap((t) => t.policies.map((p) => p.name)), ...catalog.storagePolicies.map((p) => p.name), ...catalog.triggers.map((t) => t.name)]);
  // Policies removidas também aparecem no relato histórico; não são tabelas.
  for (const migration of catalog.migrations) {
    const sql = await readFile(path.join(root, migration.file), 'utf8');
    for (const match of sql.matchAll(/\b(?:create|drop|alter)\s+policy\s+(?:if\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) nonRelations.add(match[1].toLowerCase());
  }
  const files = await documents(root);
  let exceptions = [];
  try { exceptions = JSON.parse(await readFile(path.join(root, 'scripts/docs/schema-exceptions.json'), 'utf8')).exceptions ?? []; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const ex of exceptions) {
    if (!ex.file || !ex.token || !['table', 'function'].includes(ex.kind) || typeof ex.reason !== 'string' || ex.reason.trim().length < 20 || /[*?]/.test(ex.file + ex.token)) throw new Error('Excepção inválida: exige ficheiro/token/kind exactos e motivo concreto.');
  }
  const refs = (await Promise.all(files.map(async (file) => candidates(file, await readFile(path.join(root, file), 'utf8'), { functions, tables, columns, historicalFunctions, nonRelations })))).flat();
  const errors = []; const usedExceptions = new Map(); const verified = [];
  for (const ref of refs) {
    if ((ref.kind === 'function' ? functions : tables).has(ref.token)) { verified.push(ref); continue; }
    const exception = exceptions.find((e) => e.file === ref.file && e.token === ref.token && e.kind === ref.kind);
    if (exception) { usedExceptions.set(`${exception.file}:${exception.kind}:${exception.token}`, exception); continue; }
    errors.push(ref);
  }
  return { files: files.length, references: refs.length, verified: verified.length, errors, exceptions: [...usedExceptions.values()], unusedExceptions: exceptions.filter((e) => !usedExceptions.has(`${e.file}:${e.kind}:${e.token}`)), excluded: ['docs/legacy/**', 'docs/engine/**', 'docs/historico/**', ...excludedDocs], limit: 'Verifica nomes nos contratos reconhecíveis; não interpreta prosa arbitrária, SQL dinâmico, colunas, assinaturas/argumentos ou autorização.' };
}

export async function main(args = process.argv.slice(2)) {
  let root = defaultRoot; let json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) root = path.resolve(args[++i]);
    else if (args[i] === '--json') json = true;
    else throw new Error(`Opção desconhecida: ${args[i]}`);
  }
  const result = await checkSchema(root);
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    process.stdout.write(`${result.files} documentos; ${result.references} referências reconhecidas; ${result.verified} verificadas; ${result.exceptions.length} excepções justificadas; ${result.errors.length} falhas.\n`);
    for (const error of result.errors) process.stderr.write(`${error.file}:${error.line}: ${error.kind} ${error.token} — não consta do catálogo actual (${error.origin}).\n`);
    if (result.unusedExceptions.length) process.stdout.write(`${result.unusedExceptions.length} excepções actualmente sem referência; rever após reorganizações.\n`);
    process.stdout.write(`${result.limit}\n`);
  }
  if (result.errors.length) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
