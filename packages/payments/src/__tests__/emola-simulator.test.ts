import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmolaSimulator } from '../emola/simulator';
import { InvalidEmolaMsisdnError, normalizeEmolaMsisdn } from '../emola/msisdn';

afterEach(() => vi.unstubAllGlobals());

describe('formato do telemóvel para preparação e-Mola', () => {
  it.each(['86 123 4567', '861234567', '+258 86 123 4567', '00258861234567', '258861234567', '0861234567'])('normaliza %s sem alterar os dígitos', (input) => {
    expect(normalizeEmolaMsisdn(input)).toBe('258861234567');
  });
  it('valida apenas formato, sem afirmar que um número possui carteira e-Mola', () => {
    expect(normalizeEmolaMsisdn('841234567')).toBe('258841234567');
    expect(normalizeEmolaMsisdn('871234567')).toBe('258871234567');
  });
  it.each(['', '   ', '86123456', '8612345678', '+27861234567', '911234567', 'abc861234567', '86+1234567', '86.1234567', '86/1234567'])('recusa entrada ambígua ou inválida %s', (input) => {
    expect(() => normalizeEmolaMsisdn(input)).toThrow(InvalidEmolaMsisdnError);
  });
});

describe('e-Mola simulado sem rede', () => {
  const input = { amountCents: 12345, msisdn: '258861234565', reference: 'PLACEHOLDER_REFERENCE', description: 'Ensaio sintético' };
  it('paga apenas no simulador, com códigos explicitamente sintéticos', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const provider = new EmolaSimulator();
    expect(provider.flow).toBe('direct');
    const result = await provider.charge(input);
    expect(result).toMatchObject({ status: 'success', code: 'SIM_EMOLA_SUCCESS' });
    expect(result.message).toMatch(/simulado/i);
    expect(result.providerRef).toMatch(/^SIM_EMOLA_SUCCESS_/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['6', '7'])('ensaia falha definitiva com número terminado em %s', async (last) => {
    const result = await new EmolaSimulator().charge({ ...input, msisdn: `25886123456${last}` });
    expect(result).toMatchObject({ status: 'failed', code: 'SIM_EMOLA_FAILED' });
    expect(await new EmolaSimulator().getPaymentStatus(result.providerRef!)).toBe('failed');
  });
  it('ensaia resposta perdida e confirmação posterior noutro processo', async () => {
    const result = await new EmolaSimulator().charge({ ...input, msisdn: '258861234568' });
    expect(result).toMatchObject({ status: 'pending', code: 'SIM_EMOLA_PENDING_THEN_SUCCESS' });
    expect(await new EmolaSimulator().getPaymentStatus(result.providerRef!)).toBe('success');
  });
  it('incerteza persistente nunca passa automaticamente a falha', async () => {
    const result = await new EmolaSimulator().charge({ ...input, msisdn: '258861234569' });
    expect(result.status).toBe('pending');
    expect(await new EmolaSimulator().getPaymentStatus(result.providerRef!)).toBe('pending');
  });
  it('repetir a mesma tentativa conserva o resultado e a referência', async () => {
    const provider = new EmolaSimulator();
    expect(await provider.charge(input)).toEqual(await provider.charge(input));
  });
  it.each(['PLACEHOLDER_UNKNOWN', 'SIM_EMOLA_SUCCESS_', 'SIM_EMOLA_SUCCESS_@@@', 'SIM_EMOLA_FAILED_@@@'])('não confirma referência real/desconhecida/malformada %s', async (reference) => {
    expect(await new EmolaSimulator().getPaymentStatus(reference)).toBe('pending');
  });
  it('respeita consulta cancelada', async () => {
    const result = await new EmolaSimulator().charge(input);
    const signal = AbortSignal.abort();
    expect(await new EmolaSimulator().getPaymentStatus(result.providerRef!, { signal })).toBe('pending');
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('recusa centavos inválidos %s', async (amountCents) => {
    await expect(new EmolaSimulator().charge({ ...input, amountCents })).rejects.toThrow();
  });
  it('recusa número e referência inválidos antes da simulação', async () => {
    await expect(new EmolaSimulator().charge({ ...input, msisdn: 'invalid' })).rejects.toThrow();
    await expect(new EmolaSimulator().charge({ ...input, reference: '' })).rejects.toThrow();
  });
});
