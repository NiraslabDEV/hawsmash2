import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const state = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('../transport', () => ({ sendMail: state.sendMail, isEmailConfigured: () => true }));

import {
  approvalEmail, escapeHtml, ownerProofEmail, rejectionEmail,
  sendApprovalEmailForOrder, sendRejectionEmailForOrder,
} from '../order-emails';

const orderId = '20000000-0000-4000-8000-000000000001';

function svcWith(order: Record<string, unknown> | null) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => ({ data: order, error: null })),
  };
  return { from: vi.fn(() => chain), chain } as unknown as SupabaseClient & { chain: typeof chain };
}

const base = {
  status: 'approved',
  customer_email: 'PLACEHOLDER_CLIENTE@example.test',
  customer_name: 'PLACEHOLDER_CLIENTE',
  order_number: 'MPT-0042',
  total_cents: 45000,
  payment_method: 'mpesa',
  stores: { name: 'PLACEHOLDER_LOJA', phone: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  state.sendMail.mockResolvedValue({ ok: true });
});

describe('conteúdo dos emails de pedido', () => {
  it('escapa HTML vindo da BD ou do motivo', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>&"\'')).toBe('&lt;img src=x onerror=alert(1)&gt;&amp;&quot;&#39;');
    const { html } = rejectionEmail({
      customerName: '<b>PLACEHOLDER</b>', orderNumber: 'MPT-1', totalCents: 100, paymentMethod: 'mpesa',
      reason: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>PLACEHOLDER</b>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('valor em MT pelo formatMT, nunca "MTn" do Intl', () => {
    const { html } = approvalEmail({ customerName: 'X', orderNumber: 'MPT-1', totalCents: 45000, paymentMethod: 'mpesa' });
    expect(html).toContain('450 MT');
    expect(html).not.toMatch(/MTn|MZN/);
    const owner = ownerProofEmail({
      customerName: 'X', orderNumber: 'MPT-1', totalCents: 12050, paymentMethod: 'emola', fulfillmentType: 'delivery',
    });
    expect(owner.html).toMatch(/120,50 MT/);
    expect(owner.html).toContain('Entrega');
  });
});

describe('envio: destinatário sai do pedido gravado', () => {
  it('pausar uma sequência também suspende a confirmação antiga', async () => {
    const svc = { from: vi.fn((table: string) => {
      const chain = {
        select: vi.fn(() => chain), eq: vi.fn(() => chain), limit: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => ({ data: table === 'orders' ? { ...base, store_id: 'store' } : table === 'email_flows' ? { id: 'paused-flow' } : null, error: null })),
      };
      return chain;
    }) } as unknown as SupabaseClient;
    expect(await sendApprovalEmailForOrder(svc, orderId)).toEqual({ ok: true });
    expect(state.sendMail).not.toHaveBeenCalled();
  });
  it('não duplica um email já entregue à sequência configurada', async () => {
    const chain = { select: vi.fn(), eq: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn() };
    chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain); chain.limit.mockReturnValue(chain);
    chain.maybeSingle.mockResolvedValue({ data: { id: 'job' }, error: null });
    const svc = svcWith({ ...base, store_id: '00000000-0000-4000-8000-000000000101' });
    const original = svc.from.bind(svc);
    vi.spyOn(svc, 'from').mockImplementation((table: string) => (table === 'email_jobs' ? chain : original(table)) as ReturnType<SupabaseClient['from']>);
    expect(await sendApprovalEmailForOrder(svc, orderId)).toEqual({ ok: true });
    expect(state.sendMail).not.toHaveBeenCalled();
  });
  it('aprovação vai para o customer_email do pedido', async () => {
    const svc = svcWith(base);
    expect(await sendApprovalEmailForOrder(svc, orderId)).toEqual({ ok: true });
    expect(state.sendMail).toHaveBeenCalledTimes(1);
    expect(state.sendMail.mock.calls[0][0].to).toBe('PLACEHOLDER_CLIENTE@example.test');
    expect(svc.chain.eq).toHaveBeenCalledWith('id', orderId);
  });

  it.each(['awaiting_approval', 'awaiting_payment', 'cancelled', 'payment_failed'])(
    'aprovação não sai com o pedido em %s', async (status) => {
      expect(await sendApprovalEmailForOrder(svcWith({ ...base, status }), orderId)).toEqual({ ok: false, error: 'invalid_state' });
      expect(state.sendMail).not.toHaveBeenCalled();
    },
  );

  it('recusa só sai de pedido cancelado', async () => {
    expect(await sendRejectionEmailForOrder(svcWith(base), orderId, 'motivo')).toEqual({ ok: false, error: 'invalid_state' });
    expect(await sendRejectionEmailForOrder(svcWith({ ...base, status: 'cancelled' }), orderId, 'motivo')).toEqual({ ok: true });
    expect(state.sendMail).toHaveBeenCalledTimes(1);
  });

  it('pedido sem email ou inexistente não envia nada', async () => {
    expect(await sendApprovalEmailForOrder(svcWith({ ...base, customer_email: null }), orderId)).toEqual({ ok: false, error: 'no_recipient' });
    expect(await sendApprovalEmailForOrder(svcWith(null), orderId)).toEqual({ ok: false, error: 'order_not_found' });
    expect(state.sendMail).not.toHaveBeenCalled();
  });
});
