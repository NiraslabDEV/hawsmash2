export const PAYSUITE_ERROR_MESSAGES_PT: Record<string, string> = {
  insufficient_balance: 'Saldo insuficiente na conta. Carrega a conta e tenta novamente.',
  invalid_phone:        'Número de telemóvel inválido. Confirma o número e tenta novamente.',
  pin_timeout:          'Tempo esgotado para confirmar o PIN no telemóvel. Tenta novamente.',
  card_declined:        'Cartão recusado. Verifica os dados ou usa outro método de pagamento.',
};

export const PAYSUITE_ERROR_FALLBACK_PT =
  'O pagamento falhou. Tenta novamente ou usa outro método.';

export function paysuiteErrorToPt(code: string | null | undefined): string {
  if (!code) return PAYSUITE_ERROR_FALLBACK_PT;
  return PAYSUITE_ERROR_MESSAGES_PT[code] ?? PAYSUITE_ERROR_FALLBACK_PT;
}
