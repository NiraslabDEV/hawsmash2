export type PaymentMode = 'manual' | 'mock' | 'paysuite' | 'mpesa' | 'mpesa_sim';

/** Configuração pública: escolhe o caminho, nunca transporta credenciais. */
export function getPaymentMode(provider: string | null | undefined, emolaProvider: string | null | undefined, method: string): PaymentMode {
  if (method === 'emola') {
    // DECISÃO: lojas com M-Pesa directo nascem com e-Mola manual; as lojas que
    // já usavam o gateway preservam o caminho existente até escolha explícita.
    const selected = emolaProvider ?? provider;
    return selected === 'paysuite' || selected === 'mock' ? selected : 'manual';
  }
  if (method === 'mpesa' && (provider === 'mpesa' || provider === 'mpesa_sim')) return provider;
  if ((method === 'mpesa' || method === 'credit_card') && (provider === 'paysuite' || provider === 'mock')) return provider;
  return 'manual';
}
