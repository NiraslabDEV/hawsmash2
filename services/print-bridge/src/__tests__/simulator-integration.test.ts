import { once } from 'node:events';

import { afterEach, describe, expect, it } from 'vitest';

import { decodeReceipt } from '../escpos';
import { sendToPrinter } from '../printer-client';
import { startPrinterSimulator, stopPrinterSimulator } from '../simulator';
import type { CustomerReceiptPayload, KitchenTicketPayload } from '../types';

const servers: ReturnType<typeof startPrinterSimulator>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => stopPrinterSimulator(server)));
});

describe('integração ESC/POS com o simulador TCP', () => {
  it('entrega ao simulador a comanda e o talão completos', async () => {
    const received: Buffer[] = [];
    const nextDocument = () =>
      new Promise<Buffer>((resolve) => {
        const server = startPrinterSimulator({
          port: 0,
          silent: true,
          onDocument(document) {
            received.push(document);
            resolve(document);
          },
        });
        servers.push(server);
      });

    const kitchen: KitchenTicketPayload = {
      template: 'kitchen',
      store_short_name: 'Matola',
      order_number: 'MAT-0017',
      daily_number: 17,
      channel: 'counter',
      customer_name: 'Balcão',
      items: [{ name: 'Double Smash', quantity: 1, notes: 'Sem pickles' }],
      notes: null,
      created_at: '2026-08-19T17:30:00.000Z',
    };
    const receipt: CustomerReceiptPayload = {
      template: 'receipt',
      store_short_name: 'Matola',
      store_address: 'Matola',
      store_phone: '86 076 0009',
      receipt_footer: 'Obrigado!',
      order_number: 'MAT-0017',
      daily_number: 17,
      customer_name: 'Balcão',
      items: [{ name: 'Double Smash', quantity: 1, unit_price_cents: 45000, line_total_cents: 45000 }],
      subtotal_cents: 45000,
      delivery_fee_cents: 0,
      total_cents: 45000,
      payments: [{ method: 'cash', amount_cents: 45000 }],
      cash_received_cents: 50000,
      change_cents: 5000,
      created_at: '2026-08-19T17:30:00.000Z',
    };

    const firstDocument = nextDocument();
    const firstServer = servers.at(-1)!;
    await once(firstServer, 'listening');
    const firstAddress = firstServer.address();
    if (!firstAddress || typeof firstAddress === 'string') throw new Error('Simulador sem porta TCP');
    expect(await sendToPrinter('127.0.0.1', firstAddress.port, kitchen, 'job-order', 'order')).toBe(true);
    expect(decodeReceipt(await firstDocument)).toContain('Nº 17');

    const secondDocument = nextDocument();
    const secondServer = servers.at(-1)!;
    await once(secondServer, 'listening');
    const secondAddress = secondServer.address();
    if (!secondAddress || typeof secondAddress === 'string') throw new Error('Simulador sem porta TCP');
    expect(await sendToPrinter('127.0.0.1', secondAddress.port, receipt, 'job-receipt', 'receipt')).toBe(true);
    expect(decodeReceipt(await secondDocument)).toContain('TOTAL 450 MT');
    expect(received).toHaveLength(2);
  });
});
