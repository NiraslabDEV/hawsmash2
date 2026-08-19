// Servidor TCP que simula uma impressora ESC/POS (testes sem hardware).
// Recebe os bytes, descodifica o cupom e mostra-o na consola.
import { Server } from 'node:net';
import { decodeReceipt } from './escpos.js';

export function startSimulator(port) {
  const server = new Server((socket) => {
    let received = Buffer.alloc(0);
    socket.on('data', (d) => { received = Buffer.concat([received, d]); });
    socket.on('end', () => {
      console.log('\n========== CUPOM (simulador) ==========');
      console.log(decodeReceipt(received));
      console.log('=======================================\n');
    });
    socket.on('error', (e) => console.error('[Simulador] erro de socket:', e.message));
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`[Simulador] impressora virtual a escutar em 127.0.0.1:${port}`);
  });
  return server;
}
