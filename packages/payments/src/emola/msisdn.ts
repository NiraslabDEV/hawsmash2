export class InvalidEmolaMsisdnError extends Error {
  constructor(readonly reason: 'empty' | 'invalid_format' | 'wrong_length' | 'not_mozambican') {
    super(`emola_msisdn_${reason}`);
    this.name = 'InvalidEmolaMsisdnError';
  }
}

/**
 * Preparação local: valida apenas o formato móvel 258 + nove dígitos começados
 * por 8. Não comprova operadora, titular ou existência de uma carteira e-Mola.
 * O contrato directo da Movitel ainda tem de confirmar as regras do fornecedor.
 */
export function normalizeEmolaMsisdn(input: string): string {
  if (typeof input !== 'string') throw new InvalidEmolaMsisdnError('invalid_format');
  const value = input.trim();
  if (!value) throw new InvalidEmolaMsisdnError('empty');
  if (!/^\+?[\d\s()-]+$/.test(value)) throw new InvalidEmolaMsisdnError('invalid_format');
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00258')) digits = digits.slice(5);
  else if (digits.startsWith('258')) digits = digits.slice(3);
  else if (value.startsWith('+') || digits.startsWith('00')) throw new InvalidEmolaMsisdnError('not_mozambican');
  if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length !== 9) throw new InvalidEmolaMsisdnError('wrong_length');
  if (!/^8\d{8}$/.test(digits)) throw new InvalidEmolaMsisdnError('not_mozambican');
  return `258${digits}`;
}

export const EMOLA_MSISDN_ERROR_PT: Record<InvalidEmolaMsisdnError['reason'], string> = {
  empty: 'Escreve o número de telemóvel associado à tua carteira e-Mola.',
  invalid_format: 'Escreve apenas o número de telemóvel, com o indicativo +258 se necessário.',
  wrong_length: 'O número deve ter 9 dígitos depois do indicativo +258.',
  not_mozambican: 'Escreve um número móvel moçambicano, com 9 dígitos começados por 8.',
};
