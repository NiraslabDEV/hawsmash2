import { describe, expect, it } from 'vitest';
import { agentConfig, checkAgentRequest, createAgentBudget, readAgentJson } from '../http';

const config = { enabled: true, baseUrl: 'https://restaurante.example', allowedOrigins: [] };
const request = (headers: Record<string, string> = {}) => new Request('https://restaurante.example/api/mcp', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}',
});

describe('fronteira HTTP pública dos agentes', () => {
  it('nasce desligada e exige uma origem explícita segura quando ligada', () => {
    expect(agentConfig({}).enabled).toBe(false);
    expect(() => agentConfig({ AGENT_TOOLS_ENABLED: 'true' })).toThrow();
    for (const url of ['https://user:pass@restaurante.example', 'javascript:alert(1)', 'https://PLACEHOLDER_DOMINIO', 'http://restaurante.example', 'https://restaurante.example/outro']) {
      expect(() => agentConfig({ AGENT_TOOLS_ENABLED: 'true', AGENT_PUBLIC_BASE_URL: url })).toThrow();
    }
    expect(agentConfig({ AGENT_TOOLS_ENABLED: 'true', APP_BASE_URL: config.baseUrl }).baseUrl).toBe(config.baseUrl);
    expect(agentConfig({ AGENT_TOOLS_ENABLED: 'true', AGENT_PUBLIC_BASE_URL: 'http://127.0.0.1:3017', NODE_ENV: 'development' }).baseUrl).toBe('http://127.0.0.1:3017');
    expect(() => agentConfig({ AGENT_TOOLS_ENABLED: 'true', AGENT_PUBLIC_BASE_URL: 'http://127.0.0.1:3017', NODE_ENV: 'production' })).toThrow();
  });

  it('aceita clientes MCP sem Origin e browser da própria loja', () => {
    expect(checkAgentRequest(request(), config)).toBeNull();
    expect(checkAgentRequest(request({ Origin: config.baseUrl }), config)).toBeNull();
    expect(checkAgentRequest(request(), { ...config, enabled: false })?.status).toBe(404);
  });

  it('recusa Origin não autorizado, incluindo null, sem confiar em forwarded headers', () => {
    for (const origin of ['null', 'https://atacante.example', config.baseUrl + '.atacante.example']) {
      expect(checkAgentRequest(request({ Origin: origin, 'X-Forwarded-Host': 'restaurante.example' }), config)?.status).toBe(403);
    }
    expect(checkAgentRequest(request({ Origin: 'https://chatgpt.com' }), { ...config, allowedOrigins: ['https://chatgpt.com'] })).toBeNull();
  });

  it('recusa formulários e payloads grandes antes de os processar', async () => {
    expect(checkAgentRequest(request({ 'Content-Type': 'text/plain' }), config)?.status).toBe(415);
    await expect(readAgentJson(new Request('https://restaurante.example', { method: 'POST', body: 'x'.repeat(32769) }))).rejects.toThrow();
    await expect(readAgentJson(new Request('https://restaurante.example', { method: 'POST', body: '{bad' }))).rejects.toThrow();
    expect(await readAgentJson(request())).toEqual({});
  });

  it('o orçamento limita pedidos e concorrência sem confiar em IP enviado pelo cliente', () => {
    let now = 0;
    const budget = createAgentBudget({ maxRequests: 3, maxConcurrent: 2, windowMs: 1000, now: () => now });
    const first = budget.acquire();
    const second = budget.acquire();
    expect(first).toBeTypeOf('function');
    expect(second).toBeTypeOf('function');
    expect(budget.acquire()).toBeNull();
    first?.(); first?.();
    const third = budget.acquire();
    expect(third).toBeTypeOf('function');
    second?.(); third?.();
    expect(budget.acquire()).toBeNull();
    now = 1001;
    expect(budget.acquire()).toBeTypeOf('function');
  });
});
