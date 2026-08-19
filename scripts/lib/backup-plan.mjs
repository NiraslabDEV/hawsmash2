// Política do backup nocturno, isolada da execução para poder ser testada
// sem tocar em nenhuma base de dados. Ver docs/RUNBOOK.md §2 e CLAUDE.md §11.6.

/** Dias que um dump fica guardado antes de ser apagado. */
export const RETENTION_DAYS = 30;

/** Nome determinístico do ficheiro: ordenável e legível na pasta. */
export function backupFileName(now = new Date(), label = 'hawsmash2') {
  const stamp = now.toISOString().replace(/[:.]/g, '-').replace('Z', 'Z');
  return `${label}-${stamp}.dump`;
}

/** Dumps que já passaram a retenção (os que devem ser apagados hoje). */
export function expiredBackups(files, now = new Date(), retentionDays = RETENTION_DAYS) {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  return files
    .filter((file) => file.name.endsWith('.dump'))
    .filter((file) => new Date(file.modifiedAt).getTime() < cutoff)
    .map((file) => file.name);
}

/**
 * Argumentos do pg_dump. Formato custom (-Fc) porque é o que o pg_restore
 * aceita selectivamente — importa no teste de restauro mensal.
 */
export function pgDumpArgs(connectionString, outputPath) {
  if (!connectionString) throw new Error('DATABASE_URL em falta: sem ligação não há backup.');
  return ['--dbname', connectionString, '--format', 'custom', '--no-owner', '--file', outputPath];
}

/**
 * O envio para fora só acontece com destino configurado. Sem `BACKUP_TARGET` o
 * dump fica em disco local e o script diz porquê — nunca falha em silêncio.
 * BLOQUEIO: B-008 (destino externo por decidir).
 */
export function resolveTarget(env = {}) {
  const target = (env.BACKUP_TARGET ?? '').trim();
  if (!target) return { kind: 'local', reason: 'BACKUP_TARGET não definido (B-008)' };
  if (!/^[a-z0-9+.-]+:\/\//i.test(target)) {
    return { kind: 'invalid', reason: `BACKUP_TARGET inválido: ${target}` };
  }
  return { kind: 'remote', target };
}
