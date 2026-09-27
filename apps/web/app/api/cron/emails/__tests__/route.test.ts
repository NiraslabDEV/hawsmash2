import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  send: vi.fn(),
  smtp: vi.fn(),
  denied: false,
}));
vi.mock('@/lib/cron/auth', () => ({
  cronUnauthorized: () =>
    state.denied ? new Response('Não autorizado', { status: 401 }) : null,
}));
vi.mock('@/lib/payments/direct', () => ({
  serviceClient: () => ({ rpc: state.rpc, from: state.from }),
}));
vi.mock('@/lib/email/studio-transport', () => ({
  studioSmtp: state.smtp,
  sendStudioMail: state.send,
}));
import { GET } from '../route';
const job = {
  id: 'job',
  store_id: 'store',
  flow_id: 'flow',
  recipient: 'recipient@example.test',
  message: {
    subject: 'Olá {{nome}}',
    preheader: '',
    delay_minutes: 0,
    blocks: [{ type: 'text', text: '{{total}}' }],
  },
  variables: { nome: 'Cliente', total_cents: 45000 },
};
let contact: {
  unsubscribe_token: string;
  unsubscribed_at: string | null;
} | null;
let flow: { kind: string; status: string };
beforeEach(() => {
  vi.clearAllMocks();
  state.denied = false;
  process.env.APP_BASE_URL = 'https://example.test';
  flow = { kind: 'marketing', status: 'active' };
  contact = { unsubscribe_token: 'token', unsubscribed_at: null };
  state.rpc.mockImplementation(async (name: string) => ({
    data: name === 'email_claim' ? [job] : null,
    error: null,
  }));
  state.from.mockImplementation((table: string) => {
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      update: vi.fn(),
      single: vi.fn(),
      maybeSingle: vi.fn(),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.update.mockReturnValue(chain);
    chain.single.mockImplementation(async () => ({ data: flow }));
    chain.maybeSingle.mockImplementation(async () => ({
      data: table === 'email_contacts' ? contact : flow,
    }));
    return chain;
  });
  state.smtp.mockResolvedValue({ from_email: 'loja@example.test' });
  state.send.mockResolvedValue({ ok: true });
});
describe('worker de emails', () => {
  it('recusa chamada sem segredo antes de ler a fila', async () => {
    state.denied = true;
    expect(
      (await GET(new Request('https://example.test/api/cron/emails'))).status,
    ).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('envia snapshot com valores do servidor e cancelamento de subscrição', async () => {
    const response = await GET(
      new Request('https://example.test/api/cron/emails'),
    );
    expect(await response.json()).toMatchObject({ sent: 1, failed: 0 });
    expect(state.send.mock.calls[0][1].html).toContain('450 MT');
    expect(state.send.mock.calls[0][1].unsubscribeUrl).toContain(
      '/email/subscricao?t=token',
    );
    expect(state.rpc).toHaveBeenCalledWith('email_finish', {
      p_id: 'job',
      p_ok: true,
      p_error: null,
    });
  });
  it.each(['unsubscribed', 'missing', 'paused'])(
    'revê consentimento e estado após claim: %s',
    async (status) => {
      if (status === 'missing') contact = null;
      if (status === 'unsubscribed')
        contact!.unsubscribed_at = new Date().toISOString();
      if (status === 'paused') flow.status = 'paused';
      await GET(new Request('https://example.test/api/cron/emails'));
      expect(state.send).not.toHaveBeenCalled();
    },
  );
  it('não declara enviado nem reenvia quando a confirmação de persistência falha', async () => {
    state.rpc.mockImplementation(async (name: string) => ({
      data: name === 'email_claim' ? [job] : null,
      error: name === 'email_finish' ? { message: 'offline' } : null,
    }));
    const response = await GET(
      new Request('https://example.test/api/cron/emails'),
    );
    expect(response.status).toBe(502);
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({ sent: 0, failed: 1 });
  });
});
