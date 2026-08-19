import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { FileRequestLedger } from '../request-ledger';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('idempotência persistente do HTTP local', () => {
  it('recorda requestId depois de reiniciar o bridge', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hawsmash-ledger-'));
    tempDirs.push(directory);
    const file = join(directory, 'printed-requests.log');

    const firstProcess = new FileRequestLedger(file);
    await firstProcess.initialize();
    await firstProcess.record('sale-123:receipt');

    const restartedProcess = new FileRequestLedger(file);
    await restartedProcess.initialize();

    expect(restartedProcess.has('sale-123:receipt')).toBe(true);
    expect(restartedProcess.has('sale-456:receipt')).toBe(false);
  });
});
