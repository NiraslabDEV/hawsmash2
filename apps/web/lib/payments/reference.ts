/**
 * Referência de pagamento Paysuite.
 *
 * O Paysuite exige que o `reference` seja **só letras e números** (verificado
 * contra a API real: "The Reference field must only contain letters and numbers").
 * O nosso orderId é um UUID (hex + hífens) — não serve diretamente.
 *
 * Codificamos o orderId sem hífens, com prefixo `ord` → alfanumérico, e
 * reversível. A MESMA referência é a idempotency key em todos os caminhos
 * (checkout, webhook, reconciliação) → o dedup do confirm_payment funciona.
 */

export function orderToReference(orderId: string): string {
  return 'ord' + orderId.replace(/-/g, '');
}

export function referenceToOrderId(reference: string): string {
  // Legado / mock antigo: 'order_<uuid>'
  if (reference.startsWith('order_')) return reference.slice(6);

  const hex = reference.replace(/^ord/, '');
  if (/^[0-9a-f]{32}$/i.test(hex)) {
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Formato inesperado → devolve como veio (não rebenta)
  return reference;
}
