import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMockTransport,
  createTyxterTransport,
  isOptOut,
  parseTyxterEvent,
  signTimestamped,
  toWhatsAppPhone,
  verifyTimestampedSignature,
} from '../index';

afterEach(() => vi.unstubAllGlobals());

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });

describe('telemóvel para WhatsApp', () => {
  it.each(['84 123 4567', '841234567', '0841234567', '+258 84 123 4567', '258841234567', '00258841234567', '(84) 123-4567'])(
    'normaliza %s', (input) => {
      expect(toWhatsAppPhone(input)).toBe('+258841234567');
    });
  it('aceita os seis prefixos móveis, incluindo o 87 de Maputo', () => {
    for (const p of ['82', '83', '84', '85', '86', '87']) expect(toWhatsAppPhone(`${p}0301006`)).toBe(`+258${p}0301006`);
    expect(toWhatsAppPhone('+258 87 030 1006')).toBe('+258870301006');
  });
  it.each(['', null, undefined, '21 123 456', '881234567', '84123456', '8412345678', '+27841234567', 'abc841234567', '84a1234567'])(
    'recusa %s', (input) => {
      expect(toWhatsAppPhone(input)).toBeNull();
    });
});

describe('assinatura do webhook (timestamp.corpo, HMAC-SHA256 hex)', () => {
  const secret = 'whsec_teste';
  const body = '{"type":"message.read","data":{"message_id":"msg_1"}}';
  const now = 1_714_176_000_000;
  const ts = String(now / 1000);
  const signature = signTimestamped(secret, ts, body);

  it('aceita a assinatura certa dentro da janela', () => {
    expect(verifyTimestampedSignature({ secret, timestamp: ts, signature, rawBody: body, nowMs: now })).toBe(true);
    expect(verifyTimestampedSignature({ secret, timestamp: ts, signature: signature.toUpperCase(), rawBody: body, nowMs: now })).toBe(true);
  });
  it('recusa corpo alterado, segredo errado, carimbo fora da janela e cabeçalhos em falta', () => {
    expect(verifyTimestampedSignature({ secret, timestamp: ts, signature, rawBody: body + ' ', nowMs: now })).toBe(false);
    expect(verifyTimestampedSignature({ secret: 'outro', timestamp: ts, signature, rawBody: body, nowMs: now })).toBe(false);
    expect(verifyTimestampedSignature({ secret, timestamp: ts, signature, rawBody: body, nowMs: now + 301_000 })).toBe(false);
    expect(verifyTimestampedSignature({ secret, timestamp: null, signature, rawBody: body, nowMs: now })).toBe(false);
    expect(verifyTimestampedSignature({ secret, timestamp: ts, signature: null, rawBody: body, nowMs: now })).toBe(false);
    expect(verifyTimestampedSignature({ secret: '', timestamp: ts, signature, rawBody: body, nowMs: now })).toBe(false);
  });
});

describe('transporte Tyxter', () => {
  const message = {
    senderId: 'wpn_maputo',
    to: '+258841234567',
    template: 'hs_pedido_pago',
    language: 'pt_PT',
    variables: { nome: 'Ana', pedido: 'MPT-0042' },
    components: [{ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'abc' }] }],
    idempotencyKey: 'wa_1',
  };
  const reply = (status: number, body: unknown, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });

  it('envia o template pelo número da loja, com a chave de idempotência', async () => {
    const fetch = vi.fn().mockResolvedValue(reply(202, { id: 'msg_123', status: 'accepted' }));
    vi.stubGlobal('fetch', fetch);
    const t = createTyxterTransport({ apiKey: 'tx_sandbox_x', webhookSecret: 's' });
    expect(t.name).toBe('tyxter-sandbox');
    await expect(t.send(message)).resolves.toEqual({ ok: true, providerMessageId: 'msg_123' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.tyxter.com/v1/messages');
    expect(init.headers).toMatchObject({ authorization: 'Bearer tx_sandbox_x', 'idempotency-key': 'wa_1' });
    expect(JSON.parse(init.body)).toEqual({
      channel: 'whatsapp',
      sender: { type: 'whatsapp_phone_number', id: 'wpn_maputo' },
      recipient: { type: 'phone_e164', id: '+258841234567' },
      message: { type: 'template', template: { name: 'hs_pedido_pago', language: 'pt_PT', variables: message.variables, components: message.components } },
    });
  });

  it.each([
    [429, { error: { code: 'rate_limited', message: 'devagar', retry_after_ms: 2000 } }, true],
    [503, { error: { code: 'service_unavailable', message: 'x' } }, true],
    [402, { error: { code: 'credit_balance_exhausted', message: 'sem crédito' } }, true],
    [409, { error: { code: 'idempotency_key_in_progress', message: 'x' } }, true],
    [409, { error: { code: 'idempotency_key_conflict', message: 'x' } }, false],
    [400, { error: { code: 'template_not_approved', message: 'x' } }, false],
    [401, {}, false],
  ])('HTTP %i → retryable conforme o contrato', async (status, body, retryable) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(status, body)));
    const result = await createTyxterTransport({ apiKey: 'tx_live_x', webhookSecret: 's' }).send(message);
    expect(result).toMatchObject({ ok: false, retryable });
    if (status === 429) expect(result).toMatchObject({ retryAfterMs: 2000, code: 'rate_limited' });
  });

  it('falha de rede volta à fila, nunca rebenta', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(createTyxterTransport({ apiKey: 'tx_live_x', webhookSecret: 's' }).send(message))
      .resolves.toMatchObject({ ok: false, retryable: true, code: 'network' });
  });
});

