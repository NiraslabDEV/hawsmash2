import type { SupabaseClient } from '@supabase/supabase-js';
import type { PrintJob } from './types';

export const PRINT_JOB_COLUMNS =
  'id,store_id,order_id,request_id,station,kind,reprint_seq,payload,status,attempts,claimed_at,created_at,printed_at';

export async function fetchQueuedJobs(
  client: SupabaseClient,
  storeId: string,
): Promise<{ jobs: PrintJob[]; error: unknown }> {
  const { data, error } = await client
    .from('print_jobs')
    .select(PRINT_JOB_COLUMNS)
    .eq('store_id', storeId)
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(10);

  return { jobs: (data ?? []) as PrintJob[], error };
}

export async function claimPrintJob(
  client: SupabaseClient,
  input: { jobId: string; storeId: string; attempts: number },
): Promise<boolean> {
  const { data, error } = await client
    .from('print_jobs')
    .update({
      status: 'printing',
      attempts: input.attempts + 1,
      claimed_at: new Date().toISOString(),
    })
    .eq('id', input.jobId)
    .eq('store_id', input.storeId)
    .eq('status', 'queued')
    .select('id')
    .maybeSingle();

  if (error) throw error;
  return data?.id === input.jobId;
}
