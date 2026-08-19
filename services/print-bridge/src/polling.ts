// Polling de print_jobs no Supabase, isolado pelo STORE_ID desta instalação.
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { PrintJob } from './types';
import type { BridgeConfig } from './config';
import { claimPrintJob, fetchQueuedJobs } from './repository';
import { resolvePrinter } from './printer-routing';
import { dispatchPrintJob } from './job-dispatch';

export function createBridgeClient(config: BridgeConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function pollPrintJobs(
  config: BridgeConfig,
  supabase = createBridgeClient(config),
): Promise<void> {
  console.log('[Poller] Iniciando poller de print jobs (3s)...');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await processQueuedJobs(config, supabase);
    } catch (error) {
      console.error('[Poller] Erro no ciclo:', error);
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
}

export async function processQueuedJobs(
  config: BridgeConfig,
  supabase: SupabaseClient,
): Promise<void> {
  const { jobs, error } = await fetchQueuedJobs(supabase, config.storeId);
  if (error) {
    console.error('[Poller] Erro ao buscar jobs:', error);
    return;
  }
  if (jobs.length === 0) return;

  console.log(`[Poller] ${jobs.length} job(s) na fila`);
  for (const job of jobs) {
    await processJob(config, supabase, job);
  }
}

async function processJob(
  config: BridgeConfig,
  supabase: SupabaseClient,
  job: PrintJob,
): Promise<void> {
  if (job.store_id !== config.storeId) return;
  console.log(`[Poller] Job ${job.id} (pedido ${job.order_id})`);

  let claimed = false;
  try {
    claimed = await claimPrintJob(supabase, {
      jobId: job.id,
      storeId: config.storeId,
      attempts: job.attempts,
    });
  } catch (error) {
    console.error('[Poller] Erro ao reservar job:', error);
    return;
  }
  if (!claimed) return;

  const printer = resolvePrinter(job, config);
  console.log(`[Poller] Enviando para ${printer.ip}:${printer.port}`);
  const success = await dispatchPrintJob(job, printer);

  if (success) {
    const { error: printError } = await supabase
      .from('print_jobs')
      .update({ status: 'printed', printed_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('store_id', config.storeId);
    if (printError) {
      console.error('[Poller] Erro ao marcar printed:', printError);
      return;
    }
    console.log(`[Poller] Job ${job.id} impresso`);
    await logEvent(supabase, job, 'print_job_printed', { job_id: job.id });
  } else {
    await markJobFailed(config, supabase, job, 'printer_connection_failed');
  }
}

async function markJobFailed(
  config: BridgeConfig,
  supabase: SupabaseClient,
  job: PrintJob,
  reason: string,
): Promise<void> {
  console.error(`[Poller] Job ${job.id} → failed: ${reason}`);
  const { error } = await supabase
    .from('print_jobs')
    .update({ status: 'failed' })
    .eq('id', job.id)
    .eq('store_id', config.storeId);
  if (error) console.error('[Poller] Erro ao marcar failed:', error);
  await logEvent(supabase, job, 'print_job_failed', { job_id: job.id, reason });
}

async function logEvent(
  supabase: SupabaseClient,
  job: PrintJob,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('event_log').insert({
    order_id: job.order_id,
    store_id: job.store_id,
    actor_user_id: null,
    type,
    payload: { ...payload, timestamp: new Date().toISOString() },
  });
  if (error) console.error('[Poller] Erro ao gravar event_log:', error);
}
