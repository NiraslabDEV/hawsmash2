import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * "Reimprimir" um fecho do dia (1100) — o mesmo no painel e no POS.
 *
 * Sai na impressora do balcão, marcado REIMPRESSÃO, com os artigos vendidos
 * (mesmo num fecho feito antes da 1095). Cada toque leva uma chave própria;
 * repetir a mesma chave não gasta mais papel.
 */
export type ReprintDayResult = { ok: true; duplicate: boolean } | { ok: false; message: string };

export function reprintDayErrorMessage(message?: string): string {
  const m = message ?? '';
  if (m.includes('cash_access_denied')) return 'O teu perfil não pode reimprimir o fecho. Chama o gerente.';
  if (m.includes('day_close_not_found')) return 'Esse fecho do dia não é desta loja.';
  if (m.includes('not_authenticated')) return 'A sessão expirou. Entra outra vez.';
  // A 1100 ainda não aplicada nesta base: o PostgREST não encontra a função.
  if (m.includes('Could not find the function') || m.includes('PGRST202')) {
    return 'A reimpressão ainda não está disponível nesta loja. Chama o suporte.';
  }
  if (/fetch|network|timeout/i.test(m)) return 'Sem ligação ao servidor. Tenta outra vez.';
  return 'Não foi possível reimprimir. Tenta outra vez.';
}

export async function reprintCashDay(
  supabase: SupabaseClient,
  dayCloseId: string,
  requestId: string = crypto.randomUUID(),
): Promise<ReprintDayResult> {
  const { data, error } = await supabase.rpc('reprint_cash_day', {
    p_day_close_id: dayCloseId,
    p_request_id: requestId,
  });
  if (error) return { ok: false, message: reprintDayErrorMessage(error.message) };
  return { ok: true, duplicate: (data as { duplicate?: boolean } | null)?.duplicate === true };
}
