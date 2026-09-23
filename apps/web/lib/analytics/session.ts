/**
 * session.ts — identidade de sessão first-party do funil (§16 do motor).
 *
 * O `session_id` é a chave que o funil usa para agrupar (view `analytics_sessions`
 * faz GROUP BY session_id). Sem cookie, o /api/track gravava tudo como
 * 'unknown' e o painel mostrava sempre 1 sessão.
 *
 * Lógica pura, sem dependências do Next — o middleware e a rota /api/track
 * usam-na, e os testes correm-na sem browser. A origem do tráfego vive em
 * @/lib/attribution.ts.
 *
 * Privacidade: `dl_session` é 1st-party, opaco e sem PII. Existe mesmo sem
 * consentimento de marketing (16.7) — é medição interna, não é rastreio de
 * publicidade; os scripts de GTM/Pixel/Ads continuam gated pelo `dl_consent`.
 */

export const SESSION_COOKIE = 'dl_session';

/** 30 min de inatividade fecham a sessão — mesma convenção do GA4. */
export const SESSION_MAX_AGE = 30 * 60;

/** Só hex/`-`, 12–64 chars. 'unknown' e lixo são rejeitados por construção. */
const VALID_SESSION_ID = /^[a-f0-9-]{12,64}$/i;

export function newSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  // Fallback (runtimes sem randomUUID): timestamp + aleatório, ainda hex.
  return (
    Date.now().toString(16) + Math.random().toString(16).slice(2).padEnd(16, '0').slice(0, 16)
  );
}

/**
 * Devolve o id da sessão a usar. `isNew` diz ao chamador que tem de gravar o
 * cookie na resposta.
 */
export function resolveSessionId(existing: string | undefined | null): {
  id: string;
  isNew: boolean;
} {
  const raw = (existing ?? '').trim();
  if (raw && raw !== 'unknown' && VALID_SESSION_ID.test(raw)) {
    return { id: raw, isNew: false };
  }
  return { id: newSessionId(), isNew: true };
}
