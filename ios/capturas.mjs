#!/usr/bin/env node
/**
 * Capturas para a App Store (iPhone 6,9": 1320×2868) tiradas ao site em produção
 * com o Chrome desta máquina, como a app as mostra (user-agent da app iOS).
 *
 *   node capturas.mjs                       # https://<host> de capacitor.config.json
 *   node capturas.mjs --origem http://localhost:3000
 *
 * Sai em loja/: 1-inicio, 2-cardapio, 3-carrinho. Tirar DENTRO do horário de
 * uma loja: fora dele a montra diz "Fora do horário".
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

const AQUI = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(AQUI, 'capacitor.config.json'), 'utf8'));
const i = process.argv.indexOf('--origem');
const origem = (i > 0 ? process.argv[i + 1] : config.server.url).replace(/\/$/, '');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SAIDA = join(AQUI, 'loja');
mkdirSync(SAIDA, { recursive: true });

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const erros = [];
try {
  const page = await browser.newPage();
  await page.setUserAgent(
    `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 ${config.ios.appendUserAgent}`,
  );
  // 440×956 pontos a 3× = 1320×2868, o tamanho 6,9" que a App Store pede.
  await page.setViewport({ width: 440, height: 956, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('dl_install_dismissed_until', String(Date.now() + 9e9));
    } catch {}
  });
  page.on('pageerror', (e) => erros.push(e.message));

  const clicarTexto = (texto) =>
    page.evaluate((t) => {
      const el = [...document.querySelectorAll('button, a')].find(
        (b) => b.innerText.trim().toUpperCase() === t.toUpperCase() && b.offsetParent !== null,
      );
      el?.click();
      return Boolean(el);
    }, texto);

  await page.goto(`${origem}/`, { waitUntil: 'networkidle0', timeout: 60_000 });
  await espera(800);
  await clicarTexto('Recusar'); // aviso de cookies
  await espera(800);
  await page.screenshot({ path: join(SAIDA, '1-inicio.png') });

  await page.goto(`${origem}/menu`, { waitUntil: 'networkidle0', timeout: 60_000 });
  await espera(800);
  await clicarTexto('Recusar');
  // Desce até aos primeiros produtos.
  await page.evaluate(() => {
    const botao = [...document.querySelectorAll('button')].find((b) => b.innerText.trim().toUpperCase() === 'ADICIONAR');
    const cartao = botao?.closest('article, li, [class*="card"]') ?? botao;
    if (cartao) window.scrollTo(0, cartao.getBoundingClientRect().top + window.scrollY - 160);
  });
  await espera(1500);
  await page.screenshot({ path: join(SAIDA, '2-cardapio.png') });

  // Dois artigos no carrinho e o carrinho aberto.
  for (let n = 0; n < 2; n++) {
    await page.evaluate((k) => {
      const botoes = [...document.querySelectorAll('button')].filter((b) => b.innerText.trim().toUpperCase() === 'ADICIONAR');
      botoes[k]?.click();
    }, n);
    await espera(900);
    // Se abriu escolha de opções, confirma com o botão principal do diálogo.
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const b = dlg && [...dlg.querySelectorAll('button')].find((x) => /ADICIONAR|CONFIRMAR/i.test(x.innerText));
      b?.click();
    });
    await espera(900);
  }
  await page.evaluate(() => document.querySelector('[aria-label^="Abrir carrinho"]')?.click());
  await espera(1500);
  await page.screenshot({ path: join(SAIDA, '3-carrinho.png') });
} finally {
  await browser.close();
}
console.log(`Capturas em ${SAIDA}${erros.length ? `\nErros da página: ${erros.join(' | ')}` : ''}`);
