import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { AgentToolError, executeAgentTool } from './service';
import { handleMcpRequest, isAgentToolName, publicAgentError, type AgentDependencies } from './mcp';
import { agentBudget, agentConfig, agentJson, AgentHttpError, checkAgentRequest, readAgentJson, withAgentHeaders } from './http';

/** Só os RPCs públicos; nunca usa sessão do dono nem service role. */
export function publicAgentDependencies(baseUrl: string): AgentDependencies {
  return {
    baseUrl,
    rpc: async (name, args) => {
      if (!['list_public_stores', 'get_menu'].includes(name)) throw new Error('RPC não permitido.');
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key || key.startsWith('sb_secret_')) throw new Error('Configuração pública indisponível.');
      if (!key.startsWith('sb_publishable_')) {
        // Também recusa uma service role legada colocada por engano na env pública.
        const claims: unknown = JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url').toString('utf8'));
        if (!claims || typeof claims !== 'object' || !('role' in claims) || claims.role !== 'anon') throw new Error('Chave pública inválida.');
      }
      // Cliente isolado, sem cookies nem refresh de sessões. Mesmo com cookies de
      // administrador no pedido HTTP, esta chamada continua com perfil anon.
      const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(10_000) }) },
      });
      const { data, error } = await client.rpc(name, args);
      return { data, error };
    },
  };
}

const browserCallSchema = z.object({ name: z.string().max(64), arguments: z.record(z.string(), z.unknown()) }).strict();

export function createAgentRoute(transport: 'mcp' | 'browser') {
  return async (request: Request): Promise<Response> => {
    let config;
    try { config = agentConfig(); }
    catch { return agentJson({ error: 'Canal de agentes por configurar.' }, 503); }
    const rejected = checkAgentRequest(request, config);
    if (rejected) return rejected;
    if (request.method === 'OPTIONS') return withAgentHeaders(new Response(null, { status: 204 }), request, config);
    if (request.method !== 'POST') return withAgentHeaders(agentJson({ error: 'Usa POST para ligar ao servidor MCP.' }, 405, { Allow: 'POST, OPTIONS' }), request, config);
    const release = agentBudget.acquire();
    if (!release) return withAgentHeaders(agentJson({ error: 'Muitos pedidos. Tenta novamente dentro de um minuto.' }, 429, { 'Retry-After': '60' }), request, config);
    try {
      const body = await readAgentJson(request);
      const deps = publicAgentDependencies(config.baseUrl);
      let response: Response;
      if (transport === 'mcp') response = await handleMcpRequest(request, body, deps);
      else {
        const call = browserCallSchema.parse(body);
        if (!isAgentToolName(call.name)) return withAgentHeaders(agentJson({ error: 'Ferramenta não disponível.' }, 400), request, config);
        const result = await executeAgentTool(call.name, call.arguments, deps);
        response = agentJson({ result });
      }
      return withAgentHeaders(response, request, config);
    } catch (error) {
      const status = error instanceof AgentHttpError ? error.status : error instanceof z.ZodError ? 400 : error instanceof AgentToolError ? 422 : 503;
      return withAgentHeaders(agentJson({ error: error instanceof AgentHttpError ? error.message : publicAgentError(error) }, status), request, config);
    } finally { release(); }
  };
}
