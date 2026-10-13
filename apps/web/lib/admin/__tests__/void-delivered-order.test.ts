import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { voidDeliveredErrorMessage, voidDeliveredOrder, voidReasonReady } from '../void-delivered-order';

describe('voidDeliveredOrder', () => {
  it('chama a RPC com o pedido e o motivo limpo', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { duplicate: false, shift_closed: false, refunded_cents: 155000 }, error: null });
    const res = await voidDeliveredOrder({ rpc } as unknown as SupabaseClient, 'pedido-1', '  Pedido de teste  ');
    expect(rpc).toHaveBeenCalledWith('void_delivered_order', { p_order_id: 'pedido-1', p_reason: 'Pedido de teste' });
    expect(res).toEqual({ ok: true, duplicate: false, shiftClosed: false, refundedCents: 155000 });
  });

  it('diz quando o turno do pedido já fechou', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { duplicate: false, shift_closed: true, refunded_cents: 0 }, error: null });
    const res = await voidDeliveredOrder({ rpc } as unknown as SupabaseClient, 'pedido-1', 'engano');
    expect(res).toMatchObject({ ok: true, shiftClosed: true });
  });

  it('erro do servidor vira mensagem para quem está no painel', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'void_access_denied' } });
    const res = await voidDeliveredOrder({ rpc } as unknown as SupabaseClient, 'pedido-1', 'engano');
    expect(res).toEqual({ ok: false, message: 'Só o dono pode anular um pedido entregue.' });
  });
});

describe('voidDeliveredErrorMessage', () => {
  it('pedido que entretanto mudou de estado', () => {
    expect(voidDeliveredErrorMessage('order_not_delivered')).toContain('Actualiza a lista');
  });
  it('base sem a 1112, sem mostrar código', () => {
    const msg = voidDeliveredErrorMessage('Could not find the function public.void_delivered_order(p_order_id, p_reason)');
    expect(msg).toContain('suporte');
    expect(msg).not.toContain('void_delivered_order');
  });
});

describe('voidReasonReady', () => {
  it('pede um motivo a sério', () => {
    expect(voidReasonReady('  ab ')).toBe(false);
    expect(voidReasonReady('Pedido de teste')).toBe(true);
    expect(voidReasonReady('x'.repeat(501))).toBe(false);
  });
});
