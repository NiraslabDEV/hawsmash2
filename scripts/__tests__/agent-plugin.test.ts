import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../package-agent-plugin.mjs', import.meta.url));
const validArgs = ['--base-url', 'https://developers.openai.com', '--name', 'restaurant-test', '--display-name', 'Restaurante de Teste'];

function run(output: string, args = validArgs) {
  return spawnSync(process.execPath, [script, ...args, '--output', output], { encoding: 'utf8' });
}

async function temporary(test: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'restaurant-agent-plugin-'));
  try {
    await test(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('pacote do plugin por instalação', () => {
  it('gera manifestos portáteis e compatíveis com o mesmo endpoint, sem segredos ou placeholders', async () => {
    await temporary(async (directory) => {
      const result = run(directory);
      expect(result.status, result.stderr).toBe(0);
      const root = path.join(directory, 'restaurant-test');
      const manifest = JSON.parse(await readFile(path.join(root, 'plugin.json'), 'utf8'));
      const compatibility = JSON.parse(await readFile(path.join(root, '.codex-plugin/plugin.json'), 'utf8'));
      const mcp = JSON.parse(await readFile(path.join(root, 'mcp.json'), 'utf8'));
      const legacyMcp = JSON.parse(await readFile(path.join(root, '.mcp.json'), 'utf8'));
      expect(manifest.name).toBe('restaurant-test');
      expect(compatibility.name).toBe(manifest.name);
      expect(manifest.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
      expect(manifest.extensions['com.openai'].interface.displayName).toBe('Restaurante de Teste');
      expect(mcp.mcpServers['restaurant-os']).toEqual({ type: 'streamable-http', url: 'https://developers.openai.com/api/mcp' });
      expect(legacyMcp.mcpServers['restaurant-os']).toEqual({ type: 'http', url: 'https://developers.openai.com/api/mcp' });
      expect(manifest).not.toHaveProperty('apps');
      for (const name of await readdir(root, { recursive: true })) {
        if (!/\.(json|md)$/.test(name)) continue;
        const contents = await readFile(path.join(root, name), 'utf8');
        expect(contents).not.toMatch(/PLACEHOLDER_/i);
        expect(contents).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|Bearer\s+[a-zA-Z0-9]/);
      }
      const skill = await readFile(path.join(root, 'skills/pedir-comida/SKILL.md'), 'utf8');
      expect(skill).toContain('prepare_checkout');
      expect(skill).toContain('não cria um pedido');
      expect(result.stdout).toContain('não foi publicado');
    });
  });

  it.each([
    'http://developers.openai.com',
    'https://PLACEHOLDER_SITE_DOMAIN',
    'https://user:secret@developers.openai.com',
    'https://developers.openai.com/api/mcp',
    'https://developers.openai.com/../',
    'https://developers.openai.com/%2e%2e/',
    'https://developers.openai.com?key=secret',
    'https://developers.openai.com#secret',
    'https://developers.openai.com:8443',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]',
    'https://internal.local',
    'https://example.com',
    ' https://developers.openai.com',
    'https://developers.openai.com\\@evil.com',
  ])('recusa origem insegura ou incompleta antes de escrever: %s', async (baseUrl) => {
    await temporary(async (directory) => {
      const args = [...validArgs];
      args[1] = baseUrl;
      const result = run(directory, args);
      expect(result.status).not.toBe(0);
      expect(await readdir(directory)).toEqual([]);
      expect(result.stderr).not.toContain('user:secret');
    });
  });

  it.each(['../escape', 'Bad Name', 'PLACEHOLDER_PLUGIN', 'con', 'a'.repeat(65)])('recusa nome inválido: %s', async (name) => {
    await temporary(async (directory) => {
      const args = [...validArgs];
      args[3] = name;
      expect(run(directory, args).status).not.toBe(0);
      expect(await readdir(directory)).toEqual([]);
    });
  });

  it('recusa nome de apresentação incompleto e opções desconhecidas', async () => {
    await temporary(async (directory) => {
      const args = [...validArgs];
      args[5] = 'PLACEHOLDER_MARCA';
      expect(run(directory, args).status).not.toBe(0);
      expect(run(directory, [...validArgs, '--token', 'sensitive']).status).not.toBe(0);
      expect(run(directory, [...validArgs, '--base-url', 'https://developers.openai.com']).status).not.toBe(0);
      expect(await readdir(directory)).toEqual([]);
    });
  });

  it('preserva um pacote existente sem sobrepor ficheiros', async () => {
    await temporary(async (directory) => {
      expect(run(directory).status).toBe(0);
      const existing = path.join(directory, 'restaurant-test/plugin.json');
      await writeFile(existing, 'ficheiro a preservar', 'utf8');
      const repeated = run(directory);
      expect(repeated.status).not.toBe(0);
      expect(await readFile(existing, 'utf8')).toBe('ficheiro a preservar');
    });
  });

  it('normaliza a barra final e o HTTPS padrão sem alterar a origem', async () => {
    await temporary(async (directory) => {
      const args = [...validArgs];
      args[1] = 'https://developers.openai.com:443/';
      const result = run(directory, args);
      expect(result.status, result.stderr).toBe(0);
      const manifest = JSON.parse(await readFile(path.join(directory, 'restaurant-test/plugin.json'), 'utf8'));
      expect(manifest.homepage).toBe('https://developers.openai.com');
    });
  });
});
