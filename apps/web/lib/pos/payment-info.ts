/**
 * Números de pagamento móvel da loja, dentro do POS.
 *
 * Vêm do `get_menu` — que já os devolve por loja — e ficam guardados em
 * `localStorage`. A cache não é comodismo: sem rede o balcão continua a vender
 * (CLAUDE §7.5) e o cliente continua a poder pagar por M-Pesa. Um número de
 * pagamento que só aparece com internet é um número que falha exactamente no
 * dia em que faz falta.
 *
 * Não são segredo: já saem no talão e já estão na loja online. O que é segredo
 * — as chaves do Paysuite — nunca chega ao browser (CLAUDE §5.6).
 */

import { formatMT, type Cents } from '@delivery/core';

export type PosPaymentInfo = {
  mpesaNumber: string | null;
  mpesaName: string | null;
  emolaNumber: string | null;
  emolaName: string | null;
};

export type MobilePaymentMethod = 'mpesa' | 'emola';

export const EMPTY_PAYMENT_INFO: PosPaymentInfo = {
  mpesaNumber: null,
  mpesaName: null,
  emolaNumber: null,
  emolaName: null,
};

const CACHE_PREFIX = 'hs_pos_payment_info:';

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Só dígitos. Os números chegam da BD escritos à mão ("84 795 5382",
 * "+258 870909080") e o que o cliente vai marcar no telemóvel são dígitos —
 * a formatação bonita faz-se aqui, uma vez, e não em cada ecrã.
 */
function cleanNumber(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '').replace(/^258/, '');
  return digits.length >= 8 ? digits : null;
}

/** `847955382` → `847 955 382`. Em grupos de três lê-se em voz alta sem enganos. */
export function formatMobileNumber(number: string): string {
  return number.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
}

export function parsePaymentInfo(payload: unknown): PosPaymentInfo {
  if (!payload || typeof payload !== 'object') return EMPTY_PAYMENT_INFO;
  const record = payload as Record<string, unknown>;
  return {
    mpesaNumber: cleanNumber(record.mpesa_number),
    mpesaName: cleanName(record.mpesa_name),
    emolaNumber: cleanNumber(record.emola_number),
    emolaName: cleanName(record.emola_name),
  };
}

export function readCachedPaymentInfo(storage: Storage, storeSlug: string): PosPaymentInfo | null {
  try {
    const raw = storage.getItem(`${CACHE_PREFIX}${storeSlug}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    return {
      mpesaNumber: cleanNumber(record.mpesaNumber),
      mpesaName: cleanName(record.mpesaName),
      emolaNumber: cleanNumber(record.emolaNumber),
      emolaName: cleanName(record.emolaName),
    };
  } catch {
    return null;
  }
}

export function writeCachedPaymentInfo(
  storage: Storage,
  storeSlug: string,
  info: PosPaymentInfo,
): void {
  try {
    storage.setItem(`${CACHE_PREFIX}${storeSlug}`, JSON.stringify(info));
  } catch {
    // Cache cheia ou bloqueada não pode travar o arranque do POS.
  }
}

export type PaymentInstructions = {
  label: string;
  /** Só dígitos — é o que se marca. */
  number: string;
  /** Já agrupado, para se ler em voz alta. */
  prettyNumber: string;
  holder: string | null;
  ussd: string;
  amount: string;
  steps: string[];
};

/**
 * O guião que o operador lê ao cliente e que aparece no visor virado para ele.
 *
 * O código USSD é da operadora, não do HAWSMASH: `*150#` na Vodacom (M-Pesa) e
 * `*898#` na Movitel (e-Mola). O **número** vem sempre da loja, nunca daqui —
 * ver `stores.mpesa_number` / `stores.emola_number` (CLAUDE §5.1).
 */
export function paymentInstructions(
  method: MobilePaymentMethod,
  info: PosPaymentInfo,
  amountCents: number,
): PaymentInstructions | null {
  const number = method === 'mpesa' ? info.mpesaNumber : info.emolaNumber;
  if (!number) return null;

  const holder = method === 'mpesa' ? info.mpesaName : info.emolaName;
  const label = method === 'mpesa' ? 'M-Pesa' : 'e-Mola';
  const ussd = method === 'mpesa' ? '*150#' : '*898#';
  const amount = formatMT(amountCents as Cents);
  const prettyNumber = formatMobileNumber(number);

  return {
    label,
    number,
    prettyNumber,
    holder,
    ussd,
    amount,
    steps: [
      `Marcar ${ussd} no telemóvel`,
      method === 'mpesa'
        ? 'Escolher "Transferências" → "Enviar dinheiro"'
        : 'Escolher "Transferir dinheiro"',
      `Número: ${prettyNumber}${holder ? ` (${holder})` : ''}`,
      `Valor: ${amount}`,
      'Confirmar com o PIN e mostrar a SMS',
    ],
  };
}
