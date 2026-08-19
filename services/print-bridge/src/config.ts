export interface PrinterEndpoint {
  ip: string;
  port: number;
}

export interface BridgeConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
  storeId: string;
  printers: {
    kitchen: PrinterEndpoint;
    counter: PrinterEndpoint;
  };
  pollIntervalMs: number;
}

type Environment = Record<string, string | undefined>;

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Falta ${name} nas variáveis de ambiente`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error(`${name} inválido`);
  }
  return parsed;
}

export function loadBridgeConfig(env: Environment): BridgeConfig {
  const storeId = required(env, 'STORE_ID');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storeId)) {
    throw new Error('STORE_ID inválido');
  }

  const printerPort = positiveInteger(env.PRINTER_PORT, 9100, 'PRINTER_PORT');
  return {
    supabaseUrl: required(env, 'SUPABASE_URL'),
    supabaseServiceKey: required(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    storeId,
    printers: {
      kitchen: { ip: required(env, 'PRINTER_IP_KITCHEN'), port: printerPort },
      counter: { ip: required(env, 'PRINTER_IP_COUNTER'), port: printerPort },
    },
    pollIntervalMs: positiveInteger(env.POLL_INTERVAL_MS, 3000, 'POLL_INTERVAL_MS'),
  };
}
