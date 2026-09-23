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

/**
 * Casos reais dos anuncios do Meta, trazidos do SLICE (painel de 2026-09-20):
 * 14 linhas de origem que eram 5 origens, e nomes de campanha no lugar do
 * meio. Ver docs/RASTREIO.md §3.
 */
describe('buildTouch — lixo dos anúncios do Meta', () => {
  it('utm_source=MetaAds vira facebook pago e o nome da campanha sai do meio', () => {
    const t = touch('https://hawsmash.com/?utm_source=MetaAds&utm_medium=SMASH%20DELIVERY');
    expect(t.s).toBe('facebook');
    expect(t.m).toBe('cpc');
    expect(t.ch).toBe('paid_social');
    expect(t.c).toBe('smash delivery');
  });

  it('id numérico na fonte não vira origem — conta como anúncio Meta', () => {
    const t = touch(
      'https://hawsmash.com/?utm_source=120250536398130239&utm_medium=New%20Traffic%20Ad%20with%20recommended%20settings',
    );
    expect(t.s).toBe('facebook');
    expect(t.ch).toBe('paid_social');
    expect(t.c).toBe('new traffic ad with recommended settings');
  });

  it('id numérico com referrer do Instagram fica em instagram', () => {
    const t = touch('https://hawsmash.com/?utm_source=120250536398130239', 'https://l.instagram.com/');
    expect(t.s).toBe('instagram');
    expect(t.ch).toBe('paid_social');
  });

  it('id numérico com fbclid é facebook', () => {
    expect(touch('https://hawsmash.com/?utm_source=120250536398130239&fbclid=IwAR123').s).toBe('facebook');
  });

  it('a mesma campanha com + codificado e com espaço colapsa numa linha só', () => {
    const comMais = touch('https://hawsmash.com/?utm_source=MetaAds&utm_campaign=New%2BTraffic%2BAd');
    const comEspaco = touch('https://hawsmash.com/?utm_source=MetaAds&utm_campaign=New%20Traffic%20Ad');
    expect(comMais.c).toBe(comEspaco.c);
  });

  it('macro do Meta não substituída é ausência, não valor', () => {
    const t = touch('https://hawsmash.com/?utm_source={{campaign.id}}&utm_medium={{ad.name}}', 'https://l.facebook.com/');
    expect(t.s).toBe('facebook');
    expect(t.c).toBeUndefined();
  });

  it('--sanitized-- (proxy corporativo) não vira origem', () => {
    const t = touch('https://hawsmash.com/?utm_source=--sanitized--&utm_medium=--sanitized--');
    expect(t.ch).toBe('direct');
    expect(t.s).toBe('direto');
    expect(t.c).toBeUndefined();
  });

  it('{{site_source_name}} (ig, fb, an, msg) colapsa na família Meta e é anúncio', () => {
    expect(touch('https://hawsmash.com/?utm_source=ig').s).toBe('instagram');
    expect(touch('https://hawsmash.com/?utm_source=fb').ch).toBe('paid_social');
    expect(touch('https://hawsmash.com/?utm_source=an').s).toBe('audience_network');
    expect(touch('https://hawsmash.com/?utm_source=msg').s).toBe('messenger');
  });

  it('meios equivalentes colapsam no mesmo nome', () => {
    expect(touch('https://hawsmash.com/?utm_source=facebook&utm_medium=CPC').m).toBe('cpc');
    expect(touch('https://hawsmash.com/?utm_source=facebook&utm_medium=paid%20social').ch).toBe('paid_social');
    expect(touch('https://hawsmash.com/?utm_source=google&utm_medium=organico').ch).toBe('organic_search');
  });

  it('link etiquetado fora da família Meta e sem meio é referral, não directo', () => {
    const t = touch('https://hawsmash.com/?utm_source=folheto');
    expect(t.ch).toBe('referral');
    expect(isMeaningfulTouch(t)).toBe(true);
  });

  it('partilha orgânica do Instagram continua social, não paga', () => {
    const t = touch('https://hawsmash.com/', 'https://l.instagram.com/');
    expect(t.ch).toBe('organic_social');
  });

  it('nome no meio vence o id numérico já posto na campanha', () => {
    const t = touch('https://hawsmash.com/?utm_source=MetaAds&utm_campaign=12025053639814023&utm_medium=New%20Traffic%20Ad');
    expect(t.c).toBe('new traffic ad');
  });

  it('id numérico sozinho na campanha mantém-se — separa anúncios diferentes', () => {
    expect(touch('https://hawsmash.com/?utm_source=MetaAds&utm_campaign=12025053639814023').c).toBe('12025053639814023');
  });

  it('nome verdadeiro na campanha não é substituído pelo meio', () => {
    const t = touch('https://hawsmash.com/?utm_source=MetaAds&utm_campaign=abertura&utm_medium=cpc');
    expect(t.c).toBe('abertura');
    expect(t.m).toBe('cpc');
  });

  it('macro por substituir na campanha não fica no painel', () => {
    expect(touch('https://hawsmash.com/?utm_source=MetaAds&utm_campaign={{adset.name}}').c).toBeUndefined();
    expect(touch('https://hawsmash.com/?utm_source=--sanitized--&utm_medium={{ad.id}}').c).toBeUndefined();
  });
});

describe('referrer de app Android', () => {
  it('android-app://com.whatsapp é WhatsApp, não um site desconhecido', () => {
    expect(hostOf('android-app://com.whatsapp/')).toBe('whatsapp.com');
    expect(touch('https://hawsmash.com/', 'android-app://com.whatsapp/').ch).toBe('whatsapp');
    expect(touch('https://hawsmash.com/', 'android-app://com.whatsapp.w4b/').ch).toBe('whatsapp');
  });

  it('a app do Instagram e a do Google classificam como a versão web', () => {
    expect(touch('https://hawsmash.com/', 'android-app://com.instagram.android/').s).toBe('instagram');
    expect(touch('https://hawsmash.com/', 'android-app://com.google.android.googlequicksearchbox/').ch).toBe('organic_search');
  });
});

describe('site atrás de proxy (Railway)', () => {
  // O container vê `localhost`; o browser manda o referer com o domínio público.
  const hosts = ['hawsmash2-staging.up.railway.app', 'localhost:8080', 'localhost', null];

  it('clique dentro do site é navegação interna, mesmo com o nextUrl a dizer localhost', () => {
    const t = buildTouch({
      url: new URL('http://localhost:8080/checkout'),
      referrer: 'https://hawsmash2-staging.up.railway.app/l/maputo',
      selfHost: hosts,
    });
    expect(t.ch).toBe('internal');
    expect(isMeaningfulTouch(t)).toBe(false);
    expect(t.r).toBeUndefined();
  });

  it('o próprio domínio nunca aparece como fonte', () => {
    const t = buildTouch({
      url: new URL('http://localhost:8080/'),
      referrer: 'https://www.hawsmash2-staging.up.railway.app/',
      selfHost: hosts,
    });
    expect(t.s).not.toContain('railway.app');
  });

  it('um referrer externo continua externo', () => {
    const t = buildTouch({
      url: new URL('http://localhost:8080/'),
      referrer: 'https://l.instagram.com/',
      selfHost: hosts,
    });
    expect(t.ch).toBe('organic_social');
  });
});
