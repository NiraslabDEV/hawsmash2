import { createServer } from 'node:http';

// Exclusivamente dados fictícios em loopback. O teste atravessa o route handler
// Next real e o cliente supabase-js; nunca liga a Auth/BD de uma instalação.
const payment = {
  store_name: 'PLACEHOLDER_LOJA', sale_date: '2026-09-24', sale_time: '14:00', order_number: 'TESTE-CSV-001',
  daily_number: 1, channel: 'counter', order_status: 'paid', customer_name: 'PLACEHOLDER_CLIENTE', customer_phone: null,
  subtotal_cents: 43692, delivery_fee_cents: 0, order_total_cents: 43692,
  payment_method: 'cash', payment_amount_cents: 20000, payment_status: 'confirmed', payment_reference: null,
};
createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/health') { res.end('{"ok":true}'); return; }
  if (url.pathname.endsWith('/rpc/get_brand')) { res.end('null'); return; }
  if (!req.headers.authorization?.endsWith('.PLACEHOLDER_SIGNATURE')) { res.writeHead(401); res.end('{"message":"Sessão simulada necessária"}'); return; }
  if (url.pathname === '/auth/v1/user') {
    res.end(JSON.stringify({ id: '90000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated' })); return;
  }
  if (url.pathname.endsWith('/rpc/export_sales_for_accounting')) {
    let body = ''; for await (const chunk of req) body += chunk;
    const params = JSON.parse(body);
    if (params.p_store_id !== null) { res.writeHead(403); res.end('{"code":"P0403","message":"export_access_denied"}'); return; }
    const all = [payment, { ...payment, payment_method: 'mpesa', payment_amount_cents: 23692 }];
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 500);
    const data = all.slice(offset, offset + limit);
    res.setHeader('Content-Range', `${offset}-${offset + data.length - 1}/${all.length}`);
    res.end(JSON.stringify(data)); return;
  }
  res.writeHead(403); res.end('{"error":"Só consultas simuladas locais."}');
}).listen(3020, '127.0.0.1');
