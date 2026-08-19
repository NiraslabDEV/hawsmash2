export interface PrinterEndpoint {
  ip: string;
  port: number;
}

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
      kitchen: { ip: required(env, 'PRINTER_IP_KITCHEN'), port: printerPort },
      counter: { ip: required(env, 'PRINTER_IP_COUNTER'), port: printerPort },
    },
    pollIntervalMs: positiveInteger(env.POLL_INTERVAL_MS, 3000, 'POLL_INTERVAL_MS'),
    localHttpHost: env.LOCAL_HTTP_HOST?.trim() || '0.0.0.0',
    localHttpPort: positiveInteger(env.LOCAL_HTTP_PORT, 7777, 'LOCAL_HTTP_PORT', 65_535),
    localToken,
    localAllowedOrigins,
    localStateFile: env.LOCAL_STATE_FILE?.trim() || './data/printed-requests.log',
  };
}
