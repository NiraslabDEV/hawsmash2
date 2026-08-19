// Demo offline: arranca a impressora simulada e imprime 2 cupons de exemplo
// (entrega + levantamento). NÃO toca na base de dados — só valida o formato do
// cupom e o caminho TCP. Dados FICTÍCIOS.
//
//   npm run demo
import { startSimulator } from './simulator.js';
import { sendToPrinter } from './printer-client.js';

const PORT = 9199; // porta isolada para não chocar com a real

const entrega = {
  order_number: 42,
  created_at: new Date().toISOString(),
  customer_name: 'Maria Albertina',
  customer_phone: '+258 84 123 4567',
  fulfillment: 'delivery',
  delivery_zone: 'Sommerschield',
  delivery_address: 'Av. Julius Nyerere, 100, Apt 3B, perto da farmacia',
  slot_date: '2026-06-27',
  slot_window: '14:30',
  payment_method: 'mpesa',
  subtotal_mt: 950,
  delivery_fee_mt: 150,
  total_mt: 1100,
  customer_notes: 'Sem cebola no Double Smash, por favor. Campainha avariada.',
  order_items: [
    { qty: 2, product_name: 'Double Smash (HAW)', line_total_mt: 800 },
    { qty: 1, product_name: "Joe's Chips", line_total_mt: 150 },
  ],
};

const levantamento = {
  order_number: 43,
  created_at: new Date().toISOString(),
  customer_name: 'Ridwan',
  customer_phone: '+258 86 076 0009',
  fulfillment: 'pickup',
  slot_date: '2026-06-27',
  slot_window: 'Agora',
  payment_method: 'emola',
  subtotal_mt: 600,
  delivery_fee_mt: 0,
  total_mt: 600,
  order_items: [
    { qty: 1, product_name: 'Hawsmash Signature', line_total_mt: 600 },
  ],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = startSimulator(PORT);
await sleep(400);
for (const order of [entrega, levantamento]) {
  await sendToPrinter('127.0.0.1', PORT, order);
  await sleep(300);
}
await sleep(400);
server.close();
process.exit(0);
