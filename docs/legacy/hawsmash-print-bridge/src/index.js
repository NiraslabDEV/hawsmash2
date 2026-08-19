// HAWSMASH print-bridge — serviço local 24/7 que imprime cupons de cozinha
// quando um pedido é aprovado (status='paid'). Ver README.md.
import { config } from './config.js';
import { startSimulator } from './simulator.js';
import { startPolling } from './polling.js';

console.log('='.repeat(48));
console.log('  HAWSMASH · Print-Bridge (cozinha)');
console.log('='.repeat(48));

function validate() {
  if (!config.serviceKey) {
    console.error('\n❌ Falta SUPABASE_SERVICE_ROLE_KEY no .env');
    process.exit(1);
  }
}

validate();

if (config.useSimulator) {
  console.log('[Modo] SIMULADOR (sem hardware) — cupons mostrados na consola\n');
  startSimulator(config.simulatorPort);
} else if (config.printerIp) {
  console.log(`[Modo] PRODUÇÃO — impressora ${config.printerIp}:${config.printerPort} (ou a do admin se definida)\n`);
} else {
  console.log('[Modo] PRODUÇÃO — IP da impressora vem do admin (Definições → Impressora)\n');
}

startPolling();

process.on('unhandledRejection', (e) => console.error('[Fatal] unhandledRejection:', e));
process.on('uncaughtException', (e) => console.error('[Fatal] uncaughtException:', e));
process.on('SIGINT', () => { console.log('\n[Shutdown] adeus.'); process.exit(0); });
