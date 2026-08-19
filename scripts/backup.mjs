#!/usr/bin/env node
// Backup nocturno da BD de produção (CLAUDE.md §11.6, RUNBOOK §2).
//
// Corre `pg_dump` em formato custom para uma pasta local e limpa o que passou
// os 30 dias de retenção. O envio para armazenamento externo só acontece com
// BACKUP_TARGET definido — BLOQUEIO: B-008.
//
// Uso: DATABASE_URL=... node scripts/backup.mjs [--dir ./backups] [--dry-run]

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  RETENTION_DAYS,
  backupFileName,
  expiredBackups,
  pgDumpArgs,
  resolveTarget,
} from './lib/backup-plan.mjs';

const args = process.argv.slice(2);
const dirIndex = args.indexOf('--dir');
const outputDir = path.resolve(dirIndex >= 0 ? args[dirIndex + 1] : 'backups');
const dryRun = args.includes('--dry-run');

function log(message) {
  process.stdout.write(`[backup] ${message}\n`);
}

const connectionString = process.env.DATABASE_URL ?? '';
const target = resolveTarget(process.env);

mkdirSync(outputDir, { recursive: true });

const fileName = backupFileName();
const outputPath = path.join(outputDir, fileName);
const dumpArgs = pgDumpArgs(connectionString, outputPath);

if (dryRun) {
  log(`ensaio: pg_dump ${dumpArgs.filter((arg) => !arg.startsWith('postgres')).join(' ')}`);
} else {
  const result = spawnSync('pg_dump', dumpArgs, { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    log(`FALHOU: pg_dump terminou com ${result.status ?? result.error?.message}`);
    process.exit(1);
  }
  const { size } = statSync(outputPath);
  log(`dump escrito: ${fileName} (${Math.round(size / 1024)} KB)`);
}

const existing = readdirSync(outputDir).map((name) => ({
  name,
  modifiedAt: statSync(path.join(outputDir, name)).mtime.toISOString(),
}));
for (const name of expiredBackups(existing)) {
  if (!dryRun) rmSync(path.join(outputDir, name));
  log(`removido por retenção (${RETENTION_DAYS} dias): ${name}`);
}

if (target.kind === 'local') {
  log(`guardado só em disco — ${target.reason}`);
} else if (target.kind === 'invalid') {
  log(`destino externo ignorado — ${target.reason}`);
  process.exit(1);
} else {
  log(`destino externo configurado: ${target.target}`);
  log('envio para o destino externo ainda não implementado (B-008: falta credencial).');
}
