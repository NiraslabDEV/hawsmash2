// Servidor TCP que simula uma impressora ESC/POS (desenvolvimento).
import { Server } from 'net';
import { decodeReceipt } from './escpos';

export interface SimulatorConfig {
  port: number;
  verbose?: boolean;
}

export function startPrinterSimulator(config: SimulatorConfig): Server {
  const server = new Server((socket) => {
    let received = Buffer.alloc(0);

    socket.on('data', (data) => {
      received = Buffer.concat([received, data]);
    });

    socket.on('end', () => {
      console.log('\n========== CUPOM (printer-sim) ==========');
      console.log(decodeReceipt(received));
      console.log('=========================================');
      if (config.verbose) {
        console.log(`[Simulator] ${received.length} bytes recebidos`);
        console.log(`[Simulator] hex: ${received.toString('hex')}`);
      }
    });

    socket.on('error', (err) => {
      console.error('[Simulator] Erro de socket:', err.message);
    });
  });

  server.listen(config.port, () => {
    console.log(`\n[Printer Simulator] Escutando na porta ${config.port}`);
    console.log('Envie bytes ESC/POS para testar sem hardware. Ctrl+C para sair.\n');
  });

  return server;
}

export function stopPrinterSimulator(server: Server): void {
  server.close(() => {
    console.log('[Printer Simulator] Parado');
  });
}
