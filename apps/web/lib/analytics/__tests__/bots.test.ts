/**
 * Filtro de bots do funil.
 *
 * Sem isto, qualquer crawler que execute JavaScript conta como sessão e
 * inflaciona o topo do funil — o dono vê "500 visitas, 2 compras" e conclui
 * que a loja não converte, quando metade das visitas eram robôs.
 *
 * O risco ao contrário é pior: marcar um cliente real como bot apaga-lhe a
 * venda do relatório. Daí os testes de falsos positivos (CUBOT é uma marca
 * de telemóvel comum em Moçambique).
 */
import { describe, it, expect } from 'vitest';
import { isBotUserAgent } from '../bots';

describe('isBotUserAgent — apanha robôs', () => {
  it('apanha os crawlers dos motores de busca', () => {
    const uas = [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'Mozilla/5.0 (compatible; YandexBot/3.0)',
      'Mozilla/5.0 (compatible; DuckDuckBot-Https/1.1)',
      'Mozilla/5.0 (compatible; Baiduspider/2.0)',
      'Mozilla/5.0 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)',
    ];
    for (const ua of uas) expect(isBotUserAgent(ua), ua).toBe(true);
  });

  it('apanha os previews de link das redes (WhatsApp, Facebook, Telegram)', () => {
    const uas = [
      'WhatsApp/2.23.20.0',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Twitterbot/1.0',
      'TelegramBot (like TwitterBot)',
      'LinkedInBot/1.0',
    ];
    for (const ua of uas) expect(isBotUserAgent(ua), ua).toBe(true);
  });

  it('apanha ferramentas de SEO e scraping', () => {
    const uas = [
      'Mozilla/5.0 (compatible; AhrefsBot/7.0)',
      'Mozilla/5.0 (compatible; SemrushBot/7~bl)',
      'Screaming Frog SEO Spider/19.2',
      'Scrapy/2.11 (+https://scrapy.org)',
    ];
    for (const ua of uas) expect(isBotUserAgent(ua), ua).toBe(true);
  });

  it('apanha browsers headless e automação — são estes que executam JS', () => {
    const uas = [
      'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Puppeteer',
      'Mozilla/5.0 Playwright/1.40',
      'Chrome-Lighthouse',
    ];
    for (const ua of uas) expect(isBotUserAgent(ua), ua).toBe(true);
  });

  it('apanha clientes HTTP de script', () => {
    const uas = [
      'curl/8.4.0',
      'Wget/1.21.4',
      'python-requests/2.31.0',
      'Go-http-client/2.0',
      'axios/1.6.2',
      'node-fetch/1.0',
      'okhttp/4.12.0',
    ];
    for (const ua of uas) expect(isBotUserAgent(ua), ua).toBe(true);
  });

  it('apanha monitores de uptime', () => {
    expect(isBotUserAgent('Mozilla/5.0 (compatible; UptimeRobot/2.0)')).toBe(true);
    expect(isBotUserAgent('Pingdom.com_bot_version_1.4')).toBe(true);
  });

  it('user-agent vazio é tratado como bot — nenhum browser real o omite', () => {
    for (const ua of [undefined, null, '', '   ']) expect(isBotUserAgent(ua)).toBe(true);
  });
});

describe('isBotUserAgent — NÃO apanha clientes reais', () => {
  it('deixa passar os browsers de telemóvel', () => {
    const uas = [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Linux; Android 11; TECNO KE5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Linux; Android 12; Infinix X6819) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    ];
    for (const ua of uas) expect(isBotUserAgent(ua), ua).toBe(false);
  });

  it('CUBOT é um telemóvel, não um robô', () => {
    // Marca comum em Moçambique. Um `includes("bot")` ingénuo apagava estes
    // clientes do relatório — daí o teste estar aqui.
    const uas = [
      'Mozilla/5.0 (Linux; Android 10; CUBOT NOTE 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Linux; Android 11; Cubot X30) AppleWebKit/537.36 Chrome/118.0.0.0 Mobile Safari/537.36',
    ];
    for (const ua of uas) expect(isBotUserAgent(ua), ua).toBe(false);
  });

  it('deixa passar os browsers de computador', () => {
    const uas = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    ];
    for (const ua of uas) expect(isBotUserAgent(ua), ua).toBe(false);
  });

  it('deixa passar o browser interno do Instagram e do Facebook', () => {
    // O cliente que clica no link do bio vem com isto — é uma pessoa real.
    const uas = [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Instagram 302.0.0.23.113',
      'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 Chrome/119.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/443.0.0.30.117;]',
    ];
    for (const ua of uas) expect(isBotUserAgent(ua), ua).toBe(false);
  });
});
