import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMetaTransport, fitSession, LIMITS, metaMessageBody, parseMetaWebhook } from '../index';

afterEach(() => vi.unstubAllGlobals());

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });
const config = { accessToken: 'EAAG_token', appSecret: 'app_secret', verifyToken: 'verifica-me' };
const reply = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });
const base = { senderId: '123456789012345', to: '+258841234567', idempotencyKey: 'k' };

describe('Cloud API da Meta — envio', () => {
  it('template com parâmetros com nome e botão de URL, pelo phone_number_id da loja', async () => {
    const fetch = vi.fn().mockResolvedValue(reply(200, { messages: [{ id: 'wamid.ABC' }] }));
    vi.stubGlobal('fetch', fetch);
    const t = createMetaTransport(config);
    const result = await t.send({
      ...base, template: 'hs_pedido_pago', language: 'pt_PT', variables: { nome: 'Ana', pedido: 'MPT-1' },
      components: [{ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'abc' }] }],
    });
    expect(result).toEqual({ ok: true, providerMessageId: 'wamid.ABC' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v23.0/123456789012345/messages');
    expect(init.headers).toMatchObject({ authorization: 'Bearer EAAG_token' });
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '258841234567', type: 'template',
      template: {
        name: 'hs_pedido_pago', language: { code: 'pt_PT' },
        components: [
          { type: 'body', parameters: [
            { type: 'text', parameter_name: 'nome', text: 'Ana' },
            { type: 'text', parameter_name: 'pedido', text: 'MPT-1' },
          ] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'abc' }] },
        ],
      },
    });
  });

  it('texto, botões, lista e link no formato interactivo da Meta', () => {
    expect(metaMessageBody({ ...base, type: 'text', text: 'Olá' })).toMatchObject({ type: 'text', text: { body: 'Olá', preview_url: false } });
    expect(metaMessageBody({ ...base, type: 'buttons', text: 'Escolhe', buttons: [{ id: 'a', title: 'Ver cardápio' }] })).toMatchObject({
      type: 'interactive',
      interactive: { type: 'button', body: { text: 'Escolhe' }, action: { buttons: [{ type: 'reply', reply: { id: 'a', title: 'Ver cardápio' } }] } },
    });
    expect(metaMessageBody({ ...base, type: 'list', text: 'Cardápio', button: 'Ver', sections: [{ rows: [{ id: 'i1', title: 'Smash', description: '450,00 MT' }] }] }))
      .toMatchObject({ interactive: { type: 'list', action: { button: 'Ver', sections: [{ rows: [{ id: 'i1', title: 'Smash', description: '450,00 MT' }] }] } } });
    expect(metaMessageBody({ ...base, type: 'cta_url', text: 'Acompanha', displayText: 'Abrir pedido', url: 'https://x.test/o/1' }))
      .toMatchObject({ interactive: { type: 'cta_url', action: { name: 'cta_url', parameters: { display_text: 'Abrir pedido', url: 'https://x.test/o/1' } } } });
  });

  it.each([
    [429, { error: { code: 130429, message: 'Rate limit hit' } }, true],
    [500, { error: { code: 131000, message: 'Something went wrong' } }, true],
    [400, { error: { code: 131056, message: 'Pair rate limit' } }, true],
    [401, { error: { code: 190, message: 'Token expired' } }, true],
    [400, { error: { code: 131047, message: 'Re-engagement message' } }, false],
    [400, { error: { code: 132001, message: 'Template name does not exist', error_data: { details: 'hs_x' } } }, false],
    [400, { error: { code: 131026, message: 'Message undeliverable' } }, false],
  ])('HTTP %i → retryable conforme o código da Meta', async (status, body, retryable) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(status, body)));
    const result = await createMetaTransport(config).send({ ...base, type: 'text', text: 'x' });
    expect(result).toMatchObject({ ok: false, retryable, code: String(body.error.code) });
  });

  it('número do fornecedor inválido não chega a sair; rede em baixo volta à fila', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetch);
    const t = createMetaTransport(config);
    expect(await t.send({ ...base, senderId: 'wpn_x', type: 'text', text: 'x' })).toMatchObject({ ok: false, retryable: false, code: 'invalid_sender' });
    expect(fetch).not.toHaveBeenCalled();
    expect(await t.send({ ...base, type: 'text', text: 'x' })).toMatchObject({ ok: false, retryable: true, code: 'network' });
  });
});

