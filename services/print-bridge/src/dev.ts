// Demo self-contained do print-bridge (`pnpm bridge:dev`).
// Sobe o printer-sim, gera um pedido mock de delivery e mostra o cupom no console.
import { createConnection } from 'net';
import { startPrinterSimulator, stopPrinterSimulator } from './simulator';
import { createReceipt } from './escpos';
import type { PrintJobPayload } from './types';

const PORT = parseInt(process.env.SIMULATOR_PORT ?? '9100', 10);

const mockJob: PrintJobPayload = {
  order_number: 'ENC-0042',
  customer_name: 'Maria Fernanda',
  fulfillment_type: 'delivery',
  delivery_zone: 'Polana',
  address: 'Av. Julius Nyerere, 123, Apto 4B',
  scheduled_for: null,
  items: [
    { name: 'Frango à Zambeziana', quantity: 1, notes: 'bem passado' },
    { name: 'Caril de camarão', quantity: 2 },
    { name: 'Água 500ml', quantity: 3 },
  ],
  payment_method: 'mpesa',
  payment_status: 'paid',
  total_cents: 187500,
  notes: 'Tocar campainhas — 3º andar',
  created_at: new Date().toISOString(),
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendMock(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(createReceipt(mockJob), () => socket.end());
    });
    socket.on('close', () => resolve());
    socket.on('error', reject);
  });
}

async function main(): Promise<void> {
  console.log('='.repeat(50));
  console.log('DELIVERY OS — Print Bridge DEMO (printer-sim)');
  console.log('='.repeat(50));

  const sim = startPrinterSimulator({ port: PORT, verbose: true });
  await wait(500);

  console.log('[Demo] Enviando pedido mock para o simulador...');
  await sendMock(PORT);
  await wait(300);

  stopPrinterSimulator(sim);
}

main().catch((error) => {
  console.error('[Demo] Falhou:', error);
  process.exit(1);
});
