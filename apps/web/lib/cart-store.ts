/**
 * A que loja pertence o carrinho guardado no browser.
 *
 * O carrinho vive em `localStorage['cart']` e é partilhado por todo o site —
 * mas preços, stock e taxas são de **uma** loja (CLAUDE §5.5). Sem esta marca,
 * um carrinho montado em Maputo seguia para a Matola por um link directo,
 * pelo histórico do browser ou pelo ecrã de escolha, e só se descobria a
 * diferença no fim, quando o servidor recalculasse.
 */

export const CART_STORE_KEY = 'cart_store';

/** Há alguma coisa no carrinho? (aceita o valor cru do localStorage) */
export function cartHasItems(cartRaw: string | null): boolean {
  if (!cartRaw) return false;
  try {
    const parsed: unknown = JSON.parse(cartRaw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    // JSON corrompido não é carrinho: deixa-se o resto do fluxo tratá-lo.
    return false;
  }
}

/**
 * Esvaziar o carrinho ao entrar numa loja?
 * Só quando ele é de outra loja e tem alguma coisa lá dentro. Um carrinho sem
 * dono (primeira visita) apenas passa a ter dono, sem incomodar ninguém.
 */
export function shouldClearCart(
  owner: string | null,
  storeSlug: string,
  cartRaw: string | null,
): boolean {
  if (!owner || owner === storeSlug) return false;
  return cartHasItems(cartRaw);
}
