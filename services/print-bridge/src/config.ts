import type { CustomerDisplayConfig } from './customer-display';
import { parsePrinterTarget, type PrinterTarget } from './printer-target';

export type PrinterEndpoint = PrinterTarget;

export interface BridgeConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
  storeId: string;
  bridgeDeviceId: string;
  appVersion: string;
  printers: {
    kitchen: PrinterEndpoint;
    counter: PrinterEndpoint;
  };
  pollIntervalMs: number;
  localHttpHost: string;
  localHttpPort: number;
  localToken: string;
  localAllowedOrigins: string[];
  localStateFile: string;
  customerDisplay: CustomerDisplayConfig;
}

type Environment = Record<string, string | undefined>;

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Falta ${name} nas variáveis de ambiente`);
  return value;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} inválido`);
  }
  return parsed;
}

/**
 * Onde imprime cada estação.
 *
 * `PRINTER_KITCHEN` / `PRINTER_COUNTER` aceitam o destino completo
 * (`windows://POS80`, `serial://COM3`, `tcp://192.168.1.50:9100`). O
 * `PRINTER_IP_*` de sempre continua a valer e continua a significar TCP — os
 * `.env` que já existem nas lojas não podem deixar de funcionar por causa disto.
 */
function resolvePrinter(
  env: Environment,
  station: 'KITCHEN' | 'COUNTER',
  defaultPort: number,
): PrinterTarget {
  const alvo = env[`PRINTER_${station}`]?.trim();
  if (alvo) {
    try {
      return parsePrinterTarget(alvo, defaultPort);
    } catch (error) {
      throw new Error(`PRINTER_${station} inválido: ${(error as Error).message}`);
    }
  }
  return { kind: 'tcp', ip: required(env, `PRINTER_IP_${station}`), port: defaultPort };
}

export function loadBridgeConfig(env: Environment): BridgeConfig {
  const storeId = required(env, 'STORE_ID');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storeId)) {
    throw new Error('STORE_ID inválido');
  }
  const bridgeDeviceId = required(env, 'BRIDGE_DEVICE_ID');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bridgeDeviceId)) {
    throw new Error('BRIDGE_DEVICE_ID inválido');
  }

  const printerPort = positiveInteger(env.PRINTER_PORT, 9100, 'PRINTER_PORT', 65_535);
  const localToken = required(env, 'LOCAL_TOKEN');
  if (localToken.length < 32) throw new Error('LOCAL_TOKEN deve ter pelo menos 32 caracteres');
  const localAllowedOrigins = required(env, 'LOCAL_ALLOWED_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of localAllowedOrigins) {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error('LOCAL_ALLOWED_ORIGINS inválido');
    }
  }
  return {
    supabaseUrl: required(env, 'SUPABASE_URL'),
    supabaseServiceKey: required(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    storeId,
    bridgeDeviceId,
    appVersion: env.BRIDGE_APP_VERSION?.trim() || '2.0.0',
    printers: {
      kitchen: resolvePrinter(env, 'KITCHEN', printerPort),
      counter: resolvePrinter(env, 'COUNTER', printerPort),
    },
    pollIntervalMs: positiveInteger(env.POLL_INTERVAL_MS, 3000, 'POLL_INTERVAL_MS'),
    localHttpHost: env.LOCAL_HTTP_HOST?.trim() || '0.0.0.0',
    localHttpPort: positiveInteger(env.LOCAL_HTTP_PORT, 7777, 'LOCAL_HTTP_PORT', 65_535),
    localToken,
    localAllowedOrigins,
    localStateFile: env.LOCAL_STATE_FILE?.trim() || './data/printed-requests.log',
    customerDisplay: loadCustomerDisplayConfig(env),
  };
}

/**
 * O visor do cliente e opcional de propriedade: um bridge sem
 * `CUSTOMER_DISPLAY_PORT` corre exactamente como antes. Nenhuma loja pode
 * deixar de imprimir porque o mostrador nao esta configurado.
 */
export function loadCustomerDisplayConfig(env: Environment): CustomerDisplayConfig {
  const protocol = (env.CUSTOMER_DISPLAY_PROTOCOL?.trim() || 'cd5220').toLowerCase();
  if (protocol !== 'cd5220' && protocol !== 'escpos') {
    throw new Error('CUSTOMER_DISPLAY_PROTOCOL invalido (cd5220 | escpos)');
  }
  const port = env.CUSTOMER_DISPLAY_PORT?.trim() ?? '';
  if (port && port !== 'sim' && !/^COM\d{1,3}$/i.test(port)) {
    throw new Error('CUSTOMER_DISPLAY_PORT invalido (COM1..COM255 | sim | vazio)');
  }
  return {
    port: port === 'sim' ? 'sim' : port.toUpperCase(),
    baud: positiveInteger(env.CUSTOMER_DISPLAY_BAUD, 9600, 'CUSTOMER_DISPLAY_BAUD', 921_600),
    columns: positiveInteger(env.CUSTOMER_DISPLAY_COLUMNS, 20, 'CUSTOMER_DISPLAY_COLUMNS', 40),
    protocol,
    idleText: env.CUSTOMER_DISPLAY_IDLE_TEXT?.trim() || 'HAWSMASH',
    idleSubtext: env.CUSTOMER_DISPLAY_IDLE_SUBTEXT?.trim() || 'BEM-VINDO',
    idleStepMs: positiveInteger(env.CUSTOMER_DISPLAY_IDLE_STEP_MS, 300, 'CUSTOMER_DISPLAY_IDLE_STEP_MS', 5_000),
    idleAfterMs: positiveInteger(env.CUSTOMER_DISPLAY_IDLE_AFTER_MS, 90_000, 'CUSTOMER_DISPLAY_IDLE_AFTER_MS'),
  };
}
