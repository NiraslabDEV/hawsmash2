/** O simulador e-Mola codifica o cenário numa referência persistida, sem memória partilhada. */
export function getPaymentLookup(
  providerName: string,
  flow: 'direct' | 'redirect',
  order: { payment_reference: string | null; payment_provider_ref: string | null },
): string | null {
  return flow === 'direct' && providerName !== 'emola_sim'
    ? order.payment_reference
    : order.payment_provider_ref;
}
