// Envia UM cupom de exemplo directamente para a impressora real (sem BD).
// Uso: node src/test-print.js <IP> [porta]
//   ex.: node src/test-print.js 192.168.68.104
import { sendToPrinter } from './printer-client.js';

const ip = process.argv[2] || process.env.PRINTER_IP;
const port = parseInt(process.argv[3] || process.env.PRINTER_PORT || '9100', 10);

if (!ip) {
  console.error('Falta o IP. Uso: node src/test-print.js <IP> [porta]');
  process.exit(1);
}

// Exemplo com acentos PT para validar a codepage (ã õ ç é à).
const order = {
  order_number: 1,
  created_at: new Date().toISOString(),
  customer_name: 'João Conceição',
  customer_phone: '+258 84 123 4567',
  fulfillment: 'delivery',
  delivery_zone: 'Sommerschield',
  delivery_address: 'Av. Julius Nyerere, 100 — perto da farmácia',
  slot_date: new Date().toISOString().slice(0, 10),
  slot_window: 'Agora',
  payment_method: 'mpesa',
  subtotal_mt: 950,
  delivery_fee_mt: 150,
  total_mt: 1100,
  customer_notes: 'Sem cebola, por favor. Põe o pão bem tostado. Obrigação!',
  order_items: [
    { qty: 2, product_name: 'Double Smash (HAW)', line_total_mt: 800 },
    { qty: 1, product_name: "Joe's Chips", line_total_mt: 150 },
  ],
};

console.log(`A enviar cupom de teste para ${ip}:${port} …`);
const ok = await sendToPrinter(ip, port, order, { attempts: 2, timeoutMs: 5000 });
console.log(ok ? '✅ Enviado! Vê se saiu o talão.' : '❌ Falhou — ver erro acima.');
process.exit(ok ? 0 : 1);
