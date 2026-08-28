import { describe, expect, it } from 'vitest';

import {
  attributionPayload,
  buildTouch,
  classifyChannel,
  decodeTouch,
  encodeTouch,
  hostOf,
  isMeaningfulTouch,
  normalizeSource,
  readCookie,
} from '../attribution';

const SELF = 'hawsmash.com';

function touch(href: string, referrer?: string) {
  return buildTouch({ url: new URL(href), referrer, selfHost: SELF, now: 1_700_000_000_000 });
}

describe('normalizeSource', () => {
  it('junta os apelidos da mesma fonte', () => {
    expect(normalizeSource('IG')).toBe('instagram');
    expect(normalizeSource('l.instagram.com')).toBe('instagram');
    expect(normalizeSource('chatgpt.com')).toBe('chatgpt');
    expect(normalizeSource('www.google.com')).toBe('google');
    expect(normalizeSource('zap')).toBe('whatsapp');
  });

  it('deixa passar uma fonte que não conhece', () => {
    expect(normalizeSource('radio-mocambique')).toBe('radio-mocambique');
    expect(normalizeSource(null)).toBe('');
  });
});

describe('hostOf', () => {
  it('extrai o host e ignora lixo', () => {
    expect(hostOf('https://www.instagram.com/p/abc')).toBe('instagram.com');
    expect(hostOf('nao-e-url')).toBe('');
    expect(hostOf(null)).toBe('');
  });
});

describe('classifyChannel', () => {
  it('gclid é sempre pago, diga a utm o que disser', () => {
    expect(
      classifyChannel({ source: 'instagram', medium: 'social', referrerHost: '', clickIds: { gclid: 'x' } }),
    ).toBe('paid_search');
  });

  it('cpc numa rede social é social pago', () => {
    expect(classifyChannel({ source: 'instagram', medium: 'cpc', referrerHost: '', clickIds: {} })).toBe('paid_social');
  });

  it('referrer do próprio site é navegação interna', () => {
    expect(
      classifyChannel({ source: '', medium: '', referrerHost: SELF, clickIds: {}, selfHost: SELF }),
    ).toBe('internal');
  });
});

describe('buildTouch — as fontes que interessam ao HAWSMASH', () => {
  it('o link do ChatGPT cai em assistente de IA', () => {
    const t = touch('https://hawsmash.com/?utm_source=chatgpt.com');
    expect(t.ch).toBe('ai_assistant');
    expect(t.s).toBe('chatgpt');
  });

  it('sem utm, o referrer do ChatGPT chega para classificar', () => {
    const t = touch('https://hawsmash.com/', 'https://chatgpt.com/c/123');
    expect(t.ch).toBe('ai_assistant');
    expect(t.s).toBe('chatgpt');
    expect(t.r).toBe('chatgpt.com');
  });

  it('WhatsApp é canal próprio — em Moçambique é o que fecha o pedido', () => {
    expect(touch('https://hawsmash.com/', 'https://wa.me/').ch).toBe('whatsapp');
    expect(touch('https://hawsmash.com/?utm_source=zap&utm_medium=social').ch).toBe('whatsapp');
  });

  it('campanha paga do Google traz o gclid guardado', () => {
    const t = touch('https://hawsmash.com/l/maputo?utm_source=google&utm_medium=cpc&utm_campaign=abertura&gclid=ABC123');
    expect(t.ch).toBe('paid_search');
    expect(t.c).toBe('abertura');
    expect(t.cid).toEqual({ gclid: 'ABC123' });
    expect(t.lp).toBe('/l/maputo');
  });

  it('fbclid sozinho é social orgânico — o Facebook também o põe em links normais', () => {
    expect(touch('https://hawsmash.com/?fbclid=IwAR1').ch).toBe('organic_social');
  });

  it('fbclid com utm de campanha paga é social pago', () => {
    const t = touch('https://hawsmash.com/?utm_source=facebook&utm_medium=cpc&fbclid=IwAR1');
    expect(t.ch).toBe('paid_social');
  });

  it('Instagram orgânico vem pelo referrer', () => {
    const t = touch('https://hawsmash.com/menu', 'https://l.instagram.com/');
    expect(t.ch).toBe('organic_social');
    expect(t.s).toBe('instagram');
  });

  it('QR da mesa é um canal, não tráfego directo', () => {
    const t = touch('https://hawsmash.com/?utm_source=qr_mesa&utm_medium=qr');
    expect(t.ch).toBe('qr');
    expect(t.s).toBe('qr_mesa');
  });

  it('site desconhecido é referral', () => {
    expect(touch('https://hawsmash.com/', 'https://orient.co.mz/').ch).toBe('referral');
  });

  it('sem nada é directo', () => {
    const t = touch('https://hawsmash.com/');
    expect(t.ch).toBe('direct');
    expect(t.s).toBe('direto');
  });

  it('navegação interna não é origem nenhuma', () => {
    const t = touch('https://hawsmash.com/checkout', 'https://hawsmash.com/menu');
    expect(t.ch).toBe('internal');
    expect(t.r).toBeUndefined();
    expect(isMeaningfulTouch(t)).toBe(false);
  });

  it('só um toque com origem pode sobrescrever o último toque', () => {
    expect(isMeaningfulTouch(touch('https://hawsmash.com/?utm_source=ig&utm_medium=social'))).toBe(true);
    expect(isMeaningfulTouch(touch('https://hawsmash.com/'))).toBe(false);
  });
});

describe('cookie', () => {
  it('encode/decode preserva o toque', () => {
    const t = touch('https://hawsmash.com/?utm_source=ig&utm_medium=cpc&utm_campaign=verão');
    expect(decodeTouch(encodeTouch(t))).toEqual(t);
  });

  it('cookie adulterado devolve null em vez de rebentar', () => {
    expect(decodeTouch('nao-e-json')).toBeNull();
    expect(decodeTouch(encodeURIComponent('{"lixo":1}'))).toBeNull();
    expect(decodeTouch(null)).toBeNull();
  });

  it('readCookie lê o nome exacto', () => {
    const header = 'dl_consent=granted; dl_session=abc123; hs_store=matola';
    expect(readCookie(header, 'dl_session')).toBe('abc123');
    expect(readCookie(header, 'dl_attr_last')).toBeNull();
    expect(readCookie(null, 'dl_session')).toBeNull();
  });
});

describe('attributionPayload', () => {
  it('o último toque com origem é o que leva o crédito', () => {
    const first = touch('https://hawsmash.com/?utm_source=ig&utm_medium=social');
    const last = touch('https://hawsmash.com/?utm_source=google&utm_medium=cpc&utm_campaign=abertura');
    const payload = attributionPayload(first, last);

    expect(payload.channel).toBe('paid_search');
    expect(payload.source).toBe('google');
    expect(payload.campaign).toBe('abertura');
    expect(payload.first_touch?.s).toBe('instagram');
  });

  it('sem toque nenhum devolve directo em vez de vazio', () => {
    const payload = attributionPayload(null, null);
    expect(payload.channel).toBe('direct');
    expect(payload.source).toBe('direto');
  });
});
