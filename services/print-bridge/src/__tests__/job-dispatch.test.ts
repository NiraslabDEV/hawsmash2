import { describe, expect, it, vi } from 'vitest';

import { dispatchPrintJob } from '../job-dispatch';
import type { PrintJob } from '../types';

const printer = { ip: '192.168.1.51', port: 9100 };
const baseJob: PrintJob = {
  id: '00000000-0000-4000-8000-000000000201',
  store_id: '00000000-0000-4000-8000-000000000101',
  order_id: '00000000-0000-4000-8000-000000000301',
  request_id: '00000000-0000-4000-8000-000000000201',
  station: 'counter',
  kind: 'receipt',
  reprint_seq: 0,
  payload: { test: true },
  status: 'printing',
  attempts: 1,
  created_at: '2026-08-19T12:00:00.000Z',
  printed_at: null,
};

describe('execução do job de impressão', () => {
  it('envia drawer como pulso e nunca como talão', async () => {
    const print = vi.fn(async () => true);
    const drawer = vi.fn(async () => true);
    const job = { ...baseJob, kind: 'drawer' as const };

    const result = await dispatchPrintJob(job, printer, { print, drawer });

    expect(result).toBe(true);
    expect(drawer).toHaveBeenCalledWith(printer, job.id);
    expect(print).not.toHaveBeenCalled();
  });

  it('mantém os outros jobs no caminho de impressão de papel', async () => {
    const print = vi.fn(async () => true);
    const drawer = vi.fn(async () => true);

    await dispatchPrintJob(baseJob, printer, { print, drawer });

    expect(print).toHaveBeenCalledWith(printer, 'receipt', baseJob.payload, baseJob.id);
    expect(drawer).not.toHaveBeenCalled();
  });
});
