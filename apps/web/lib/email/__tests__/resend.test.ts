import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  smtpSends: [] as unknown[],
  studioSends: [] as unknown[],
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
  sendStudioMail: async (...args: unknown[]) => {
    state.studioSends.push(args);
    return { ok: true };
  },
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

import { sendViaResend } from '../resend';
import { sendMail } from '../transport';

const ENV = ['RESEND_API_KEY', 'EMAIL_FROM', 'SMTP_USER', 'SMTP_PASS'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV) saved[key] = process.env[key];
  state.smtpSends = [];
  state.studioSends = [];
  state.logged = [];
});
afterEach(() => {
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.unstubAllGlobals();
});

function resposta(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Resend por HTTPS (ADR 0009)', () => {
  it('manda o email à API com a chave, o remetente e os destinatários', async () => {
    process.env.RESEND_API_KEY = 're_teste';
    const fetchMock = vi.fn(async () => resposta(200, { id: 'abc' }));
    const result = await sendViaResend(
      { from: 'Loja <haw@exemplo.test>', to: ['dono@exemplo.test'], subject: 'Olá', html: '<p>x</p>' },
      fetchMock as unknown as typeof fetch,
    );
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_teste');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'Loja <haw@exemplo.test>',
      to: ['dono@exemplo.test'],
      subject: 'Olá',
      html: '<p>x</p>',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('uma recusa da API volta como erro legível, sem lançar', async () => {
    process.env.RESEND_API_KEY = 're_teste';
    const fetchMock = vi.fn(async () => resposta(403, { message: 'The domain is not verified' }));
    const result = await sendViaResend(
      { from: 'haw@exemplo.test', to: ['a@exemplo.test'], subject: 's', html: 'h' },
      fetchMock as unknown as typeof fetch,
    );
    expect(result).toEqual({ ok: false, error: 'resend_403: The domain is not verified' });
  });

  it('rede em baixo ou timeout: devolve o erro, nunca lança (regra 1)', async () => {
    process.env.RESEND_API_KEY = 're_teste';
    const fetchMock = vi.fn(async () => {
      throw new Error('The operation was aborted due to timeout');
    });
    const result = await sendViaResend(
      { from: 'haw@exemplo.test', to: ['a@exemplo.test'], subject: 's', html: 'h' },
      fetchMock as unknown as typeof fetch,
    );
    expect(result).toEqual({ ok: false, error: 'The operation was aborted due to timeout' });
  });

  it('sem chave não tenta nada', async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.fn();
    const result = await sendViaResend(
      { from: 'haw@exemplo.test', to: ['a@exemplo.test'], subject: 's', html: 'h' },
      fetchMock as unknown as typeof fetch,
    );
    expect(result).toEqual({ ok: false, error: 'resend_not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('transporte: qual caminho sai', () => {
  it('com RESEND_API_KEY, sai pelo Resend com o EMAIL_FROM — nada pelo SMTP', async () => {
    process.env.RESEND_API_KEY = 're_teste';
    process.env.EMAIL_FROM = 'Loja <haw@exemplo.test>';
    process.env.SMTP_USER = 'haw@exemplo.test';
    process.env.SMTP_PASS = 'segredo';
    const fetchMock = vi.fn(async () => resposta(200, { id: 'abc' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendMail({ to: 'dono@exemplo.test', subject: 'Olá', html: '<p>x</p>' });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ from: 'Loja <haw@exemplo.test>', to: ['dono@exemplo.test'] });
    expect(state.smtpSends).toEqual([]);
    expect(state.logged.at(-1)).toEqual([undefined, 'store-a', ['dono@exemplo.test'], 'sent']);
  });

  it('com Resend mas sem remetente, falha já — o Resend recusaria', async () => {
    process.env.RESEND_API_KEY = 're_teste';
    delete process.env.EMAIL_FROM;
    delete process.env.SMTP_USER;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendMail({ to: 'dono@exemplo.test', subject: 's', html: 'h' });

    expect(result).toEqual({ ok: false, error: 'email_from_not_configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem RESEND_API_KEY, continua pelo SMTP da ADR 0004', async () => {
    delete process.env.RESEND_API_KEY;
    process.env.EMAIL_FROM = 'haw@exemplo.test';
    process.env.SMTP_USER = 'haw@exemplo.test';
    process.env.SMTP_PASS = 'segredo';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendMail({ to: 'dono@exemplo.test', subject: 's', html: 'h' });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.smtpSends).toHaveLength(1);
  });
});
