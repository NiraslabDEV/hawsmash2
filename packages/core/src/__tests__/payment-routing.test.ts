import { describe, expect, it } from 'vitest';
import { getPaymentMode } from '../payment-routing';

describe('encaminhamento dos pagamentos por método', () => {
  it.each(['mpesa', 'mpesa_sim'] as const)('preserva %s directo e deixa e-Mola manual por omissão', (provider) => {
    expect(getPaymentMode(provider, null, 'mpesa')).toBe(provider);
    expect(getPaymentMode(provider, null, 'emola')).toBe('manual');
    expect(getPaymentMode(provider, null, 'credit_card')).toBe('manual');
  });
  it.each(['paysuite', 'mock'] as const)('preserva e-Mola herdado de %s', (provider) => {
    expect(getPaymentMode(provider, null, 'emola')).toBe(provider);
    expect(getPaymentMode(provider, 'manual', 'emola')).toBe('manual');
  });
  it('permite e-Mola por Paysuite sem desviar M-Pesa ou activar cartão', () => {
    expect(getPaymentMode('mpesa', 'paysuite', 'emola')).toBe('paysuite');
    expect(getPaymentMode('mpesa', 'paysuite', 'mpesa')).toBe('mpesa');
    expect(getPaymentMode('mpesa', 'paysuite', 'credit_card')).toBe('manual');
  });
  it('ensaia e-Mola independentemente do M-Pesa e recusa valores desconhecidos', () => {
    expect(getPaymentMode('manual', 'mock', 'emola')).toBe('mock');
    expect(getPaymentMode('mpesa', 'mpesa', 'emola')).toBe('manual');
    expect(getPaymentMode('outro', null, 'mpesa')).toBe('manual');
    expect(getPaymentMode('paysuite', null, 'cash')).toBe('manual');
    expect(getPaymentMode('paysuite', null, 'outro')).toBe('manual');
  });
  it.each(['emola', 'emola_sim'])('encaminha %s directamente sem alterar M-Pesa', (provider) => {
    expect(getPaymentMode('mpesa', provider, 'emola')).toBe(provider);
    expect(getPaymentMode('mpesa', provider, 'mpesa')).toBe('mpesa');
    expect(getPaymentMode('mpesa', provider, 'credit_card')).toBe('manual');
  });
  it('e-Mola directo não exige um gateway base activo', () => {
    expect(getPaymentMode('manual', 'emola', 'emola')).toBe('emola');
    expect(getPaymentMode('manual', 'emola_sim', 'emola')).toBe('emola_sim');
  });
});
