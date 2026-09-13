/** Limites e configuração comuns aos transportes MCP e WebMCP. */
export interface AgentConfig {
  enabled: boolean;
  baseUrl: string;
  allowedOrigins: string[];
}

function origin(value: string, development: boolean): string {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (value.includes('PLACEHOLDER_') || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/' || (url.protocol !== 'https:' && !(development && local && url.protocol === 'http:'))) {
    throw new Error('Origem dos agentes inválida.');
  }
  return url.origin;
}

export function agentConfig(env: Record<string, string | undefined> = process.env): AgentConfig {
  if (env.AGENT_TOOLS_ENABLED !== 'true') return { enabled: false, baseUrl: '', allowedOrigins: [] };
  const development = env.NODE_ENV !== 'production';
  return {
    enabled: true,
    baseUrl: origin((env.AGENT_PUBLIC_BASE_URL || env.APP_BASE_URL || '').trim(), development),
    allowedOrigins: (env.AGENT_ALLOWED_ORIGINS || '').split(',').map((entry) => entry.trim())
      .filter(Boolean).map((entry) => origin(entry, development)),
  };
}

export function agentJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}

export function checkAgentRequest(request: Request, config: AgentConfig): Response | null {
  if (!config.enabled) return agentJson({ error: 'Canal de agentes indisponível.' }, 404);
  // DECISÃO: clientes MCP remotos podem não enviar Origin. Browsers só entram
  // pelas origens configuradas; X-Forwarded-* nunca autoriza um cliente.
  const requestOrigin = request.headers.get('origin');
  if (requestOrigin !== null && requestOrigin !== config.baseUrl && !config.allowedOrigins.includes(requestOrigin)) {
    return agentJson({ error: 'Origem não autorizada.' }, 403);
  }
  if (request.method === 'POST' && request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return agentJson({ error: 'Usa Content-Type application/json.' }, 415);
  }
  return null;
}

export class AgentHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function readAgentJson(request: Request): Promise<unknown> {
  const maximum = 32_768;
  if (Number(request.headers.get('content-length')) > maximum) {
    throw new AgentHttpError('Pedido demasiado grande.', 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AgentHttpError('Corpo JSON obrigatório.', 400);
  const decoder = new TextDecoder();
  const deadline = setTimeout(() => { void reader.cancel().catch(() => undefined); }, 5000);
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new AgentHttpError('Pedido demasiado grande.', 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof AgentHttpError) throw error;
    throw new AgentHttpError('Corpo JSON inválido.', 400);
  } finally { clearTimeout(deadline); reader.releaseLock(); }
}

/** Orçamento de processo partilhado pelas duas rotas, sem mapas ilimitados por IP. */
export function createAgentBudget({ maxRequests = 180, maxConcurrent = 8, windowMs = 60_000, now = Date.now } = {}) {
  let start = now();
  let count = 0;
  let concurrent = 0;
  return {
    acquire(): (() => void) | null {
      const time = now();
      if (time - start >= windowMs) { start = time; count = 0; }
      if (count >= maxRequests || concurrent >= maxConcurrent) return null;
      count++; concurrent++;
      let released = false;
      return () => { if (!released) { concurrent--; released = true; } };
    },
  };
}

// DECISÃO: limite local para proteger este processo. Múltiplas réplicas precisam
// também de limite agregado no proxy de publicação (B-103), não de IPs confiados.
export const agentBudget = createAgentBudget();

export function withAgentHeaders(response: Response, request: Request, config: AgentConfig): Response {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  const requestOrigin = request.headers.get('origin');
  if (requestOrigin && (requestOrigin === config.baseUrl || config.allowedOrigins.includes(requestOrigin))) {
    response.headers.set('Access-Control-Allow-Origin', requestOrigin);
    response.headers.set('Vary', 'Origin');
    response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, MCP-Protocol-Version');
  }
  return response;
}
