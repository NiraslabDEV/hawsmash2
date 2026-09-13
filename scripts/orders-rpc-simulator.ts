import { createServer } from 'node:http';

// Só a marca pública do layout no teste local. RPCs do painel são interceptadas
// por contexto Playwright; nenhuma sessão ou base de dados real é utilizada.
createServer((req, res) => {
  const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
  res.setHeader('Content-Type', 'application/json');
  if (pathname === '/health') { res.end('{"ok":true}'); return; }
  if (pathname.endsWith('/rpc/get_brand')) { res.end('null'); return; }
  res.writeHead(403);
  res.end('{"error":"Só consultas simuladas locais."}');
}).listen(3020, '127.0.0.1');
