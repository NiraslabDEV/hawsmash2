// Print-bridge service entry point — single-tenant Delivery OS
import { startPrinterSimulator, stopPrinterSimulator } from './simulator';
import { createBridgeClient, pollPrintJobs } from './polling';
import { loadBridgeConfig } from './config';
import { createLocalServer } from './local-server';
import { FileRequestLedger } from './request-ledger';
import { sendToPrinter } from './printer-client';
import { sendDrawerPulse } from './drawer';
import { startOperationalLoops } from './operations';
import { CustomerDisplay } from './customer-display';
import { describeTarget } from './printer-target';
import { initObservability, observabilityEnabled, reportError } from './observability';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';

/**
 * O `.env` vive AO LADO do executavel, nao na pasta de onde ele foi lancado.
 *
 * `dotenv.config()` sozinho procura em `process.cwd()`. Ao duplo-clique no
 * Explorador isso costuma dar na pasta do .exe, mas nao da sempre: um atalho,
 * o Agendador de Tarefas ou um "Executar como administrador" mudam o cwd e o
 * .env deixa de ser encontrado — o bridge rebenta a dizer que falta a
 * SUPABASE_URL, com o ficheiro mesmo ali ao lado.
 *
 * `process.execPath` e o proprio .exe, por isso a pasta dele e o unico sitio
 * que nao depende de como foi lancado. Em dev (tsx) cai no cwd, como antes.
 */
function carregarEnv(): void {
  const aoLadoDoExe = path.join(path.dirname(process.execPath), '.env');
  if (fs.existsSync(aoLadoDoExe)) {
    dotenv.config({ path: aoLadoDoExe });
    return;
  }
  dotenv.config();
}

carregarEnv();

const USE_SIMULATOR = process.env.USE_SIMULATOR === 'true';
const SIMULATOR_PORT = parseInt(process.env.SIMULATOR_PORT ?? '9100', 10);
const SIMULATOR_VERBOSE = process.env.SIMULATOR_VERBOSE === 'true';

async function main(): Promise<void> {
  const loadedConfig = loadBridgeConfig(process.env);
  initObservability(loadedConfig.storeId, loadedConfig.appVersion);
  const config = USE_SIMULATOR
    ? {
        ...loadedConfig,
        printers: {
          kitchen: { kind: 'tcp' as const, ip: '127.0.0.1', port: SIMULATOR_PORT },
          counter: { kind: 'tcp' as const, ip: '127.0.0.1', port: SIMULATOR_PORT },
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
    console.log(`[Config] Cozinha: ${describeTarget(config.printers.kitchen)}`);
    console.log(`[Config] Balcão: ${describeTarget(config.printers.counter)}\n`);
  }

  const ledger = new FileRequestLedger(config.localStateFile);
  await ledger.initialize();

  // Visor do cliente. Sem `CUSTOMER_DISPLAY_PORT` fica desligado e o bridge
  // corre como sempre correu — nenhuma loja deixa de imprimir por causa disto.
  const display = new CustomerDisplay(config.customerDisplay);
  if (display.enabled) {
    console.log(
      `[Visor] ${config.customerDisplay.port} · ${config.customerDisplay.protocol} · ` +
        `${config.customerDisplay.columns} colunas`,
    );
    display.idle();
  } else {
    console.log('[Visor] desligado (sem CUSTOMER_DISPLAY_PORT) — B-018');
  }

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
        printer,
        request.payload,
        request.requestId,
        request.kind,
      );
    },
    drawer: (requestId) => sendDrawerPulse(config.printers.counter, requestId),
    ...(display.enabled
      ? {
          display: (frame) => {
            if (frame.mode === 'idle') display.idle();
            else display.show(frame.top, frame.bottom);
          },
        }
      : {}),
  });
  await new Promise<void>((resolve, reject) => {
    localServer.once('error', reject);
    localServer.listen(config.localHttpPort, config.localHttpHost, () => {
      localServer.off('error', reject);
      resolve();
    });
  });
  console.log(`[HTTP] ${config.localHttpHost}:${config.localHttpPort} pronto`);
  console.log(`[Sentry] ${observabilityEnabled() ? 'activo' : 'sem DSN (B-013)'}`);

  const supabase = createBridgeClient(config);
  const stopOperationalLoops = startOperationalLoops(supabase, config);

  process.once('SIGINT', () => {
    console.log('\n[Shutdown] A terminar print-bridge');
    display.stop();
    stopOperationalLoops();
    localServer.close(() => process.exit(0));
  });

  await pollPrintJobs(config, supabase);
}

process.on('unhandledRejection', (error) => {
  console.error('[Fatal] Unhandled rejection:', error);
  reportError(error, { phase: 'unhandledRejection' });
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('[Fatal] Uncaught exception:', error);
  reportError(error, { phase: 'uncaughtException' });
  process.exit(1);
});

/**
 * Deixar o erro no ecra quando alguem abriu o .exe por duplo-clique.
 *
 * Sem isto a janela fecha-se no instante em que o processo morre e quem esta
 * a instalar ve so "um terminal preto que abre e fecha" — sem saber que a
 * mensagem la estava. Nao ha diagnostico possivel assim.
 *
 * So espera quando ha consola interactiva (stdin de terminal). Debaixo do
 * Agendador de Tarefas nao ha TTY: nesse caso sai logo, e o watchdog reinicia
 * como sempre — um pause aqui deixaria o servico pendurado para sempre.
 */
function pararParaLerOErro(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.exit(1);
  }
  console.error('\n' + '='.repeat(60));
  console.error('O BRIDGE NAO ARRANCOU. A causa esta na mensagem acima.');
  console.error('Normalmente e uma linha do .env: falta, esta vazia, ou o');
  console.error('.env nao esta na mesma pasta que este .exe.');
  console.error('='.repeat(60));
  console.error('\nCarrega ENTER para fechar.');
  try {
    // Leitura sincrona: o processo fica aqui ate haver ENTER.
    fs.readSync(0, Buffer.alloc(1024), 0, 1024, null);
  } catch {
    // stdin fechado — nao ha nada a esperar.
  }
  process.exit(1);
}

main().catch((error) => {
  console.error('[Fatal] Service startup failed:', error);
  reportError(error, { phase: 'startup' });
  pararParaLerOErro();
});
