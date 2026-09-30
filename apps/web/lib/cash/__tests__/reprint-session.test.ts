import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { reprintCashSession, reprintSessionErrorMessage } from '../reprint-session';

describe('reprintCashSession', () => {
  it('chama a RPC com o turno e uma chave por toque', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { duplicate: false }, error: null });
    const res = await reprintCashSession({ rpc } as unknown as SupabaseClient, 'turno-1', 'chave-1');
    expect(res).toEqual({ ok: true, duplicate: false });
    expect(rpc).toHaveBeenCalledWith('reprint_cash_session', { p_session_id: 'turno-1', p_request_id: 'chave-1' });
  });

  it('sem chave dada, gera uma nova em cada toque', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    await reprintCashSession({ rpc } as unknown as SupabaseClient, 'turno-1');
    await reprintCashSession({ rpc } as unknown as SupabaseClient, 'turno-1');
    expect(rpc.mock.calls[0][1].p_request_id).not.toBe(rpc.mock.calls[1][1].p_request_id);
  });

  it('o mesmo toque repetido volta como duplicado, sem mais papel', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { duplicate: true }, error: null });
    const res = await reprintCashSession({ rpc } as unknown as SupabaseClient, 'turno-1', 'k');
    expect(res).toEqual({ ok: true, duplicate: true });
  });

  it('erro do servidor vira mensagem para a equipa', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'cash_access_denied' } });
    const res = await reprintCashSession({ rpc } as unknown as SupabaseClient, 'turno-1', 'k');
    expect(res).toEqual({ ok: false, message: expect.stringContaining('gerente') });
  });
});

describe('reprintSessionErrorMessage', () => {
  it('outra loja', () => {
    expect(reprintSessionErrorMessage('session_not_found')).toContain('não é desta loja');
  });
  it('turno ainda aberto', () => {
    expect(reprintSessionErrorMessage('session_still_open')).toContain('ainda está aberto');
  });
  it('turno sem relatório legível', () => {
    expect(reprintSessionErrorMessage('session_report_unreadable')).toContain('suporte');
  });
  it('base sem a 1108, sem mostrar código', () => {
    const msg = reprintSessionErrorMessage('Could not find the function public.reprint_cash_session(p_request_id, p_session_id) in the schema cache');
    expect(msg).toContain('suporte');
    expect(msg).not.toContain('reprint_cash_session');
  });
  it('sem rede', () => {
    expect(reprintSessionErrorMessage('TypeError: Failed to fetch')).toContain('Sem ligação');
  });
});
