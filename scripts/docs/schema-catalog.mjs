#!/usr/bin/env node
/**
 * Catálogo documental, só a partir de ficheiros locais. Não lê ambientes,
 * credenciais ou dados de instalação; não executa SQL nem contacta serviços.
 *
 * node scripts/docs/schema-catalog.mjs          escreve os quatro catálogos
 * node scripts/docs/schema-catalog.mjs --check  compara, sem escrever
 * node scripts/docs/schema-catalog.mjs --json   inventário estruturado
 * node scripts/docs/schema-catalog.mjs --names-json  nomes para outros checks
 */
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { forbidden } from './lib.mjs';

const ownRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lower = (s) => s.toLowerCase();
const qualified = (s) => s.includes('.') ? s : `public.${s}`;
const compact = (s) => s.replace(/\s+/g, ' ').trim();
const cell = (s) => String(s).replace(/\|/g, '&#124;').replace(/\r?\n/g, ' ');
const code = (s) => String(s).includes('`') ? `\`\` ${cell(s)} \`\`` : `\`${cell(s)}\``;
const sourceLink = (s) => `[${s.file}:${s.line}](../../${s.file}#L${s.line})`;
const location = (file, text, offset) => ({ file, line: text.slice(0, offset).split('\n').length });

// Lexer SQL pequeno: comentários, strings e corpos dollar-quoted são tokens
// opacos. Não confunde texto de SQL num literal com uma declaração executada.
function lex(text, base = 0) {
  const out = [];
  let p = 0;
  while (p < text.length) {
    if (/\s/.test(text[p])) { p++; continue; }
    if (text.startsWith('--', p)) { const e = text.indexOf('\n', p); p = e < 0 ? text.length : e; continue; }
    if (text.startsWith('/*', p)) {
      let depth = 1; p += 2;
      while (p < text.length && depth) {
        if (text.startsWith('/*', p)) { depth++; p += 2; }
        else if (text.startsWith('*/', p)) { depth--; p += 2; }
        else p++;
      }
      continue;
    }
    const start = p;
    if (text[p] === "'" || text[p] === '"') {
      const quote = text[p++]; let value = '';
      while (p < text.length) {
        if (text[p] === quote) {
          if (text[p + 1] === quote) { value += quote; p += 2; continue; }
          p++; break;
        }
        value += text[p++];
      }
      out.push({ kind: quote === "'" ? 'string' : 'word', value, raw: text.slice(start, p), start: start + base, end: p + base });
      continue;
    }
    const dollar = text.slice(p).match(/^\$(?:[A-Za-z_][\w]*)?\$/)?.[0];
    if (dollar) {
      const bodyStart = p + dollar.length; const close = text.indexOf(dollar, bodyStart);
      if (close < 0) throw new Error(`Corpo SQL por fechar no offset ${base + p}`);
      p = close + dollar.length;
      out.push({ kind: 'body', value: text.slice(bodyStart, close), raw: text.slice(start, p), start: start + base, end: p + base, bodyStart: bodyStart + base });
      continue;
    }
    const word = text.slice(p).match(/^[A-Za-z_][\w$]*/)?.[0];
    if (word) { p += word.length; out.push({ kind: 'word', value: lower(word), raw: word, start: start + base, end: p + base }); continue; }
    p++; out.push({ kind: 'symbol', value: text[start], raw: text[start], start: start + base, end: p + base });
  }
  return out;
}
function nameAt(tokens, start) {
  if (!tokens[start]) return { name: '', next: start };
  let name = tokens[start].value; let next = start + 1;
  while (tokens[next]?.value === '.' && tokens[next + 1]?.kind === 'word') { name += `.${tokens[next + 1].value}`; next += 2; }
  return { name, next };
}
function closing(tokens, start) {
  let depth = 0;
  for (let i = start; i < tokens.length; i++) {
    if (tokens[i].value === '(') depth++;
    if (tokens[i].value === ')' && --depth === 0) return i;
  }
  throw new Error('Parênteses SQL por fechar');
}
function parts(tokens) {
  const result = []; let start = 0; let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].value === '(' || tokens[i].value === '[') depth++;
    if (tokens[i].value === ')' || tokens[i].value === ']') depth--;
    if (tokens[i].value === ',' && depth === 0) { result.push(tokens.slice(start, i)); start = i + 1; }
  }
  result.push(tokens.slice(start)); return result;
}
const typeNames = new Set(['uuid', 'text', 'integer', 'int', 'int4', 'bigint', 'smallint', 'jsonb', 'json', 'boolean', 'bool', 'timestamptz', 'timestamp', 'date', 'numeric', 'bytea', 'real', 'double', 'character', 'varchar', 'record']);
function signature(tokens) {
  return parts(tokens).flatMap((part) => {
    if (!part.length || part[0].value === 'out') return [];
    let p = [...part];
    if (['in', 'inout', 'variadic'].includes(p[0]?.value)) p.shift();
    const defaultAt = p.findIndex((t) => ['default', '='].includes(t.value));
    if (defaultAt >= 0) p = p.slice(0, defaultAt);
    if (!typeNames.has(p[0]?.value) && typeNames.has(p[1]?.value)) p.shift();
    const val = compact(p.map((t) => t.value).join(' ')).replace(/\b(?:int|int4)\b/g, 'integer').replace(/\bbool\b/g, 'boolean').replace(/ \[ \]/g, '[]');
    return val ? [val] : [];
  }).join(',');
}
function functionRef(tokens, at) {
  const n = nameAt(tokens, at);
  if (tokens[n.next]?.value !== '(') return null;
  const end = closing(tokens, n.next);
  return { name: qualified(n.name), signature: signature(tokens.slice(n.next + 1, end)), next: end + 1 };
}
const functionKey = (ref) => `${ref.name}(${ref.signature})`;

