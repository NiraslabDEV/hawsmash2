import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  smtpSends: [] as unknown[],
  logged: [] as unknown[],
}));

vi.mock('../system-runtime', () => ({
  prepareSystemEmail: async () => ({ enabled: true, storeId: 'store-a' }),
  logSystemEmail: async (...args: unknown[]) => {
    state.logged.push(args);
  },
}));
vi.mock('../studio-transport', () => ({
  studioSmtp: async () => null,
  sendStudioMail: async () => ({ ok: true }),
}));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: unknown) => {
        state.smtpSends.push(message);
        return { accepted: ['x'] };
      },
    }),
  },
}));

import { sendViaRelay } from '../relay';
import { sendMail } from '../transport';

const ENV = [
  'EMAIL_RELAY_SECRET', 'SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL',
  'RESEND_API_KEY', 'EMAIL_FROM', 'SMTP_USER', 'SMTP_PASS',
] as const;
const saved: Record<string, string | undefined> = {};
const SEGREDO = 'x'.repeat(48);

beforeEach(() => {
  for (const key of ENV) saved[key] = process.env[key];
  for (const key of ENV) delete process.env[key];
  process.env.SUPABASE_URL = 'https://projecto.supabase.co/';
  state.smtpSends = [];
  state.logged = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function resposta(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('relé de email no Supabase (ADR 0010)', () => {
  it('chama a função com o segredo e só destinatários, assunto e html', async () => {
    process.env.EMAIL_RELAY_SECRET = SEGREDO;
    const fetchMock = vi.fn(async () => resposta(200, { ok: true }));
    const result = await sendViaRelay(
      { to: ['dono@exemplo.test'], subject: 'Olá', html: '<p>x</p>' },
      fetchMock as unknown as typeof fetch,
    );
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://projecto.supabase.co/functions/v1/email-relay');
    expect((init.headers as Record<string, string>)['x-relay-secret']).toBe(SEGREDO);
    expect(JSON.parse(init.body as string)).toEqual({
      to: ['dono@exemplo.test'], subject: 'Olá', html: '<p>x</p>',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('um 200 sem ok:true não conta como enviado', async () => {
    process.env.EMAIL_RELAY_SECRET = SEGREDO;
    const fetchMock = vi.fn(async () => resposta(200, {}));
    const result = await sendViaRelay(
      { to: ['a@exemplo.test'], subject: 's', html: 'h' },
      fetchMock as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
  });

  it('a recusa da função volta legível, sem lançar', async () => {
    process.env.EMAIL_RELAY_SECRET = SEGREDO;
    const fetchMock = vi.fn(async () => resposta(502, { ok: false, error: 'Invalid login' }));
    const result = await sendViaRelay(
      { to: ['a@exemplo.test'], subject: 's', html: 'h' },
      fetchMock as unknown as typeof fetch,
    );
    expect(result).toEqual({ ok: false, error: 'relay_502: Invalid login' });
  });
});

describe('transporte: relé primeiro, Resend de reserva', () => {
  it('com relé, sai pelo relé — o Resend não é tocado', async () => {
    process.env.EMAIL_RELAY_SECRET = SEGREDO;
    process.env.RESEND_API_KEY = 're_teste';
    process.env.EMAIL_FROM = 'haw@exemplo.test';
    const fetchMock = vi.fn(async () => resposta(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendMail({ to: 'dono@exemplo.test', subject: 's', html: 'h' });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain('/functions/v1/email-relay');
    expect(state.logged.at(-1)).toEqual([undefined, 'store-a', ['dono@exemplo.test'], 'sent']);
  });

  it('se o relé falhar, o Resend envia e o email conta como enviado', async () => {
    process.env.EMAIL_RELAY_SECRET = SEGREDO;
    process.env.RESEND_API_KEY = 're_teste';
    process.env.EMAIL_FROM = 'haw@exemplo.test';
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('email-relay')
        ? resposta(502, { ok: false, error: 'Connection timeout' })
        : resposta(200, { id: 'abc' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendMail({ to: 'dono@exemplo.test', subject: 's', html: 'h' });

    expect(result).toEqual({ ok: true });
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      'https://projecto.supabase.co/functions/v1/email-relay',
      'https://api.resend.com/emails',
    ]);
  });

  it('se os dois falharem, o erro diz porquê em ambos', async () => {
    process.env.EMAIL_RELAY_SECRET = SEGREDO;
    process.env.RESEND_API_KEY = 're_teste';
    process.env.EMAIL_FROM = 'haw@exemplo.test';
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.includes('email-relay')
        ? resposta(502, { ok: false, error: 'Connection timeout' })
        : resposta(429, { message: 'daily quota' }),
    ));

    const result = await sendMail({ to: 'dono@exemplo.test', subject: 's', html: 'h' });

    expect(result).toEqual({
      ok: false,
      error: 'relay_502: Connection timeout; resend_429: daily quota',
    });
    expect(state.logged.at(-1)).toEqual([undefined, 'store-a', ['dono@exemplo.test'], 'failed']);
  });

  it('relé a falhar sem Resend: não fica à espera do SMTP bloqueado', async () => {
    process.env.EMAIL_RELAY_SECRET = SEGREDO;
    process.env.SMTP_USER = 'haw@exemplo.test';
    process.env.SMTP_PASS = 'segredo';
    vi.stubGlobal('fetch', vi.fn(async () => resposta(502, { ok: false, error: 'x' })));

    const result = await sendMail({ to: 'dono@exemplo.test', subject: 's', html: 'h' });

    expect(result).toEqual({ ok: false, error: 'relay_502: x' });
    expect(state.smtpSends).toEqual([]);
  });
});
