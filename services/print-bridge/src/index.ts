// Print-bridge service entry point — single-tenant Delivery OS
import { startPrinterSimulator, stopPrinterSimulator } from './simulator';
import { pollPrintJobs } from './polling';
import dotenv from 'dotenv';

dotenv.config();

const USE_SIMULATOR = process.env.USE_SIMULATOR === 'true';
const SIMULATOR_PORT = parseInt(process.env.SIMULATOR_PORT ?? '9100', 10);
const SIMULATOR_VERBOSE = process.env.SIMULATOR_VERBOSE === 'true';

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('DELIVERY OS — Print Bridge Service');
  console.log('='.repeat(60));

  if (USE_SIMULATOR) {
    console.log('\n[Mode] Printer Simulator Enabled');
    console.log(`[Config] Port: ${SIMULATOR_PORT}, Verbose: ${SIMULATOR_VERBOSE}\n`);

    const simulator = startPrinterSimulator({ port: SIMULATOR_PORT, verbose: SIMULATOR_VERBOSE });
    await new Promise(resolve => setTimeout(resolve, 1000));
    await pollPrintJobs();

    process.on('SIGINT', async () => {
      console.log('\n[Shutdown] Received SIGINT');
      stopPrinterSimulator(simulator);
      process.exit(0);
    });
  } else {
    console.log('\n[Mode] Production Mode (Real Printer)');
    console.log(`[Config] Supabase URL: ${process.env.SUPABASE_URL}`);
    console.log(`[Config] Printer IP: ${process.env.PRINTER_IP}:${process.env.PRINTER_PORT ?? 9100}\n`);
    await pollPrintJobs();
  }
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