describe('Cloud API da Meta — webhook', () => {
  const t = createMetaTransport(config);
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const sign = (raw: string, secret = config.appSecret) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

  it('assinatura X-Hub-Signature-256 sobre o corpo cru', () => {
    expect(t.verifyWebhook(body, headers({ 'x-hub-signature-256': sign(body) }))).toBe(true);
    expect(t.verifyWebhook(`${body} `, headers({ 'x-hub-signature-256': sign(body) }))).toBe(false);
    expect(t.verifyWebhook(body, headers({ 'x-hub-signature-256': sign(body, 'outro') }))).toBe(false);
    expect(t.verifyWebhook(body, headers({}))).toBe(false);
  });

  it('aperto de mão do GET só com o token certo', () => {
    const q = (token: string, challenge = '1158201444') => new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': challenge });
    expect(t.verifyChallenge?.(q('verifica-me'))).toBe('1158201444');
    expect(t.verifyChallenge?.(q('errado'))).toBeNull();
    expect(t.verifyChallenge?.(q('verifica-me', '<script>'))).toBeNull();
  });

  it('uma entrega com várias mensagens e estados, cada um com o seu id', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'WABA', changes: [{ field: 'messages', value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '258870301006', phone_number_id: '111' },
        contacts: [{ wa_id: '258841234567', profile: { name: 'Ana Maria' } }],
        messages: [
          { from: '258841234567', id: 'wamid.1', type: 'text', text: { body: 'menu' } },
          { from: '258841234567', id: 'wamid.2', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'i:abc', title: 'Smash' } } },
          { from: '258841234567', id: 'wamid.3', type: 'image', image: { id: '998877', mime_type: 'image/jpeg', caption: 'comprovativo' } },
          { from: '258841234567', id: 'wamid.4', type: 'button', button: { text: '👍 Correu bem', payload: 'fb:up' } },
        ],
        statuses: [{ id: 'wamid.OUT', status: 'failed', recipient_id: '258841234567', errors: [{ code: 131047, title: 'Re-engagement message' }] }],
      } }] }],
    };
    const out = parseMetaWebhook(payload)!;
    expect(out.map((d) => d.eventId)).toEqual(['wa:msg:wamid.1', 'wa:msg:wamid.2', 'wa:msg:wamid.3', 'wa:msg:wamid.4', 'wa:st:wamid.OUT:failed']);
    expect(out[0].event).toEqual({
      kind: 'inbound', providerMessageId: 'wamid.1', senderId: '111', from: '+258841234567', text: 'menu',
      replyId: null, profileName: 'Ana Maria', media: null, contentType: 'text',
    });
    expect(out[1].event).toMatchObject({ replyId: 'i:abc', text: 'Smash', contentType: 'interactive' });
    expect(out[2].event).toMatchObject({ media: { id: '998877', mimeType: 'image/jpeg', caption: 'comprovativo' }, text: 'comprovativo' });
    expect(out[3].event).toMatchObject({ replyId: 'fb:up' });
    expect(out[4].event).toEqual({ kind: 'status', providerMessageId: 'wamid.OUT', status: 'failed', error: '131047: Re-engagement message' });
  });

  it('o que não é da WABA é malformado; outros campos ignoram-se', () => {
    expect(parseMetaWebhook({ object: 'page', entry: [] })).toBeNull();
    expect(parseMetaWebhook({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'account_update', value: {} }] }] })).toEqual([]);
  });
});

describe('Cloud API da Meta — media', () => {
  it('descarrega o comprovativo com o mesmo token, recusa ficheiros grandes', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(reply(200, { url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'image/jpeg', file_size: 4 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 }))
      .mockResolvedValueOnce(reply(200, { url: 'https://lookaside.fbsbx.com/x', mime_type: 'image/jpeg', file_size: 99_000_000 }));
    vi.stubGlobal('fetch', fetch);
    const t = createMetaTransport(config);
    const ok = await t.downloadMedia!('998877');
    expect(ok).toMatchObject({ ok: true, mimeType: 'image/jpeg' });
    expect(fetch.mock.calls[1][1].headers).toMatchObject({ authorization: 'Bearer EAAG_token' });
    expect(await t.downloadMedia!('998877')).toMatchObject({ ok: false, retryable: false, error: 'media_grande_demais' });
    expect(await t.downloadMedia!('../x')).toMatchObject({ ok: false });
  });
});

describe('limites das mensagens interactivas', () => {
  it('corta títulos, limita botões e linhas e garante títulos únicos', () => {
    const buttons = fitSession({ type: 'buttons', text: 'x', buttons: [
      { id: '1', title: 'Um título muito comprido demais' }, { id: '2', title: 'Um título muito comprido demais' },
      { id: '3', title: 'c' }, { id: '4', title: 'd' },
    ] });
    expect(buttons.type === 'buttons' && buttons.buttons).toHaveLength(LIMITS.buttons);
    if (buttons.type !== 'buttons') throw new Error();
    expect(new Set(buttons.buttons.map((b) => b.title)).size).toBe(3);
    for (const b of buttons.buttons) expect(Array.from(b.title).length).toBeLessThanOrEqual(LIMITS.buttonTitle);

    const list = fitSession({ type: 'list', text: 'x', button: 'Ver', sections: [
      { title: 'A', rows: Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, title: `Hambúrguer número ${i} especial da casa`, description: 'd'.repeat(100) })) },
      { rows: Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, title: `B${i}` })) },
    ] });
    if (list.type !== 'list') throw new Error();
    expect(list.sections.flatMap((s) => s.rows)).toHaveLength(LIMITS.listRows);
    expect(list.sections.every((s) => s.title)).toBe(true);
    for (const row of list.sections.flatMap((s) => s.rows)) {
      expect(Array.from(row.title).length).toBeLessThanOrEqual(LIMITS.rowTitle);
      expect(Array.from(row.description ?? '').length).toBeLessThanOrEqual(LIMITS.rowDescription);
    }
  });
  it('sem nada clicável cai para texto', () => {
    expect(fitSession({ type: 'buttons', text: 'só texto', buttons: [] })).toEqual({ type: 'text', text: 'só texto' });
  });
});
