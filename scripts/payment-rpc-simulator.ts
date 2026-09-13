import { createServer } from 'node:http';
import { agentMenuFixture } from '../apps/web/lib/agents/__tests__/fixtures';

// Marca e menu sintéticos para pré-carregamentos do site; os testes escolhem a
// configuração exacta no contexto do navegador e interceptam todos os envios.
createServer((req, res) => {
  const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
  res.setHeader('Content-Type', 'application/json');
  if (pathname === '/health') { res.end('{"ok":true}'); return; }
  if (pathname.endsWith('/rpc/get_brand')) { res.end('null'); return; }
  if (pathname.endsWith('/rpc/get_menu')) {
    res.end(JSON.stringify({ ...agentMenuFixture, payment_provider: 'mpesa', emola_provider: 'paysuite' }));
    return;
  }
  res.writeHead(403);
  res.end('{"error":"Só consultas simuladas locais."}');
}).listen(3032, '127.0.0.1');
