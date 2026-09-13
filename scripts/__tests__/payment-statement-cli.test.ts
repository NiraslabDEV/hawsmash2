import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const script = resolve('scripts/reconcile-payment-statement.ts');
const fixture = resolve('scripts/fixtures/payment-statement.example.json');
const run = (input: string, output: string) => spawnSync(process.execPath, ['--import', 'tsx', script, '--input', input, '--output', output], { encoding: 'utf8', timeout: 15_000 });
function cleanup(dir: string) {
  const target = resolve(dir);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('statement-cli-')) throw new Error('Pasta de teste inesperada.');
  rmSync(target, { recursive: true });
}

describe('conferência de extracto por ficheiro', () => {
  it('cria relatório e recusa substituir um ficheiro existente', () => {
    const dir = mkdtempSync(join(tmpdir(), 'statement-cli-'));
    try {
      const output = join(dir, 'report.json');
      expect(run(fixture, output).status).toBe(0);
      const before = readFileSync(output, 'utf8');
      expect(JSON.parse(before).status).toBe('matched');
      expect(run(fixture, output).status).toBe(1);
      expect(readFileSync(output, 'utf8')).toBe(before);
    } finally { cleanup(dir); }
  });
  it('sinaliza divergências com código2 e recusa dados fora do contrato sem os escrever no log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'statement-cli-'));
    try {
      const input = join(dir, 'input.json'); const output = join(dir, 'report.json');
      const data = JSON.parse(readFileSync(fixture, 'utf8')); data.statement[0].amountCents++;
      writeFileSync(input, JSON.stringify(data));
      expect(run(input, output).status).toBe(2);
      data.customerPhone = 'PLACEHOLDER_DADO_PRIVADO'; writeFileSync(input, JSON.stringify(data));
      const invalid = join(dir, 'invalid.json'); const result = run(input, invalid);
      expect(result.status).toBe(1);
      expect(existsSync(invalid)).toBe(false);
      expect(result.stderr).not.toContain('PLACEHOLDER_DADO_PRIVADO');
    } finally { cleanup(dir); }
  });
});
