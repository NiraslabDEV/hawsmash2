import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Sangria, reforço e despesa — **idempotentes** (1098).
 *
 * Cada movimento leva uma chave (`p_request_id`). Se a resposta se perder e o
 * operador tocar outra vez em "Registar" com o mesmo tipo, valor e motivo, a
 * chave é a mesma e o servidor devolve o movimento que já gravou — o esperado
 * em caixa não desce duas vezes. Mudar o valor ou o motivo gera chave nova.
 */
export function movementRequestKeeper() {
  let last: { key: string; id: string } | null = null;
  return {
    idFor(type: string, amountCents: number, reason: string): string {
      const key = `${type}|${amountCents}|${reason.trim()}`;
      if (!last || last.key !== key) last = { key, id: crypto.randomUUID() };
      return last.id;
    },
    /** Depois de gravar (ou de desistir): o próximo movimento é outro. */
    done() {
      last = null;
    },
  };
}

export interface CashMovementInput {
  store: string;
  type: string;
  amountCents: number;
  reason: string;
  requestId: string;
}

export async function addCashMovement(supabase: SupabaseClient, input: CashMovementInput) {
  const base = {
    p_store: input.store,
    p_type: input.type,
    p_amount_cents: input.amountCents,
    p_reason: input.reason.trim(),
  };
  const first = await supabase.rpc('add_cash_movement', { ...base, p_request_id: input.requestId });
  // Base ainda sem a 1098: o PostgREST não conhece o argumento novo. O
  // movimento grava como antes — a ordem do deploy não parte o caixa.
  const code = `${first.error?.code ?? ''} ${first.error?.message ?? ''}`;
  if (first.error && /PGRST202|Could not find the function/.test(code)) {
    return supabase.rpc('add_cash_movement', base);
  }
  return first;
}
