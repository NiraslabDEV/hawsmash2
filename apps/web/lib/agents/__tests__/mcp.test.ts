import { describe, expect, it, vi } from 'vitest';
import { handleMcpRequest } from '../mcp';

const deps = { rpc: vi.fn(async () => ({ data: [], error: null })), baseUrl: 'https://restaurante.example' };
const request = (body: unknown, extra: Record<string, string> = {}) => new Request(deps.baseUrl + '/api/mcp', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...extra },
  body: JSON.stringify(body),
});
const rpc = async (method: string, params?: unknown) => {
  const body = { jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) };
  const response = await handleMcpRequest(request(body), body, deps);
  return { response, body: await response.json() };
};

describe('MCP real com transporte oficial', () => {
  it('negocia initialize sem sessão e sem abrir a base de dados', async () => {
    const result = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'teste', version: '1' } });
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get('mcp-session-id')).toBeNull();
    expect(result.body.result.capabilities.tools).toBeDefined();
    expect(result.body.result.serverInfo.name).toBe('restaurant-os');
    expect(result.body.result.instructions).toContain('checkout');
  });

  it('anuncia somente os quatro tools públicos com schemas e annotations honestos', async () => {
    const { body } = await rpc('tools/list');
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['list_stores', 'get_menu', 'quote_order', 'prepare_checkout']);
    for (const tool of body.result.tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it('devolve dados estruturados e conteúdo legível, sem ecoar erros internos', async () => {
    const { body } = await rpc('tools/call', { name: 'list_stores', arguments: {} });
    expect(body.result.structuredContent).toBeDefined();
    expect(body.result.content[0].type).toBe('text');
    expect(body.result.isError).not.toBe(true);
  });

  it('recusa tools de gestão e payload que fornece preço sem chamar RPC', async () => {
    deps.rpc.mockClear();
    const unknown = await rpc('tools/call', { name: 'create_counter_sale', arguments: {} });
    expect(unknown.body.result.isError).toBe(true);
    const invalid = await rpc('tools/call', { name: 'get_menu', arguments: { storeSlug: 'loja', price_cents: 1 } });
    expect(invalid.body.result.isError).toBe(true);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it('aceita notification initialized sem inventar uma resposta JSON-RPC', async () => {
    const body = { jsonrpc: '2.0', method: 'notifications/initialized' };
    const response = await handleMcpRequest(request(body), body, deps);
    expect(response.status).toBe(202);
    expect(await response.text()).toBe('');
  });

  it('recusa versão de protocolo inválida e JSON-RPC em lote', async () => {
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    const invalidVersion = await handleMcpRequest(request(body, { 'MCP-Protocol-Version': '2099-01-01' }), body, deps);
    expect(invalidVersion.status).toBe(400);
    const batch = await handleMcpRequest(request([body]), [body], deps);
    expect(batch.status).toBe(400);
  });
});
