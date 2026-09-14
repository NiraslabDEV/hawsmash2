import { describe, expect, it } from 'vitest';
import { getPaymentLookup } from '../lookup';

describe('referência para consultar pagamentos', () => {
  const order = { payment_reference: 'PLACEHOLDER_ATTEMPT', payment_provider_ref: 'PLACEHOLDER_PROVIDER' };
  it('M-Pesa directo consulta a referência da tentativa', () => {
    expect(getPaymentLookup('mpesa', 'direct', order)).toBe('PLACEHOLDER_ATTEMPT');
    expect(getPaymentLookup('mpesa_sim', 'direct', order)).toBe('PLACEHOLDER_ATTEMPT');
  });
  it('simulador e-Mola consulta a referência persistida e não depende de memória do processo', () => {
    expect(getPaymentLookup('emola_sim', 'direct', order)).toBe('PLACEHOLDER_PROVIDER');
    expect(getPaymentLookup('emola_sim', 'direct', { ...order, payment_provider_ref: null })).toBeNull();
  });
  it('fornecedores de redirect mantêm a referência do fornecedor', () => {
    expect(getPaymentLookup('paysuite', 'redirect', order)).toBe('PLACEHOLDER_PROVIDER');
    expect(getPaymentLookup('mock', 'redirect', order)).toBe('PLACEHOLDER_PROVIDER');
  });
});
