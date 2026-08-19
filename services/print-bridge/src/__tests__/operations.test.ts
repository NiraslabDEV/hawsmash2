import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  HEARTBEAT_INTERVAL_MS,
  WATCHDOG_INTERVAL_MS,
  sendBridgeHeartbeat,
  runPrintWatchdog,
  startOperationalLoops,
} from '../operations';
import type { BridgeConfig } from '../config';

const config = {
  storeId: '00000000-0000-4000-8000-000000000101',
  bridgeDeviceId: '00000000-0000-4000-8000-000000000401',
  appVersion: '2.0.0-teste',
} as BridgeConfig;

afterEach(() => vi.useRealTimers());

describe('operações do bridge', () => {
  it('envia heartbeat e watchdog com a loja e dispositivo explícitos', async () => {
    const rpc = vi.fn(async () => ({ data: { success: true }, error: null }));
    const client = { rpc } as unknown as SupabaseClient;

    await sendBridgeHeartbeat(client, config);
    await runPrintWatchdog(client, config);

    expect(rpc).toHaveBeenNthCalledWith(1, 'bridge_heartbeat', {
      p_device_id: config.bridgeDeviceId,
      p_store_id: config.storeId,
      p_app_version: config.appVersion,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'recover_stale_print_jobs', {
      p_store_id: config.storeId,
    });
  });

  it('repete ambas as operações a cada 60 segundos e permite parar', async () => {
    vi.useFakeTimers();
    const rpc = vi.fn(async () => ({ data: {}, error: null }));
    const client = { rpc } as unknown as SupabaseClient;

    const stop = startOperationalLoops(client, config);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);

    expect(HEARTBEAT_INTERVAL_MS).toBe(60_000);
    expect(WATCHDOG_INTERVAL_MS).toBe(60_000);
    expect(rpc).toHaveBeenCalledTimes(4);

    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rpc).toHaveBeenCalledTimes(4);
  });
});
