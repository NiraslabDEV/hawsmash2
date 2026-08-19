import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { claimPrintJob, fetchQueuedJobs } from '../repository';

describe('consulta da fila por loja', () => {
  it('filtra sempre status e STORE_ID antes do limite', async () => {
    const calls: Array<[string, unknown]> = [];
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => {
        calls.push([column, value]);
        return chain;
      }),
      order: vi.fn(() => chain),
      limit: vi.fn(async () => ({ data: [], error: null })),
    };
    const client = {
      from: vi.fn((table: string) => {
        expect(table).toBe('print_jobs');
        return chain;
      }),
    } as unknown as SupabaseClient;

    await fetchQueuedJobs(client, '00000000-0000-4000-8000-000000000101');

    expect(calls).toEqual([
      ['store_id', '00000000-0000-4000-8000-000000000101'],
      ['status', 'queued'],
    ]);
    expect(chain.select).toHaveBeenCalledWith(
      'id,store_id,order_id,request_id,station,kind,reprint_seq,payload,status,attempts,created_at,printed_at',
    );
  });
});

describe('reserva atómica do papel', () => {
  it('só reserva um job ainda queued da própria loja', async () => {
    const calls: Array<[string, unknown]> = [];
    const chain = {
      update: vi.fn(() => chain),
      eq: vi.fn((column: string, value: unknown) => {
        calls.push([column, value]);
        return chain;
      }),
      select: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: { id: 'job-1' }, error: null })),
    };
    const client = { from: vi.fn(() => chain) } as unknown as SupabaseClient;

    const claimed = await claimPrintJob(client, {
      jobId: 'job-1',
      storeId: 'loja-1',
      attempts: 2,
    });

    expect(claimed).toBe(true);
    expect(calls).toEqual([
      ['id', 'job-1'],
      ['store_id', 'loja-1'],
      ['status', 'queued'],
    ]);
    expect(chain.update).toHaveBeenCalledWith({ status: 'printing', attempts: 3 });
  });
});
