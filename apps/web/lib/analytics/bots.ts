/**
 * bots.ts — mantém robôs fora do funil.
 *
 * Os eventos first-party só nascem quando o browser corre JavaScript, o que já
 * exclui a maior parte dos crawlers. Mas headless Chrome, scrapers e monitores
 * de uptime executam JS e contam como sessão — inflacionam o topo do funil e
 * fazem a loja parecer que não converte.
 *
 * CUIDADO com o exagero: marcar um cliente real como bot apaga-lhe a venda do
 * relatório, o que é pior do que contar um robô a mais. Por isso nada de
 * `ua.includes('bot')` — CUBOT é uma marca de telemóvel comum em Moçambique.
 * Os padrões genéricos usam fronteira de palavra.
 *
 * Lógica pura, sem dependências do Next.
 */

/** Tokens inequívocos: se aparecem no user-agent, é robô. */
const BOT_TOKENS = [
  // Motores de busca
  'googlebot', 'google-inspectiontool', 'storebot-google', 'bingbot', 'adidxbot',
  'yandexbot', 'baiduspider', 'duckduckbot', 'slurp', 'petalbot', 'applebot',
  'sogou', 'exabot', 'ia_archiver', 'archive.org_bot',
  // Previews de link das redes sociais e mensagens
  'facebookexternalhit', 'facebookcatalog', 'facebot', 'twitterbot', 'telegrambot',
  'linkedinbot', 'pinterestbot', 'redditbot', 'discordbot', 'slackbot', 'whatsapp',
  'skypeuripreview', 'embedly', 'quora link preview', 'vkshare',
  // SEO / scraping
  'ahrefsbot', 'semrushbot', 'mj12bot', 'dotbot', 'dataforseo', 'blexbot',
  'screaming frog', 'scrapy', 'serpstatbot', 'zoominfobot', 'bytespider',
  // Automação / headless — são estes que executam JS
  'headlesschrome', 'phantomjs', 'puppeteer', 'playwright', 'selenium',
  'webdriver', 'cypress', 'chrome-lighthouse', 'pagespeed', 'gtmetrix',
  // Monitorização
  'uptimerobot', 'pingdom', 'statuscake', 'site24x7', 'newrelicpinger',
  'datadog', 'betteruptime', 'checkly',
  // Clientes HTTP de script
  'curl/', 'wget/', 'python-requests', 'python-urllib', 'aiohttp', 'httpx',
  'go-http-client', 'okhttp', 'axios/', 'node-fetch', 'got/', 'guzzlehttp',
  'java/', 'libwww-perl', 'postmanruntime', 'insomnia',
  // Infra
  'vercel-screenshot', 'vercel-favicon', 'vercelbot', 'prerender',
];

/**
 * Padrões genéricos, com fronteira de palavra para não apanhar marcas como
 * CUBOT. `\bbot\b` não faz match em "cubot" nem em "googlebot" (esse já está
 * na lista acima por nome).
 */
const BOT_PATTERNS = [
  /\bbot\b/,
  /\bbots\b/,
  /\bcrawler\b/,
  /\bcrawl\b/,
  /\bspider\b/,
  /\bscraper\b/,
  /\bmonitoring\b/,
  /\bheadless\b/,
];

/**
 * True quando o user-agent é (quase de certeza) um robô.
 *
 * Um user-agent em falta conta como robô: nenhum browser real o omite, e os
 * scripts caseiros costumam não o enviar.
 */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  const ua = userAgent?.trim().toLowerCase();
  if (!ua) return true;

  for (const token of BOT_TOKENS) {
    if (ua.includes(token)) return true;
  }
  for (const pattern of BOT_PATTERNS) {
    if (pattern.test(ua)) return true;
  }
  return false;
}
