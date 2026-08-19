// Servidor TCP que simula uma impressora ESC/POS (desenvolvimento).
import { Server } from 'net';
import { decodeReceipt } from './escpos';

export interface SimulatorConfig {
  port: number;
  verbose?: boolean;
  silent?: boolean;
  onDocument?: (document: Buffer) => void;
}

export function startPrinterSimulator(config: SimulatorConfig): Server {
  const server = new Server((socket) => {
    let received = Buffer.alloc(0);

    socket.on('data', (data) => {
      received = Buffer.concat([received, data]);
    });

    socket.on('end', () => {
      config.onDocument?.(Buffer.from(received));
      if (!config.silent) {
        console.log('\n========== CUPOM (printer-sim) ==========');
        console.log(decodeReceipt(received));
        console.log('=========================================');
      }
      if (config.verbose && !config.silent) {
        console.log(`[Simulator] ${received.length} bytes recebidos`);
        console.log(`[Simulator] hex: ${received.toString('hex')}`);
      }
    });

    socket.on('error', (err) => {
      console.error('[Simulator] Erro de socket:', err.message);
    });
  });

  server.listen(config.port, () => {
    if (!config.silent) {
      const address = server.address();
      const port = address && typeof address !== 'string' ? address.port : config.port;
      console.log(`\n[Printer Simulator] Escutando na porta ${port}`);
      console.log('Envie bytes ESC/POS para testar sem hardware. Ctrl+C para sair.\n');
    }
  });

  return server;
}

export function stopPrinterSimulator(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
