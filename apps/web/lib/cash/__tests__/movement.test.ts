import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { addCashMovement, movementRequestKeeper } from '../movement';

describe('movementRequestKeeper — a mesma sangria repetida leva a mesma chave', () => {
  it('repetir o mesmo movimento reutiliza a chave', () => {
    const k = movementRequestKeeper();
    const a = k.idFor('sangria', 2000, 'banco');
    expect(k.idFor('sangria', 2000, ' banco ')).toBe(a);
  });
  it('mudar tipo, valor ou motivo gera chave nova', () => {
    const k = movementRequestKeeper();
    const a = k.idFor('sangria', 2000, 'banco');
    expect(k.idFor('sangria', 2500, 'banco')).not.toBe(a);
    const b = k.idFor('despesa', 2500, 'banco');
    expect(k.idFor('despesa', 2500, 'gelo')).not.toBe(b);
  });
  it('depois de gravar, o movimento seguinte igual é outro', () => {
    const k = movementRequestKeeper();
    const a = k.idFor('sangria', 2000, 'banco');
    k.done();
    expect(k.idFor('sangria', 2000, 'banco')).not.toBe(a);
  });
});

describe('addCashMovement', () => {
  const input = { store: 's', type: 'sangria', amountCents: 2000, reason: ' banco ', requestId: 'r-1' };

  it('manda a chave ao servidor', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'mov', error: null });
    await addCashMovement({ rpc } as unknown as SupabaseClient, input);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('add_cash_movement', {
      p_store: 's', p_type: 'sangria', p_amount_cents: 2000, p_reason: 'banco', p_request_id: 'r-1',
    });
  });

  it('base sem a 1098: grava sem a chave em vez de falhar', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.add_cash_movement' } })
      .mockResolvedValueOnce({ data: 'mov', error: null });
    const res = await addCashMovement({ rpc } as unknown as SupabaseClient, input);
    expect(res.data).toBe('mov');
    expect(rpc.mock.calls[1][1]).not.toHaveProperty('p_request_id');
  });

  it('outros erros não são repetidos', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'P0032', message: 'no_open_session' } });
    const res = await addCashMovement({ rpc } as unknown as SupabaseClient, input);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(res.error?.message).toBe('no_open_session');
  });
});
