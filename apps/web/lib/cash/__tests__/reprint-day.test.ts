import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { reprintCashDay, reprintDayErrorMessage } from '../reprint-day';

describe('reprintCashDay', () => {
  it('chama a RPC com o fecho e uma chave por toque', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { duplicate: false }, error: null });
    const res = await reprintCashDay({ rpc } as unknown as SupabaseClient, 'dia-1', 'chave-1');
    expect(res).toEqual({ ok: true, duplicate: false });
    expect(rpc).toHaveBeenCalledWith('reprint_cash_day', { p_day_close_id: 'dia-1', p_request_id: 'chave-1' });
  });

  it('sem chave dada, gera uma nova em cada toque', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    await reprintCashDay({ rpc } as unknown as SupabaseClient, 'dia-1');
    await reprintCashDay({ rpc } as unknown as SupabaseClient, 'dia-1');
    expect(rpc.mock.calls[0][1].p_request_id).not.toBe(rpc.mock.calls[1][1].p_request_id);
  });

  it('erro do servidor vira mensagem para a equipa', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'cash_access_denied' } });
    const res = await reprintCashDay({ rpc } as unknown as SupabaseClient, 'dia-1', 'k');
    expect(res).toEqual({ ok: false, message: expect.stringContaining('gerente') });
  });
});

describe('reprintDayErrorMessage', () => {
  it('explica a base sem a 1100 sem mostrar código', () => {
    expect(reprintDayErrorMessage('Could not find the function public.reprint_cash_day')).toContain('suporte');
  });
  it('outra loja', () => {
    expect(reprintDayErrorMessage('day_close_not_found')).toContain('não é desta loja');
  });
});
