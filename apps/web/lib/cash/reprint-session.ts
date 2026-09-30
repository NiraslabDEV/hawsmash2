import type { SupabaseClient } from '@supabase/supabase-js';

import { reprintDayErrorMessage } from './reprint-day';

/**
 * "Reimprimir" o fecho de um turno (1108) — o mesmo no painel e no POS.
 *
 * Sai na impressora do balcão, marcado REIMPRESSÃO, com os números que o
 * fecho congelou e os artigos vendidos (mesmo num turno de antes da 1095).
 * Cada toque leva uma chave própria; repetir a mesma chave não gasta mais papel.
 */
export type ReprintSessionResult = { ok: true; duplicate: boolean } | { ok: false; message: string };

export function reprintSessionErrorMessage(message?: string): string {
  const m = message ?? '';
  if (m.includes('session_not_found')) return 'Esse turno não é desta loja.';
  if (m.includes('session_still_open')) return 'Este turno ainda está aberto. Fecha-o primeiro — o talão sai sozinho.';
  if (m.includes('session_report_unreadable')) return 'Este turno é antigo e não tem o talão guardado. Chama o suporte.';
  if (m.includes('reprint_cash_session') && (m.includes('Could not find the function') || m.includes('PGRST202'))) {
    return 'A reimpressão do turno ainda não está disponível nesta loja. Chama o suporte.';
  }
  return reprintDayErrorMessage(m);
}

export async function reprintCashSession(
  supabase: SupabaseClient,
  sessionId: string,
  requestId: string = crypto.randomUUID(),
): Promise<ReprintSessionResult> {
  const { data, error } = await supabase.rpc('reprint_cash_session', {
    p_session_id: sessionId,
    p_request_id: requestId,
  });
  if (error) return { ok: false, message: reprintSessionErrorMessage(error.message) };
  return { ok: true, duplicate: (data as { duplicate?: boolean } | null)?.duplicate === true };
}
