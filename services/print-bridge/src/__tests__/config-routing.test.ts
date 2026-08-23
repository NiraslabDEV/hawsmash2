import { describe, expect, it } from 'vitest';
import { loadBridgeConfig } from '../config';
import { resolvePrinter } from '../printer-routing';
import type { PrintJob } from '../types';

const validEnv = {
  SUPABASE_URL: 'https://staging.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'segredo-de-teste',
  STORE_ID: '00000000-0000-4000-8000-000000000101',
  BRIDGE_DEVICE_ID: '00000000-0000-4000-8000-000000000401',
  PRINTER_IP_KITCHEN: '192.168.10.50',
  PRINTER_IP_COUNTER: '192.168.10.51',
  PRINTER_PORT: '9100',
  LOCAL_TOKEN: 'token-local-de-teste-com-32-caracteres',
  LOCAL_ALLOWED_ORIGINS: 'https://staging.hawsmash.test',
};

const baseJob: PrintJob = {
  id: '00000000-0000-4000-8000-000000000201',
  store_id: validEnv.STORE_ID,
  order_id: '00000000-0000-4000-8000-000000000301',
  request_id: null,
  station: 'kitchen',
  kind: 'order',
  reprint_seq: 0,
  payload: { test: true },
  status: 'queued',
  attempts: 0,
  claimed_at: null,
  created_at: '2026-08-19T12:00:00.000Z',
  printed_at: null,
};

describe('configuração multi-loja do print-bridge', () => {
  it('exige uma loja e as duas impressoras', () => {
    expect(() => loadBridgeConfig({ ...validEnv, STORE_ID: '' })).toThrow('STORE_ID');
    expect(() => loadBridgeConfig({ ...validEnv, PRINTER_IP_KITCHEN: '' })).toThrow(
      'PRINTER_IP_KITCHEN',
    );
    expect(() => loadBridgeConfig({ ...validEnv, PRINTER_IP_COUNTER: '' })).toThrow(
      'PRINTER_IP_COUNTER',
    );
  });

  it('carrega os endpoints da cozinha e do balcão sem expor a chave', () => {
    const config = loadBridgeConfig(validEnv);

    expect(config.storeId).toBe(validEnv.STORE_ID);
    expect(config.bridgeDeviceId).toBe(validEnv.BRIDGE_DEVICE_ID);
    expect(config.printers).toEqual({
      kitchen: { kind: 'tcp', ip: '192.168.10.50', port: 9100 },
      counter: { kind: 'tcp', ip: '192.168.10.51', port: 9100 },
    });
    expect(config.localAllowedOrigins).toEqual(['https://staging.hawsmash.test']);
  });
});

describe('routing das duas impressoras', () => {
  const config = loadBridgeConfig(validEnv);

  it('manda a comanda para a cozinha', () => {
    expect(resolvePrinter(baseJob, config)).toEqual(config.printers.kitchen);
  });

  it.each(['receipt', 'drawer', 'cash_close', 'test'] as const)(
    'manda %s para a impressora do balcão',
    (kind) => {
      expect(resolvePrinter({ ...baseJob, kind, station: 'counter' }, config)).toEqual(
        config.printers.counter,
      );
    },
  );
});