/** Inventário determinista para os verificadores documentais. Sem efeitos laterais. */
export async function buildCatalog(root = ownRoot) {
  const migrationFiles = (await readdir(path.join(root, 'supabase/migrations'))).filter((f) => f.endsWith('.sql') && !forbidden(`supabase/migrations/${f}`)).sort();
  const functions = new Map(); const tables = new Map(); const policies = new Map();
  const triggers = new Map(); const views = new Map(); const buckets = new Map();
  const migrations = []; const declaredFunctions = new Set(); const dynamic = []; const notices = [];
  let declarationCount = 0;

  for (const basename of migrationFiles) {
    const file = `supabase/migrations/${basename}`; const sql = await readFile(path.join(root, file), 'utf8');
    const migration = { file, lines: sql.split(/\r?\n/).length - (sql.endsWith('\n') ? 1 : 0), tables: new Set(), functions: new Set(), dynamic: false };
    migrations.push(migration);
    const src = (token) => location(file, sql, token.start);
    const bodyText = (tokens) => compact(tokens.map((t) => t.raw).join(' '));

    function process(tokens, inheritedSource = null) {
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]; const v = t.value; const at = inheritedSource ?? src(t);
        if (v === 'do' && tokens[i + 1]?.kind === 'body') {
          const body = tokens[++i];
          // Somente as duas formas de geração de policies existentes na 1004.
          // Não se executa nem se interpreta SQL arbitrário com EXECUTE.
          if (/pg_policies/i.test(body.value) && /policyname\s*=\s*'staff_all'/i.test(body.value)) {
            for (const [key, policy] of policies) if (policy.table.startsWith('public.') && policy.name === 'staff_all') policies.delete(key);
          }
          const array = body.value.match(/foreach\s+\w+\s+in\s+array\s+array\s*\[([^\]]+)\]/i);
          if (array) {
            const names = [...array[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
            for (const literal of lex(body.value, body.bodyStart).filter((x) => x.kind === 'string' && /^create policy /i.test(x.value))) {
              for (const table of names) process(lex(literal.value.replace('%I', table)), src(literal));
            }
          }
          if (/\bexecute\b|pg_get_functiondef/i.test(body.value)) {
            migration.dynamic = true; dynamic.push({ ...src(body), kind: 'DO/EXECUTE', description: /pg_get_functiondef/i.test(body.value) ? 'Altera corpo de função por pg_get_functiondef/replace; não executado pelo catálogo.' : 'DDL dinâmico/condicional: só listas fixas de policies da 1004 são expandidas; restantes efeitos exigem revisão.' });
          }
          process(lex(body.value, body.bodyStart));
          continue;
        }
        if (v === 'create' && (tokens[i + 1]?.value === 'function' || (tokens[i + 1]?.value === 'or' && tokens[i + 2]?.value === 'replace' && tokens[i + 3]?.value === 'function'))) {
          const p = i + (tokens[i + 1].value === 'function' ? 2 : 4); const ref = functionRef(tokens, p);
          if (!ref) throw new Error(`Assinatura não reconhecida: ${file}:${at.line}`);
          const key = functionKey(ref); let end = ref.next;
          while (end < tokens.length && tokens[end].kind !== 'body' && tokens[end].value !== ';') end++;
          const header = bodyText(tokens.slice(ref.next, end)); const body = tokens[end];
          if (body?.kind !== 'body') throw new Error(`Função sem corpo reconhecido: ${key}`);
          const old = functions.get(key);
          const fn = { ...ref, source: at, security: /security definer/i.test(header) ? 'DEFINER' : 'INVOKER', securitySource: at, searchPath: header.match(/set search_path\s*=\s*([^]*?)(?:\bas\s*$|$)/i)?.[1]?.trim() ?? 'não declarado', acl: old?.acl ?? {}, history: [...(old?.history ?? []), { action: 'CREATE OR REPLACE', source: at }], body: body.value, bodyStart: body.bodyStart, bodyFile: file, bodyWholeSql: sql };
          delete fn.next; functions.set(key, fn); declaredFunctions.add(ref.name); declarationCount++; migration.functions.add(ref.name); i = end; continue;
        }
        if ((v === 'alter' || v === 'drop') && tokens[i + 1]?.value === 'function') {
          let p = i + 2; if (tokens[p]?.value === 'if') p += 2;
          const ref = functionRef(tokens, p); if (!ref) continue;
          const key = functionKey(ref); const fn = functions.get(key); let end = ref.next;
          while (end < tokens.length && tokens[end].value !== ';') end++;
          const tail = tokens.slice(ref.next, end); const command = bodyText(tail); migration.functions.add(ref.name);
          if (v === 'drop') functions.delete(key);
          else if (!fn) notices.push({ ...at, description: `ALTER sem definição estática: ${key}` });
          else {
            if (tail[0]?.value === 'set' && tail[1]?.value === 'schema') { functions.delete(key); fn.name = `${tail[2].value}.${fn.name.split('.').at(-1)}`; functions.set(functionKey(fn), fn); declaredFunctions.add(fn.name); }
            else if (tail[0]?.value === 'rename' && tail[1]?.value === 'to') { functions.delete(key); fn.name = `${fn.name.split('.')[0]}.${tail[2].value}`; functions.set(functionKey(fn), fn); declaredFunctions.add(fn.name); }
            else if (/security (?:invoker|definer)/i.test(command)) { fn.security = /security definer/i.test(command) ? 'DEFINER' : 'INVOKER'; fn.securitySource = at; }
            else if (/set search_path/i.test(command)) fn.searchPath = command.replace(/^set search_path\s*=\s*/i, '');
            fn.history.push({ action: `ALTER ${command}`, source: at });
          }
          i = end; continue;
        }
        if (v === 'grant' || v === 'revoke') {
          let end = i; while (end < tokens.length && tokens[end].value !== ';') end++;
          const statement = tokens.slice(i, end); const on = statement.findIndex((x) => x.value === 'on');
          if (statement[on + 1]?.value === 'function') {
            const ref = functionRef(statement, on + 2);
            if (ref) {
              const fn = functions.get(functionKey(ref));
              const boundary = statement.findIndex((x, j) => j >= ref.next && x.value === (v === 'grant' ? 'to' : 'from'));
              if (fn && boundary >= 0) for (const role of statement.slice(boundary + 1).filter((x) => x.kind === 'word')) fn.acl[role.value] = { action: v, source: at };
              else if (!fn) notices.push({ ...at, description: `Privilégio sem definição estática: ${functionKey(ref)}` });
            }
          }
          i = end; continue;
        }
        if (v === 'create' && tokens[i + 1]?.value === 'table') {
          let p = i + 2; if (tokens[p]?.value === 'if') p += 3;
          const n = nameAt(tokens, p); const name = qualified(n.name); migration.tables.add(name);
          if (tokens[n.next]?.value !== '(') continue;
          const end = closing(tokens, n.next); const cols = parts(tokens.slice(n.next + 1, end));
          const storeCol = cols.find((part) => part[0]?.value === 'store_id');
          const columns = cols.filter((part) => part[0]?.kind === 'word' && !['primary', 'unique', 'constraint', 'check', 'foreign', 'exclude'].includes(part[0].value)).map((part) => part[0].value);
          tables.set(name, { name, source: at, storeId: storeCol ? (/not null|primary key/i.test(bodyText(storeCol)) ? 'obrigatório' : 'nullable') : 'ausente', rls: false, columns, changes: [at] }); i = end; continue;
        }
        if ((v === 'alter' || v === 'drop') && tokens[i + 1]?.value === 'table') {
          let p = i + 2; if (tokens[p]?.value === 'if') p += 2;
          const n = nameAt(tokens, p); const name = qualified(n.name); migration.tables.add(name); let end = n.next;
          while (end < tokens.length && tokens[end].value !== ';') end++;
          const command = bodyText(tokens.slice(n.next, end)); const table = tables.get(name);
          if (v === 'drop') tables.delete(name);
          else if (table) {
            if (/enable row level security/i.test(command)) table.rls = true;
            if (/disable row level security/i.test(command)) table.rls = false;
            if (/add (?:column )?(?:if not exists )?store_id\b/i.test(command)) table.storeId = /store_id[^,]*not null/i.test(command) ? 'obrigatório' : 'nullable';
            if (/alter (?:column )?store_id set not null/i.test(command)) table.storeId = 'obrigatório';
            if (/alter (?:column )?store_id drop not null/i.test(command)) table.storeId = 'nullable';
            for (const m of command.matchAll(/add (?:column )?(?:if not exists )?([a-z_][\w]*)\s+(?!constraint\b)/gi)) if (!['constraint', 'primary', 'foreign', 'unique', 'check'].includes(m[1]) && !table.columns.includes(m[1])) table.columns.push(m[1]);
            table.changes.push(at);
          }
          i = end; continue;
        }
        if ((v === 'create' || v === 'drop') && tokens[i + 1]?.value === 'policy') {
          let p = i + 2; if (tokens[p]?.value === 'if') p += 2;
          const name = tokens[p]?.value; if (tokens[p + 1]?.value !== 'on') continue;
          const n = nameAt(tokens, p + 2); const table = qualified(n.name); let end = n.next;
          while (end < tokens.length && tokens[end].value !== ';') end++;
          const key = `${table}.${name}`;
          if (v === 'drop') policies.delete(key);
          else policies.set(key, { table, name, clause: bodyText(tokens.slice(n.next, end)), source: at, generated: !!inheritedSource });
          i = end;
          continue;
        }
        if ((v === 'create' || v === 'drop') && tokens[i + 1]?.value === 'trigger') {
          let p = i + 2; if (tokens[p]?.value === 'if') p += 2;
          const name = tokens[p]?.value; let end = p; while (end < tokens.length && tokens[end].value !== ';') end++;
          const on = tokens.findIndex((x, j) => j > p && j < end && x.value === 'on');
          if (on >= 0) {
            const n = nameAt(tokens, on + 1); const table = qualified(n.name); const key = `${table}.${name}`;
            if (v === 'drop') triggers.delete(key);
            else {
              const execute = tokens.findIndex((x, j) => j > on && j < end && x.value === 'execute');
              const ref = execute >= 0 ? functionRef(tokens, execute + 2) : null;
              triggers.set(key, { name, table, function: ref ? functionKey(ref) : 'não resolvida', source: at });
            }
          }
          i = end; continue;
        }
        if ((v === 'create' && (tokens[i + 1]?.value === 'view' || (tokens[i + 1]?.value === 'or' && tokens[i + 3]?.value === 'view'))) || (v === 'drop' && tokens[i + 1]?.value === 'view')) {
          let p = i + (tokens[i + 1]?.value === 'or' ? 4 : 2); if (tokens[p]?.value === 'if') p += 2;
          const n = nameAt(tokens, p); const name = qualified(n.name); let end = n.next; while (end < tokens.length && tokens[end].value !== ';') end++;
          if (v === 'drop') views.delete(name);
          else views.set(name, { name, securityInvoker: /security_invoker\s*=\s*true/i.test(bodyText(tokens.slice(n.next, end))), source: at });
          i = end; continue;
        }
        if (v === 'insert' && tokens[i + 1]?.value === 'into') {
          const n = nameAt(tokens, i + 2);
          if (n.name === 'storage.buckets' && tokens[n.next]?.value === '(') {
            const end = closing(tokens, n.next); const columns = parts(tokens.slice(n.next + 1, end)).map((p) => p[0]?.value);
            if (tokens[end + 1]?.value === 'values' && tokens[end + 2]?.value === '(') {
              const vals = parts(tokens.slice(end + 3, closing(tokens, end + 2)));
              const value = (column) => vals[columns.indexOf(column)] ?? [];
              const id = value('id')[0]?.value;
              if (id) buckets.set(id, { name: id, public: value('public')[0]?.value === 'true', limitBytes: Number(value('file_size_limit').map((x) => x.raw).join('')), mimeTypes: value('allowed_mime_types').filter((x) => x.kind === 'string').map((x) => x.value), source: at });
            }
          }
        }
      }
    }
    process(lex(sql));
  }

  // Só corpos que continuam na cadeia final, incluindo os renomeados privados.
  // INSERT ... SELECT fica como expressão dinâmica, sem inventar eventos.
  const events = [];
  for (const fn of functions.values()) {
    const tokens = lex(fn.body, fn.bodyStart);
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].value !== 'insert' || tokens[i + 1]?.value !== 'into') continue;
      const n = nameAt(tokens, i + 2); if (qualified(n.name) !== 'public.event_log' || tokens[n.next]?.value !== '(') continue;
      const colEnd = closing(tokens, n.next); const cols = parts(tokens.slice(n.next + 1, colEnd)); const index = cols.findIndex((x) => x[0]?.value === 'type');
      const at = location(fn.bodyFile, fn.bodyWholeSql, tokens[i].start);
      if (index < 0) { events.push({ event: 'tipo por omissão/não explícito', dynamic: true, producer: functionKey(fn), source: at }); continue; }
      const values = tokens[colEnd + 1]?.value;
      let expression = [];
      if (values === 'values' && tokens[colEnd + 2]?.value === '(') expression = parts(tokens.slice(colEnd + 3, closing(tokens, colEnd + 2)))[index] ?? [];
      else if (values === 'select') {
        let end = colEnd + 2; let depth = 0;
        while (end < tokens.length && !(depth === 0 && ['from', ';'].includes(tokens[end].value))) { if (tokens[end].value === '(') depth++; if (tokens[end].value === ')') depth--; end++; }
        expression = parts(tokens.slice(colEnd + 2, end))[index] ?? [];
      }
      const literal = expression.length === 1 && expression[0].kind === 'string';
      const expressionText = expression.length ? compact(fn.bodyWholeSql.slice(expression[0].start, expression.at(-1).end)) : 'INSERT com expressão não resolvida';
      events.push({ event: literal ? expression[0].value : expressionText, dynamic: !literal, producer: functionKey(fn), source: at, actor: cols.some((x) => x[0]?.value === 'actor_user_id') ? 'coluna explícita' : 'trigger/contexto (pode ser sistema)', store: cols.some((x) => x[0]?.value === 'store_id') ? 'coluna explícita' : 'trigger/contexto do pedido/empresa' });
    }
  }

  // Produtores TypeScript de runtime: procura INSERT, não leituras de event_log.
  // Não entra em pastas excluídas, testes, arquivo, env ou configurações locais.
  async function runtimeFiles(dir) {
    const result = [];
    if (forbidden(dir)) return result;
    for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
      if (forbidden(`${dir}/${entry.name}`)) continue;
      if (entry.isDirectory() && !['node_modules', '.next', '__tests__', 'tests'].includes(entry.name)) result.push(...await runtimeFiles(`${dir}/${entry.name}`));
      else if (entry.isFile() && /\.tsx?$/.test(entry.name)) result.push(`${dir}/${entry.name}`);
    }
    return result;
  }
  for (const file of (await Promise.all(['apps/web/app', 'apps/web/lib', 'services/print-bridge/src'].map(runtimeFiles))).flat().sort()) {
    const text = await readFile(path.join(root, file), 'utf8');
    for (const m of text.matchAll(/\.from\(\s*['"]event_log['"]\s*\)\s*\.insert\s*\(/g)) {
      const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 2500);
      const type = rest.match(/\btype\s*:\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|[^,\n}]+)/);
      const value = type?.[1]?.trim() ?? (/\btype\s*,/.test(rest) ? 'type (parâmetro/variável do produtor)' : null); const literal = value && /^['"]/.test(value);
      events.push({ event: literal ? value.slice(1, -1) : value || 'expressão não resolvida', dynamic: !literal, producer: file, source: location(file, text, m.index), actor: 'ver objecto e contexto servidor', store: 'ver objecto e contexto servidor' });
    }
  }
  const cleanFunctions = [...functions.values()].map(({ body, bodyStart, bodyFile, bodyWholeSql, ...fn }) => fn).sort((a, b) => functionKey(a).localeCompare(functionKey(b), 'en'));
  return {
    migrations: migrations.map((m) => ({ ...m, tables: [...m.tables].sort(), functions: [...m.functions].sort() })),
    functions: cleanFunctions,
    tables: [...tables.values()].map((t) => ({ ...t, policies: [...policies.values()].filter((p) => p.table === t.name).sort((a, b) => a.name.localeCompare(b.name, 'en')) })).sort((a, b) => a.name.localeCompare(b.name, 'en')),
    storagePolicies: [...policies.values()].filter((p) => p.table === 'storage.objects'),
    triggers: [...triggers.values()].sort((a, b) => `${a.table}.${a.name}`.localeCompare(`${b.table}.${b.name}`, 'en')),
    views: [...views.values()].sort((a, b) => a.name.localeCompare(b.name, 'en')),
    buckets: [...buckets.values()].sort((a, b) => a.name.localeCompare(b.name, 'en')),
    events: events.sort((a, b) => a.event.localeCompare(b.event, 'en') || a.producer.localeCompare(b.producer, 'en')),
    declaredFunctionNames: [...declaredFunctions].sort(), declarationCount, dynamic, notices,
  };
}

