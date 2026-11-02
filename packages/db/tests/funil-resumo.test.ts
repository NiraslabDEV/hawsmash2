import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('o funil lê um resumo por sessão mantido pelo trigger, por período e por loja (1120)', () => {
  // Só o Postgres local nomeado; transacção revertida, sem eventos persistentes.
  const sql = readFileSync(resolve(__dirname, 'funil-resumo.sql'), 'utf8');
  const result = execFileSync('docker', ['exec', '-i', 'supabase_db_hawsmash2', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' });
  expect(result).toContain('ROLLBACK');
});
