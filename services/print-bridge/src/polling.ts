// Polling de print_jobs no Supabase → impressão — single-tenant (sem tenant_id/printers table).
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { sendToPrinter } from './printer-client';
import type { PrintJob } from './types';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PRINTER_IP = process.env.PRINTER_IP!;
const PRINTER_PORT = parseInt(process.env.PRINTER_PORT ?? '9100', 10);
const POLL_INTERVAL = 3000;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('Faltam SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente');
}
if (!PRINTER_IP) {
  throw new Error('Falta PRINTER_IP nas variáveis de ambiente');
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export async function pollPrintJobs(): Promise<void> {
  console.log('[Poller] Iniciando poller de print jobs (3s)...');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await processQueuedJobs();
    } catch (error) {
      console.error('[Poller] Erro no ciclo:', error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

async function processQueuedJobs(): Promise<void> {
  const { data: jobs, error } = await supabase
    .from('print_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(10);

  if (error) {
    console.error('[Poller] Erro ao buscar jobs:', error);
    return;
  }
  if (!jobs || jobs.length === 0) return;

  console.log(`[Poller] ${jobs.length} job(s) na fila`);
  for (const job of jobs) {
    await processJob(job as PrintJob);
  }
}

async function processJob(job: PrintJob): Promise<void> {
  console.log(`[Poller] Job ${job.id} (pedido ${job.order_id})`);

  const { error: updateError } = await supabase
    .from('print_jobs')
    .update({ status: 'printing', attempts: job.attempts + 1 })
    .eq('id', job.id);
  if (updateError) {
    console.error('[Poller] Erro ao marcar printing:', updateError);
    return;
  }

  console.log(`[Poller] Enviando para ${PRINTER_IP}:${PRINTER_PORT}`);
  const success = await sendToPrinter(PRINTER_IP, PRINTER_PORT, job.payload, job.id);

  if (success) {
    const { error: printError } = await supabase
      .from('print_jobs')
      .update({ status: 'printed', printed_at: new Date().toISOString() })
      .eq('id', job.id);
    if (printError) {
      console.error('[Poller] Erro ao marcar printed:', printError);
      return;
    }
    console.log(`[Poller] Job ${job.id} impresso`);
    await logEvent(job, 'print_job_printed', { job_id: job.id });
  } else {
    await markJobFailed(job, 'printer_connection_failed');
  }
}

async function markJobFailed(job: PrintJob, reason: string): Promise<void> {
  console.error(`[Poller] Job ${job.id} → failed: ${reason}`);
  const { error } = await supabase.from('print_jobs').update({ status: 'failed' }).eq('id', job.id);
  if (error) console.error('[Poller] Erro ao marcar failed:', error);
  await logEvent(job, 'print_job_failed', { job_id: job.id, reason });
}

async function logEvent(
  job: PrintJob,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('event_log').insert({
    order_id: job.order_id,
    type,
    payload: { ...payload, timestamp: new Date().toISOString() },
  });
  if (error) console.error('[Poller] Erro ao gravar event_log:', error);
}