const generated = '> Gerado por [schema-catalog.mjs](../../scripts/docs/schema-catalog.mjs). Não editar a tabela à mão. Regenerar com `node scripts/docs/schema-catalog.mjs`; verificar com `node scripts/docs/schema-catalog.mjs --check`.\n\n';
const scopeNote = 'Retrato estático da **árvore de trabalho**, incluindo ficheiros ainda não commitados. Não comprova aplicação em staging/produção, grants efectivos da instalação ou resultados de testes. Não executa SQL.\n\n';
function table(header, rows) { return `| ${header.join(' | ')} |\n| ${header.map(() => '---').join(' | ')} |\n${rows.map((r) => `| ${r.map(cell).join(' | ')} |`).join('\n')}\n\n`; }
function latestPrivileges(fn) {
  const entries = Object.entries(fn.acl).sort(([a], [b]) => a.localeCompare(b, 'en'));
  const rendered = entries.map(([role, value]) => `${value.action === 'grant' ? 'GRANT' : 'REVOKE'} ${code(role)} ${sourceLink(value.source)}`);
  if (!fn.acl.public) rendered.push('PUBLIC: sem GRANT/REVOKE explícito nesta cadeia; default de criação por confirmar na instalação');
  return rendered.join('; ');
}
function render(catalog) {
  const { migrations, functions, tables, events } = catalog;
  const files = new Map();
  files.set('migrations.md', '# Índice de migrations\n\n' + generated + scopeNote +
    `${migrations.length} ficheiros; ${migrations.reduce((n, m) => n + m.lines, 0).toLocaleString('pt-PT')} linhas. A ordem é o timestamp do nome, não o sufixo de assunto. A 1080 precede intencionalmente 1077–1079. A cadeia canónica está em [supabase/migrations](../../supabase/migrations); os dois SQL de [packages/db/migrations](../../packages/db/migrations) são legado e não entram nesta contagem.\n\n` +
    table(['Ficheiro / assunto', 'Tabelas em DDL directo', 'Funções declaradas/alteradas/removidas', 'Limite'], migrations.map((m) => [sourceLink({ file: m.file, line: 1 }), m.tables.map(code).join(', ') || '—', m.functions.map(code).join(', ') || '—', m.dynamic ? 'Contém DO/EXECUTE; ver nota abaixo' : 'Leitura estática'])) +
    '## SQL dinâmico e limites\n\nAs listas fixas de policies da 1004 são expandidas pelo gerador; a remoção de `staff_all` nessa migration é aplicada ao catálogo. Condições `IF NOT EXISTS` são tratadas como a cadeia bem sucedida esperada. Não se executam corpos nem substituições de texto: a 1080 altera dois corpos, posteriormente redefinidos pela 1077 nesta árvore. Seeds/configuração de dados não são schema adicional.\n\n' + table(['Fonte', 'Observação'], catalog.dynamic.map((d) => [sourceLink(d), d.description])) + '[RPCs](rpcs.md) · [Tabelas/RLS](tabelas-rls.md) · [Eventos](eventos.md)\n');
  files.set('rpcs.md', '# Catálogo de funções e RPCs\n\n' + generated + scopeNote +
    `${catalog.declarationCount} declarações CREATE [OR REPLACE] resultam em **${functions.length} assinaturas** reconstituídas: ${functions.filter((f) => f.name.startsWith('public.')).length} no schema public e ${functions.filter((f) => f.name.startsWith('private.')).length} no private; ${functions.filter((f) => f.security === 'DEFINER').length} SECURITY DEFINER e ${functions.filter((f) => f.security === 'INVOKER').length} INVOKER.\n\n` +
    '**Como ler os grants:** são os últimos GRANT/REVOKE explícitos por papel e assinatura; renomes preservam ACL. PUBLIC é herdado pelos papéis, logo REVOKE de anon sozinho não fecha um EXECUTE concedido a PUBLIC. O default de criação PostgreSQL e eventuais privilégios externos não são medidos aqui. EXECUTE não substitui os guards do corpo; RLS e perfil continuam relevantes. O schema private não está exposto na [configuração local](../../supabase/config.toml#L13). Funções trigger e helpers também aparecem, sem se tornarem endpoints de browser.\n\n' +
    table(['Assinatura final', 'SECURITY / fonte', 'Último corpo / search_path', 'GRANT/REVOKE explícito final'], functions.map((f) => [code(functionKey(f)), `${f.security} ${sourceLink(f.securitySource)}`, `${sourceLink(f.source)}; ${code(f.searchPath)}`, latestPrivileges(f)])) +
    '## Cadeias e definições anteriores\n\nA fonte do corpo pode ter um nome anterior: SET SCHEMA/RENAME preserva a função, o corpo e os grants. Estes percursos são a composição actual; não se deve documentar somente a última função pública.\n\n' +
    table(['Entrada', 'Percurso relevante'], [
      ['get_menu', '1078 fotos → get_menu_before_addon_photos (1060 campanha) → get_menu_before_campaign (1046) → catálogo legado e disponibilidade por loja.'],
      ['create_order', '1081 mesas → create_order_before_upsell (1048; contrato de pagamento/checkout) → create_order_store_legacy (1060 campanha) → create_order_store_before_campaign (1013 numeração) → create_order_legacy; upsell capturado na camada de mesas.'],
      ['create_counter_sale', '1074 upsell → create_counter_sale_before_upsell (1064 vias) → without_tickets (1025 ficha) → without_recipe (F3 gaveta) → without_drawer (F2 dispositivo) → unlocked (1077 preço/stock/extras).'],
      ['advance_order / confirm_payment', '1062 → versões privadas F6 → consume/restore_order_stock (1025) e ingredientes (1024) → enqueue_kitchen_tickets (1064). Ver violações de perfil/pagamento/best-effort no relatório de auditoria.'],
      ['close_cash_session / close_cash_day', 'Turno:1095; dia:1091 com cash_day_report actualizado1095; relatório congelado e print de fecho.'],
    ]) +
    '## Histórico de alterações de nome e SECURITY\n\n' + table(['Assinatura final', 'Alterações posteriores à declaração inicial'], functions.filter((f) => f.history.some((h) => h.action.startsWith('ALTER'))).map((f) => [code(functionKey(f)), f.history.filter((h) => h.action.startsWith('ALTER')).map((h) => `${code(h.action)} ${sourceLink(h.source)}`).join('; ')])) +
    `## Limites de interpretação\n\nNão avalia SQL dinâmico geral, precondições de DO, privilégios herdados de outras instalações ou execução dos corpos. Os efeitos dinâmicos constam do [índice](migrations.md). ${catalog.notices.length ? 'Há declarações não resolvidas na tabela seguinte; o catálogo não as apresenta como certeza.' : 'Não ficaram ALTER/GRANT/REVOKE de função sem definição reconhecida nesta cadeia.'}\n\n` +
    (catalog.notices.length ? table(['Fonte', 'Limitação'], catalog.notices.map((n) => [sourceLink(n), n.description])) : '') + '[Tabelas/RLS](tabelas-rls.md) · [Eventos](eventos.md) · [Auditoria](../AUDITORIA-DOCUMENTACAO.md#5-código-que-viola-a-spec)\n');
  files.set('tabelas-rls.md', '# Tabelas, loja e RLS\n\n' + generated + scopeNote +
    `**${tables.length} tabelas**: ${tables.filter((t) => t.name.startsWith('public.')).length} public e ${tables.filter((t) => t.name.startsWith('private.')).length} private. ${tables.filter((t) => t.storeId === 'obrigatório').length} têm store_id obrigatório, ${tables.filter((t) => t.storeId === 'nullable').length} nullable e ${tables.filter((t) => t.storeId === 'ausente').length} não têm essa coluna. RLS ligada em ${tables.filter((t) => t.rls).length}. Estas contagens não significam isolamento correcto ou grants suficientes.\n\n` +
    '## Âmbito e excepções\n\nO catálogo/menu, marca, ingredientes/fichas e biblioteca de media são partilhados pela empresa. `stores` identifica a própria loja; `staff_profiles` liga-se por `staff_stores`. `order_feedback` e `referral_redemptions` obtêm loja por join a pedidos. As tabelas de conta são globais e fechadas a acesso directo do browser desde a 1035; usam token por RPC de serviço. `event_log` admite eventos de empresa owner-only; `analytics_events` admite tráfego pré-loja. `order_attribution` e `conversion_jobs` admitem NULL com policy mais permissiva: ver auditoria V-05.\n\n' +
    table(['Tabela', 'store_id', 'RLS na cadeia', 'Criação', 'Colunas observadas'], tables.map((t) => [code(t.name), t.storeId, t.rls ? 'activada' : 'não encontrada/desactivada', sourceLink(t.source), t.columns.map(code).join(', ')])) +
    '## Policies finais por leitura estática\n\nInclui policies geradas pelas listas fixas da 1004, com a fonte do modelo. Leitura deve conjugar policy + GRANT + guards da RPC: SECURITY DEFINER pode ultrapassar RLS. Ausência de policy não equivale a tabela pública. Os grants de tabelas não são calculados como ACL efectiva neste catálogo; consultar as migrations citadas e a auditoria.\n\n' +
    table(['Tabela', 'Policy', 'Cláusula', 'Fonte'], tables.flatMap((t) => t.policies.length ? t.policies.map((p) => [code(t.name), code(p.name), code(p.clause), `${sourceLink(p.source)}${p.generated ? ' (modelo expandido)' : ''}`]) : [[code(t.name), '—', 'Sem policy reconhecida; acesso privilegiado/RPC deve ser verificado', sourceLink(t.source)]])) +
    '## Triggers e views\n\nA fonte indica a criação do trigger; o corpo da função pode ter sido substituído posteriormente. Ver a última definição no catálogo de RPCs.\n\n' +
    table(['Tabela', 'Trigger', 'Função', 'Fonte'], catalog.triggers.map((t) => [code(t.table), code(t.name), code(t.function), sourceLink(t.source)])) +
    table(['View', 'security_invoker declarado', 'Última definição'], catalog.views.map((v) => [code(v.name), v.securityInvoker ? 'true' : 'não encontrado', sourceLink(v.source)])) +
    '## Storage\n\nAs policies abaixo pertencem a `storage.objects`, não às tabelas public. `payment-proofs` continua privado, mas a policy authenticated herdada só verifica bucket: não impõe loja. Fotos/menu e storefront-assets também preservam escrita authenticated sem perfil de equipa. Brand-assets restringe escrita ao dono; tv-media distingue dono/gerente e autoria no apagamento.\n\n' +
    table(['Bucket', 'Público', 'Limite declarado (bytes)', 'MIME', 'Fonte'], catalog.buckets.map((b) => [code(b.name), b.public ? 'sim' : 'não', b.limitBytes, b.mimeTypes.map(code).join(', '), sourceLink(b.source)])) +
    table(['Policy', 'Cláusula', 'Fonte'], catalog.storagePolicies.map((p) => [code(p.name), code(p.clause), sourceLink(p.source)])) +
    '## Campos monetários e invariantes\n\nDinheiro persiste em centavos inteiros; a existência da coluna não prova que todo o caminho respeita a regra. `orders.client_sale_id`, `payments.idempotency_key`, checkout por loja e chave de impressão têm unicidade própria. Troco é recalculado no servidor. `cash_diff_tolerance_cents` em settings tem default 1000 (10 MT), lido no fecho1095; fecho diário agrega relatórios dos turnos. Preço/stock têm mutações directas ainda sem auditoria obrigatória e movimentos de caixa sem chave de retry: não confundir schema documentado com validação concluída.\n\n[RPCs](rpcs.md) · [Migrations](migrations.md) · [Auditoria](../AUDITORIA-DOCUMENTACAO.md#5-código-que-viola-a-spec)\n');
  files.set('eventos.md', '# Catálogo de produtores de event_log\n\n' + generated + scopeNote +
    `${events.length} locais de INSERT reconhecidos: corpos de funções que permanecem na cadeia e escrita directa de runtime em web/bridge. Repetições representam produtores diferentes, não eventos duplicados observados. Não inclui testes, seeds de dados ou corpos substituídos.\n\n` +
    '**Dinâmico** conserva a expressão do código; não inventa nomes possíveis. Actor e loja podem ser preenchidos por `private.enforce_event_context`; uma operação de sistema pode não ter actor humano. A tabela regista a forma do INSERT, não prova conformidade completa da auditoria. SQL INSERT com SELECT, wrappers e expressões não reconhecidas permanecem assinalados.\n\n' +
    table(['Evento / expressão', 'Forma', 'Produtor', 'Fonte', 'Actor / loja'], events.map((e) => [code(e.event), e.dynamic ? 'dinâmico — expressão' : 'literal', code(e.producer), sourceLink(e.source), `${e.actor ?? 'não resolvido'}; ${e.store ?? 'não resolvida'}`])) +
    '## Limites e invariantes\n\nO detector TypeScript associa INSERT directo e a propriedade type próxima; não interpreta spreads, funções auxiliares nem fluxo de execução. O SQL lê a coluna type do INSERT; não executa ramo algum. Não confundir lista de nomes com prova de que toda a acção sensível grava evento. As lacunas de escrita directa e de permissões continuam em [Código que viola a spec](../AUDITORIA-DOCUMENTACAO.md#5-código-que-viola-a-spec).\n\n[RPCs](rpcs.md) · [Tabelas/RLS](tabelas-rls.md) · [Migrations](migrations.md)\n');
  return files;
}

