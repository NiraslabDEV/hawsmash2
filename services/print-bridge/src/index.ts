// Print-bridge service entry point — single-tenant Delivery OS
import { startPrinterSimulator, stopPrinterSimulator } from './simulator';
import { createBridgeClient, pollPrintJobs } from './polling';
import { loadBridgeConfig } from './config';
import { createLocalServer } from './local-server';
import { FileRequestLedger } from './request-ledger';
import { sendToPrinter } from './printer-client';
import { sendDrawerPulse } from './drawer';
import { startOperationalLoops } from './operations';
import dotenv from 'dotenv';

dotenv.config();

const USE_SIMULATOR = process.env.USE_SIMULATOR === 'true';
const SIMULATOR_PORT = parseInt(process.env.SIMULATOR_PORT ?? '9100', 10);
const SIMULATOR_VERBOSE = process.env.SIMULATOR_VERBOSE === 'true';

async function main(): Promise<void> {
  const loadedConfig = loadBridgeConfig(process.env);
  const config = USE_SIMULATOR
    ? {
        ...loadedConfig,
        printers: {
          kitchen: { ip: '127.0.0.1', port: SIMULATOR_PORT },
          counter: { ip: '127.0.0.1', port: SIMULATOR_PORT },
        },
      }
    : loadedConfig;
  console.log('='.repeat(60));
  console.log('DELIVERY OS — Print Bridge Service');
  console.log('='.repeat(60));

  if (USE_SIMULATOR) {
    console.log('\n[Mode] Printer Simulator Enabled');
    console.log(`[Config] Port: ${SIMULATOR_PORT}, Verbose: ${SIMULATOR_VERBOSE}\n`);

    const simulator = startPrinterSimulator({ port: SIMULATOR_PORT, verbose: SIMULATOR_VERBOSE });
    await new Promise(resolve => setTimeout(resolve, 1000));
    process.once('SIGINT', () => stopPrinterSimulator(simulator));
  } else {
    console.log('\n[Mode] Production Mode (Real Printer)');
    console.log(`[Config] Loja: ${config.storeId}`);
    console.log(`[Config] Cozinha: ${config.printers.kitchen.ip}:${config.printers.kitchen.port}`);
    console.log(`[Config] Balcão: ${config.printers.counter.ip}:${config.printers.counter.port}\n`);
  }

  const ledger = new FileRequestLedger(config.localStateFile);
  await ledger.initialize();
  const localServer = createLocalServer({
    token: config.localToken,
    storeId: config.storeId,
    allowedOrigins: config.localAllowedOrigins,
    ledger,
    print: async (request) => {
      const printer = request.kind === 'order' && request.station !== 'counter'
        ? config.printers.kitchen
        : config.printers.counter;
      return sendToPrinter(
        printer.ip,
        printer.port,
        request.payload,
        request.requestId,
        request.kind,
      );
    },
    drawer: (requestId) => sendDrawerPulse(config.printers.counter, requestId),
  });
  await new Promise<void>((resolve, reject) => {
    localServer.once('error', reject);
    localServer.listen(config.localHttpPort, config.localHttpHost, () => {
      localServer.off('error', reject);
      resolve();
    });
  });
  console.log(`[HTTP] ${config.localHttpHost}:${config.localHttpPort} pronto`);

  const supabase = createBridgeClient(config);
  const stopOperationalLoops = startOperationalLoops(supabase, config);

  process.once('SIGINT', () => {
    console.log('\n[Shutdown] A terminar print-bridge');
    stopOperationalLoops();
    localServer.close(() => process.exit(0));
  });

  await pollPrintJobs(config, supabase);
}

process.on('unhandledRejection', (error) => {
  console.error('[Fatal] Unhandled rejection:', error);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('[Fatal] Uncaught exception:', error);
  process.exit(1);
});

main().catch((error) => {
  console.error('[Fatal] Service startup failed:', error);
  process.exit(1);
});
