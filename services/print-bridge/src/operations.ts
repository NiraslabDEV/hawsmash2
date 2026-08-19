import type { SupabaseClient } from '@supabase/supabase-js';
import type { BridgeConfig } from './config';

export const HEARTBEAT_INTERVAL_MS = 60_000;
export const WATCHDOG_INTERVAL_MS = 60_000;

export async function sendBridgeHeartbeat(
  client: SupabaseClient,
  config: BridgeConfig,
): Promise<void> {
  const { error } = await client.rpc('bridge_heartbeat', {
    p_device_id: config.bridgeDeviceId,
    p_store_id: config.storeId,
    p_app_version: config.appVersion,
  });
  if (error) throw error;
}

export async function runPrintWatchdog(
  client: SupabaseClient,
  config: BridgeConfig,
): Promise<void> {
  const { error } = await client.rpc('recover_stale_print_jobs', {
    p_store_id: config.storeId,
  });
  if (error) throw error;
}

export function startOperationalLoops(
  client: SupabaseClient,
  config: BridgeConfig,
): () => void {
  const heartbeat = () => {
    void sendBridgeHeartbeat(client, config).catch((error) => {
      console.error('[Heartbeat] Falhou:', error);
    });
  };
  const watchdog = () => {
    void runPrintWatchdog(client, config).catch((error) => {
      console.error('[Watchdog] Falhou:', error);
    });
  };

  heartbeat();
  watchdog();
  const heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
  const watchdogTimer = setInterval(watchdog, WATCHDOG_INTERVAL_MS);

  return () => {
    clearInterval(heartbeatTimer);
    clearInterval(watchdogTimer);
  };
}
