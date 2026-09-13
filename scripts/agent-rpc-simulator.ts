import { createServer } from 'node:http';
import { agentMenuFixture, agentStoresFixture } from '../apps/web/lib/agents/__tests__/fixtures';

/** Backend exclusivamente local dos testes e2e de agentes; não acede a uma BD. */
const counts: Record<string, number> = {};
createServer(async (req, res) => {
  const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3017');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey, X-Client-Info');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (pathname === '/counts') { res.end(JSON.stringify(counts)); return; }
  counts[pathname] = (counts[pathname] || 0) + 1;
  if (pathname.endsWith('/rpc/list_public_stores')) { res.end(JSON.stringify(agentStoresFixture)); return; }
  if (pathname.endsWith('/rpc/get_menu')) {
    let body = ''; for await (const chunk of req) body += chunk;
    if (JSON.parse(body).p_store_slug !== 'loja-teste') { res.writeHead(400); res.end(JSON.stringify({ message: 'store_not_found' })); return; }
    res.end(JSON.stringify(agentMenuFixture)); return;
  }
  if (pathname.endsWith('/rpc/get_brand')) { res.end('null'); return; }
  if (pathname.endsWith('/rpc/get_tracking_config') || pathname.endsWith('/settings')) { res.end('{}'); return; }
  res.writeHead(403); res.end(JSON.stringify({ error: 'Simulador só permite consultas públicas.' }));
}).listen(3018, '127.0.0.1', () => process.stdout.write('Simulador RPC local em 3018; sem base de dados e sem pagamentos.\n'));
