import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const serviceRoot = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(serviceRoot, path), 'utf8');

describe('empacotamento e arranque Windows', () => {
  it('configura o SEA a partir de um único bundle CommonJS', () => {
    const config = JSON.parse(read('sea-config.json'));
    expect(config).toMatchObject({
      main: 'build/bridge.cjs',
      output: 'build/sea-prep.blob',
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    });

    const buildScript = read('windows/build-sea.ps1');
    expect(buildScript).toContain('NODE_SEA_BLOB');
    expect(buildScript).toContain('NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2');
  });

  it('instala uma tarefa no arranque com reinício após crash', () => {
    const installScript = read('windows/install-task.ps1');
    expect(installScript).toContain('New-ScheduledTaskTrigger -AtStartup');
    expect(installScript).toContain('-RestartCount 999');
    expect(installScript).toContain('-User "SYSTEM"');
  });
});
