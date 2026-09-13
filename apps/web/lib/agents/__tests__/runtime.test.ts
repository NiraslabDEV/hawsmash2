import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ rpc: vi.fn(), createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocked.createClient }));
import { createAgentRoute, publicAgentDependencies } from '../runtime';

const makeRequest = (body: unknown, headers: Record<string, string> = {}) => new Request('https://restaurante.example/api/agents/tools', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.stubEnv('AGENT_TOOLS_ENABLED', 'true');
  vi.stubEnv('AGENT_PUBLIC_BASE_URL', 'https://restaurante.example');
  vi.stubEnv('AGENT_ALLOWED_ORIGINS', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://projecto.example');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_publishable_PLACEHOLDER_TEST');
  mocked.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  mocked.createClient.mockReset().mockReturnValue({ rpc: mocked.rpc });
});
afterEach(() => vi.unstubAllEnvs());

describe('runtime público sem sessão nem privilégios de gestão', () => {
  it('mesmo com cookies do painel cria cliente novo com chave pública e allowlist de RPCs', async () => {
    const response = await createAgentRoute('browser')(makeRequest({ name: 'list_stores', arguments: {} }, { Cookie: 'admin-session=PLACEHOLDER_TEST' }));
    expect(response.status).toBe(200);
    expect(mocked.createClient).toHaveBeenCalledWith('https://projecto.example', 'sb_publishable_PLACEHOLDER_TEST', expect.objectContaining({ auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }));
    expect(mocked.createClient.mock.calls[0][2]).not.toHaveProperty('cookies');
    await expect(publicAgentDependencies('https://restaurante.example').rpc('create_order', {})).rejects.toThrow();
  });

  it('recusa uma service role moderna ou JWT legado em configuração errada', async () => {
    for (const key of ['sb_secret_PLACEHOLDER_TEST', 'header.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.signature']) {
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', key);
      await expect(publicAgentDependencies('https://restaurante.example').rpc('list_public_stores')).rejects.toThrow();
    }
    expect(mocked.createClient).not.toHaveBeenCalled();
  });

  it('flag desligada fecha o canal e não chega à BD', async () => {
    vi.stubEnv('AGENT_TOOLS_ENABLED', 'false');
    const response = await createAgentRoute('browser')(makeRequest({ name: 'list_stores', arguments: {} }));
    expect(response.status).toBe(404);
    expect(mocked.createClient).not.toHaveBeenCalled();
  });

  it('falha RPC nunca devolve pormenores internos no corpo', async () => {
    mocked.rpc.mockResolvedValue({ data: null, error: { message: 'SECRET_DATABASE_DETAIL', details: 'SECRET_DATABASE_DETAIL' } });
    const response = await createAgentRoute('browser')(makeRequest({ name: 'list_stores', arguments: {} }));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain('SECRET_DATABASE_DETAIL');
  });

  it('OPTIONS permite só origens explícitas, GET MCP não cria stream de sessão', async () => {
    const route = createAgentRoute('mcp');
    const preflight = await route(new Request('https://restaurante.example/api/mcp', { method: 'OPTIONS', headers: { Origin: 'https://restaurante.example' } }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://restaurante.example');
    expect(preflight.headers.get('access-control-allow-credentials')).toBeNull();
    expect((await route(new Request('https://restaurante.example/api/mcp'))).status).toBe(405);
  });
});
