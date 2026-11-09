const MZ_MOBILE = /^8[2-7]\d{7}$/;
const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Telemóvel moçambicano em E.164 com `+`, ou `null`.
 * Aceita o que se escreve de verdade: `84 123 4567`, `0841234567`, `+258 84 123 4567`, `00258841234567`.
 * Só móveis (82–87): um fixo não tem WhatsApp, e enviar para um número inventado gasta dinheiro.
 */
export function toWhatsAppPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (/[^\d\s+().-]/.test(raw)) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 12 && digits.startsWith('258')) digits = digits.slice(3);
  return MZ_MOBILE.test(digits) ? `+258${digits}` : null;
}

export function isE164(value: string): boolean {
  return E164.test(value);
}