describe('eventos do webhook', () => {
  it('estado de entrega', () => {
    expect(parseTyxterEvent({ type: 'message.delivered', data: { message_id: 'msg_1' } }))
      .toEqual({ kind: 'status', providerMessageId: 'msg_1', status: 'delivered' });
    expect(parseTyxterEvent({ type: 'message.failed', data: { message_id: 'msg_1', error_code: 'x', error_message: 'Número sem WhatsApp' } }))
      .toEqual({ kind: 'status', providerMessageId: 'msg_1', status: 'failed', error: 'Número sem WhatsApp' });
  });
  it('mensagem recebida: texto, botão e media', () => {
    const base = { message_id: 'msg_9', sender: { type: 'phone_e164', id: '+258841234567' }, recipient: { type: 'whatsapp_phone_number', id: 'wpn_maputo' } };
    expect(parseTyxterEvent({ type: 'message.received', data: { ...base, content: { type: 'text', text: { body: 'menu' } } } }))
      .toEqual({ kind: 'inbound', providerMessageId: 'msg_9', senderId: 'wpn_maputo', from: '+258841234567', text: 'menu', replyId: null, profileName: null, media: null, contentType: 'text' });
    expect(parseTyxterEvent({ type: 'message.received', data: { ...base, content: { type: 'interactive', interactive: { button_reply: { id: 'm', title: 'Ver cardápio' } } } } }))
      .toMatchObject({ text: 'Ver cardápio', replyId: 'm', contentType: 'interactive' });
    expect(parseTyxterEvent({ type: 'message.received', data: { ...base, content: { type: 'image', media: {} } } }))
      .toMatchObject({ kind: 'inbound', text: null, media: null, contentType: 'image' });
    expect(parseTyxterEvent({ type: 'message.received', data: { ...base, content: { type: 'image', media: { asset_id: 'ast_1', caption: 'pago' } } } }))
      .toMatchObject({ text: 'pago', media: { id: 'ast_1', mimeType: null, caption: 'pago' } });
  });
  it('ignora o que não conhece ou vem incompleto', () => {
    expect(parseTyxterEvent({ type: 'template.approved', data: {} })).toEqual({ kind: 'ignored', type: 'template.approved' });
    expect(parseTyxterEvent({ type: 'message.received', data: { message_id: 'm' } })).toMatchObject({ kind: 'ignored' });
    expect(parseTyxterEvent(null)).toEqual({ kind: 'ignored', type: 'unknown' });
  });
});

describe('opt-out', () => {
  it.each(['SAIR', ' sair ', 'Stop', 'parar', 'Sáir'])('%s retira o número', (word) => {
    expect(isOptOut(word)).toBe(true);
  });
  // "cancelar" numa conversa de pedido é sobre o carrinho, não sobre os avisos (ADR 0012).
  it.each(['quero sair daqui', 'menu', 'cancelar', '', null])('%s não retira', (text) => {
    expect(isOptOut(text)).toBe(false);
  });
});

describe('transporte mock', () => {
  it('a mesma chave não envia duas vezes; falhas forçadas para ensaio', async () => {
    const t = createMockTransport();
    const msg = { senderId: 's', to: '+258841234567', template: 't', language: 'pt_PT', idempotencyKey: 'k1' };
    t.failNext({ ok: false, retryable: true, code: 'network', error: 'x' });
    expect(await t.send(msg)).toMatchObject({ ok: false });
    const first = await t.send(msg);
    const again = await t.send(msg);
    expect(first).toEqual(again);
    expect(t.sent).toHaveLength(1);
  });
  it('assina como o fornecedor', () => {
    const t = createMockTransport('seg');
    const { timestamp, signature } = t.sign('{}', 1_714_176_000_000);
    expect(t.verifyWebhook('{}', headers({ 'tyxter-webhook-timestamp': timestamp, 'tyxter-webhook-signature': signature }), 1_714_176_000_000)).toBe(true);
  });
});
