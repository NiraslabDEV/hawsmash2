/**
 * Normalização do número de telemóvel para o M-Pesa.
 *
 * O M-Pesa quer o número em formato internacional sem `+` (`258841234567`). O
 * cliente escreve-o de vinte maneiras: com espaços, com `+`, com `00`, sem
 * indicativo, com o zero à frente que se usa noutros países.
 *
 * Isto é domínio puro e vive aqui, longe da rede, porque é onde os erros doem:
 * um número mal normalizado é um pedido de PIN que **chega ao telemóvel de
 * outra pessoa** — e o dinheiro entra na mesma.
 */

export class InvalidMsisdnError extends Error {
  constructor(readonly reason: 'empty' | 'not_mozambican' | 'not_vodacom' | 'wrong_length') {
    super(`msisdn_${reason}`);
    this.name = 'InvalidMsisdnError';
  }
}

/** Prefixos Vodacom Moçambique. O M-Pesa é da Vodacom: 82/83 (Tmcel) e 86/87 (Movitel) não entram. */
const VODACOM_PREFIXES = ['84', '85'];

/**
 * Devolve o número em formato `258XXXXXXXXX` ou lança `InvalidMsisdnError`.
 *
 * Lança em vez de devolver `null` de propósito: um número inválido não é um
 * caso a ignorar em silêncio — é um pagamento que não pode sequer ser tentado.
 */
export function normalizeMsisdn(input: string): string {
  const digits = (input ?? '').replace(/\D/g, '');
  if (!digits) throw new InvalidMsisdnError('empty');

  let national = digits;

  // 00258… (marcação internacional) e 258… (indicativo já lá)
  if (national.startsWith('00258')) national = national.slice(5);
  else if (national.startsWith('258')) national = national.slice(3);

  // Zero à frente do número nacional: hábito de quem marca noutros países.
  if (national.length === 10 && national.startsWith('0')) national = national.slice(1);

  if (national.length !== 9) throw new InvalidMsisdnError('wrong_length');

  const prefix = national.slice(0, 2);
  // Um número de outro país (ou lixo) não é "não-Vodacom": é outra coisa.
  if (!/^8[2-7]$/.test(prefix)) throw new InvalidMsisdnError('not_mozambican');
  if (!VODACOM_PREFIXES.includes(prefix)) throw new InvalidMsisdnError('not_vodacom');

  return `258${national}`;
}

/** Versão que não lança — para validar um campo enquanto o cliente escreve. */
export function isValidMsisdn(input: string): boolean {
  try {
    normalizeMsisdn(input);
    return true;
  } catch {
    return false;
  }
}

/** `258841234567` → `84 123 4567`, para mostrar ao cliente o que vai ser cobrado. */
export function formatMsisdn(msisdn: string): string {
  const national = msisdn.startsWith('258') ? msisdn.slice(3) : msisdn;
  if (national.length !== 9) return msisdn;
  return `${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
}

/** Mensagem em português para o cliente ler, por motivo de recusa. */
export const MSISDN_ERROR_PT: Record<InvalidMsisdnError['reason'], string> = {
  empty: 'Escreve o número de telemóvel onde queres confirmar o pagamento.',
  wrong_length: 'O número deve ter 9 dígitos, por exemplo 84 123 4567.',
  not_mozambican: 'Escreve um número moçambicano, começado por 84 ou 85.',
  not_vodacom: 'O M-Pesa só funciona em números Vodacom (84 ou 85).',
};
