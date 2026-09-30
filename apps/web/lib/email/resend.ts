import type { SendMailResult } from "./transport";

/**
 * Envio por HTTPS (Resend) — ADR 0009.
 *
 * O Railway corta a saída SMTP (465/587/2525) fora do plano Pro: do contentor
 * de produção nem a Hostinger nem o Gmail respondem, e o HTTPS (443) sai. Com
 * `RESEND_API_KEY` definida, os emails do sistema saem por aqui; sem ela, o
 * transporte volta ao SMTP da ADR 0004. Trocar é mudar uma variável.
 *
 * Nunca lança (CLAUDE §1): devolve `{ ok:false, error }` como o SMTP.
 */

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export async function sendViaResend(
  input: { from: string; to: string[]; subject: string; html: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SendMailResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { ok: false, error: "resend_not_configured" };
  try {
    const response = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) return { ok: true };
    const body = (await response.json().catch(() => null)) as {
      message?: unknown;
    } | null;
    const detail = typeof body?.message === "string" ? `: ${body.message}` : "";
    return { ok: false, error: `resend_${response.status}${detail}` };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
