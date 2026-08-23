// O ecrã de Pedidos visto por quem está ao balcão, a 1366x768.
// Não cria nem altera pedidos: só entra e fotografa o que lá está.
import { expect, test } from '@playwright/test';

const email = 'caixa.maputo@hawsmash.test';
const password = 'Hawsmash2026#CxMpt';
const DIR = 'output/pos-screens';

test.use({ viewport: { width: 1366, height: 768 } });

test('pedidos vistos pelo balcão', async ({ page }) => {
  await page.goto('/login?next=/pedidos');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Recusar' }).click({ timeout: 5000 }).catch(() => {});
  await page.getByPlaceholder('dono@restaurante.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  // Atencao: /login?next=/pedidos tambem termina em /pedidos, por isso um
  // toHaveURL(//pedidos$/) passa ainda no ecra de entrada — foi assim que a
  // primeira captura saiu da pagina de login com o teste verde.
  await page.waitForURL((url) => new URL(url).pathname === '/pedidos', { timeout: 25_000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${DIR}/10-pedidos-balcao.png` });
  await page.screenshot({ path: `${DIR}/11-pedidos-inteiro.png`, fullPage: true });
  console.log('>>> capturas de pedidos em ' + DIR);
});