export async function main(args = process.argv.slice(2)) {
  const catalog = await buildCatalog();
  if (args.includes('--names-json')) {
    process.stdout.write(`${JSON.stringify({ tables: catalog.tables.map((t) => t.name), functions: catalog.functions.map(functionKey), declaredFunctions: catalog.declaredFunctionNames }, null, 2)}\n`); return;
  }
  if (args.includes('--json')) { process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`); return; }
  if (args.some((arg) => arg !== '--check')) throw new Error('Opção desconhecida. Usar --check, --json ou --names-json.');
  const generatedFiles = render(catalog); const changed = [];
  for (const [name, content] of generatedFiles) {
    const target = path.join(ownRoot, 'docs/referencia', name);
    if (args.includes('--check')) {
      let current = ''; try { current = await readFile(target, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (current.replace(/\r\n/g, '\n') !== content) changed.push(`docs/referencia/${name}`);
    } else { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content, 'utf8'); }
  }
  if (changed.length) { process.stderr.write(`Catálogos desactualizados:\n${changed.map((f) => `- ${f}`).join('\n')}\n`); process.exitCode = 1; }
  else process.stdout.write(`${args.includes('--check') ? 'Verificados' : 'Gerados'} quatro catálogos: ${catalog.migrations.length} migrations, ${catalog.tables.length} tabelas, ${catalog.functions.length} funções, ${catalog.events.length} produtores.\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
