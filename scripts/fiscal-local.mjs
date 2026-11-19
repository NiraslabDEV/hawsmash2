// Só o contentor local conhecido. Nunca lê URLs, chaves ou o projecto ligado no CLI.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

export const container = 'supabase_db_hawsmash2';
export function docker(args, input) {
  const r = spawnSync('docker', ['exec', '-i', container, ...args], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || String(r.error));
  return r.stdout;
}
export function sql(source, db = 'postgres') {
  return docker(['psql', '-X', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q'], source);
}
export function migrations() {
  return readdirSync('supabase/migrations').filter(f => /^202611/.test(f) && Number(f.split('_')[1]) >= 1135)
    .sort().map(f => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n');
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/fiscal-local.mjs')) {
  const tests = process.argv.slice(2);
  for (const test of tests.length ? tests : ['fiscal', 'fiscal_rpcs']) {
    if (!/^[a-z0-9_]+$/.test(test)) throw new Error('Nome de ensaio inválido');
    console.log(sql(`begin;\n${migrations()}\n${readFileSync(`supabase/tests/${test}.sql`, 'utf8')}\nrollback;`));
  }
}
