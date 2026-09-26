import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * As rotas de email do painel deixaram de ser um relay aberto: sem sessão da
 * equipa não enviam nada, e o destinatário nunca vem do corpo do pedido.
 */
const state = vi.hoisted(() => ({
  staff: vi.fn(),
  approval: vi.fn(),
  rejection: vi.fn(),
  visible: vi.fn(),
}));

vi.mock('@/lib/auth/staff-request', () => ({ staffFromRequest: state.staff }));
vi.mock('@/lib/email/order-emails', () => ({
  sendApprovalEmailForOrder: state.approval,
  sendRejectionEmailForOrder: state.rejection,
}));
vi.mock('@/lib/email/transport', () => ({ isEmailConfigured: () => true }));
vi.mock('@/lib/payments/direct', () => ({ serviceClient: () => ({ service: true }) }));

import { POST as approvalPOST } from '@/app/api/emails/send-approval-email/route';
import { POST as rejectionPOST } from '@/app/api/emails/send-rejection-email/route';

const orderId = '20000000-0000-4000-8000-000000000001';
const post = (body: unknown) => new Request('https://loja.example/api/emails/x', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

function staffClient() {
  const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle: state.visible };
  return { from: vi.fn(() => chain) };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.visible.mockResolvedValue({ data: { id: orderId }, error: null });
  state.approval.mockResolvedValue({ ok: true });
  state.rejection.mockResolvedValue({ ok: true });
  state.staff.mockResolvedValue({ ok: true, role: 'manager', user: { id: 'u' }, client: staffClient() });
});

describe('rotas de email do painel', () => {
  it('sem sessão da equipa: 401 e nada enviado', async () => {
    state.staff.mockResolvedValue({ ok: false, status: 401, error: 'Autenticação necessária.' });
    const res = await approvalPOST(post({ to: 'PLACEHOLDER_VITIMA@example.test', subject: 's', html: '<b>spam</b>', orderId }));
    expect(res.status).toBe(401);
    expect(state.approval).not.toHaveBeenCalled();
  });

  it('cozinha não dispara emails a clientes', async () => {
    state.staff.mockResolvedValue({ ok: true, role: 'kitchen', user: { id: 'u' }, client: staffClient() });
    expect((await rejectionPOST(post({ orderId, reason: 'x' }))).status).toBe(403);
    expect(state.rejection).not.toHaveBeenCalled();
  });

  it('corpo com "to" é ignorado: só o id do pedido chega ao envio', async () => {
    const res = await approvalPOST(post({ orderId, to: 'PLACEHOLDER_VITIMA@example.test' }));
    expect(res.status).toBe(200);
    expect(state.approval).toHaveBeenCalledWith({ service: true }, orderId);
  });

  it('pedido que a RLS esconde (outra loja): 404', async () => {
    state.visible.mockResolvedValue({ data: null, error: null });
    expect((await approvalPOST(post({ orderId }))).status).toBe(404);
    expect(state.approval).not.toHaveBeenCalled();
  });

  it('corpo inválido: 400', async () => {
    expect((await approvalPOST(post({ orderId: 'nao-e-uuid' }))).status).toBe(400);
    expect((await rejectionPOST(post({ orderId }))).status).toBe(400);
  });
});
