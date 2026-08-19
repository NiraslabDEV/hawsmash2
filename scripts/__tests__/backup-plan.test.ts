import { describe, expect, it } from 'vitest';

import {
  RETENTION_DAYS,
  backupFileName,
  expiredBackups,
  pgDumpArgs,
  resolveTarget,
} from '../lib/backup-plan.mjs';

describe('backup nocturno', () => {
  it('nomeia o dump de forma ordenável', () => {
    const name = backupFileName(new Date('2026-08-19T23:00:00Z'));
    expect(name).toBe('hawsmash2-2026-08-19T23-00-00-000Z.dump');
  });

  it('apaga só o que passou os 30 dias de retenção', () => {
    const now = new Date('2026-08-19T23:00:00Z');
    const files = [
      { name: 'hawsmash2-2026-08-18.dump', modifiedAt: '2026-08-18T23:00:00Z' },
      { name: 'hawsmash2-2026-07-01.dump', modifiedAt: '2026-07-01T23:00:00Z' },
      { name: 'notas.txt', modifiedAt: '2026-01-01T00:00:00Z' },
    ];

    expect(RETENTION_DAYS).toBe(30);
    expect(expiredBackups(files, now)).toEqual(['hawsmash2-2026-07-01.dump']);
  });

  it('exige ligação e usa formato restaurável', () => {
    expect(() => pgDumpArgs('', '/tmp/x.dump')).toThrow(/DATABASE_URL/);
    expect(pgDumpArgs('postgres://u:p@h/db', '/tmp/x.dump')).toEqual([
      '--dbname',
      'postgres://u:p@h/db',
      '--format',
      'custom',
      '--no-owner',
      '--file',
      '/tmp/x.dump',
    ]);
  });

  it('fica em disco local enquanto o destino externo não estiver decidido', () => {
    expect(resolveTarget({})).toMatchObject({ kind: 'local' });
    expect(resolveTarget({ BACKUP_TARGET: 's3://hawsmash-backups' })).toMatchObject({
      kind: 'remote',
    });
    expect(resolveTarget({ BACKUP_TARGET: 'pasta-qualquer' })).toMatchObject({ kind: 'invalid' });
  });
});
