import { timingSafeEqual } from 'node:crypto';

/**
 * Porta dos crons: **fechada por omissão**.
 *
 * Antes, sem `CRON_SECRET` preenchido, alerts/conversions/digest corriam para
 * quem os chamasse — qualquer pessoa disparava emails ao dono e drenava a fila
 * de conversões. Agora: sem segredo → 503; segredo errado → 401.
 * Devolve `null` quando a chamada pode seguir.
 */
export function cronUnauthorized(request: Request, secret = process.env.CRON_SECRET): Response | null {
  if (!secret) {
    return Response.json({ ok: false, error: 'cron_secret_not_configured' }, { status: 503 });
  }
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return new Response('unauthorized', { status: 401 });
  }
  return null;
}
