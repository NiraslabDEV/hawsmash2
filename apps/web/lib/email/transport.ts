import { prepareSystemEmail, logSystemEmail } from "./system-runtime";
import type { SystemEmailKey } from "./system-catalog";
import nodemailer, { type Transporter } from "nodemailer";
import { relayConfigured, sendViaRelay } from "./relay";
import { resendConfigured, sendViaResend } from "./resend";
import { studioSmtp, sendStudioMail } from "./studio-transport";

/**
 * Envio transacional. Por ordem:
 *   1. o relé no Supabase, se houver `EMAIL_RELAY_SECRET` — a caixa Hostinger
 *      do dono, sem limite diário de terceiros (ADR 0010);
 *   2. Resend por HTTPS, se houver `RESEND_API_KEY` — também a reserva quando
 *      o relé falha (ADR 0009 — o Railway bloqueia SMTP fora do plano Pro);
 *   3. o SMTP da loja configurado no painel (módulo de emails, 1104);
 *   4. o SMTP do servidor, `SMTP_USER`/`SMTP_PASS` (Hostinger, ADR 0004).
 *
 * Falha de email nunca é fatal (CLAUDE §1) — `sendMail` nunca lança, devolve
 * `{ ok:false, error }` e quem chama decide se isso bloqueia alguma coisa
 * (normalmente não bloqueia nada).
 */

let transporter: Transporter | null = null;

export async function isEmailConfigured(): Promise<boolean> {
  return (
    relayConfigured() ||
    resendConfigured() ||
    Boolean(process.env.SMTP_USER && process.env.SMTP_PASS) ||
    Boolean(await studioSmtp())
  );
}

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.hostinger.com",
      port: Number(process.env.SMTP_PORT) || 465,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      // Sem isto o nodemailer espera 2 min pela ligação — e quem chama fica
      // preso (checkout do comprovativo encravado a 28/09 com SMTP bloqueado).
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return transporter;
}

export type SendMailInput = {
  to: string | string[];
  subject: string;
  html: string;
  storeId?: string;
  event?: SystemEmailKey;
  variables?: Record<string, string>;
};

export type SendMailResult = { ok: true } | { ok: false; error: string };

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const prepared = await prepareSystemEmail(input);
  const result = prepared.enabled
    ? await deliver({ ...input, ...prepared, storeId: input.storeId })
    : { ok: false as const, error: "email_disabled" };
  await logSystemEmail(
    input.event,
    prepared.storeId,
    Array.isArray(input.to) ? input.to : [input.to],
    !prepared.enabled ? "disabled" : result.ok ? "sent" : "failed",
  );
  return result;
}
async function deliver({
  to,
  subject,
  html,
  storeId,
}: SendMailInput): Promise<SendMailResult> {
  // Sem EMAIL_FROM sai o endereço nu, sem nome de exibição. O nome que estava
  // aqui era o de um cliente: outra instalação mandava emails assinados com a
  // marca errada (CLAUDE.md §18.3). Quem quer nome bonito preenche EMAIL_FROM.
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
  const recipients = Array.isArray(to) ? to : [to];

  // O remetente do relé é o da função (EMAIL_FROM lá), não o daqui.
  let relayError: string | null = null;
  if (relayConfigured()) {
    const viaRelay = await sendViaRelay({ to: recipients, subject, html });
    if (viaRelay.ok) return viaRelay;
    relayError = viaRelay.error;
    console.error("[email] relé falhou, a tentar a reserva:", relayError);
  }

  // O Resend só aceita remetentes do domínio verificado lá — EMAIL_FROM.
  if (resendConfigured()) {
    if (!from) return { ok: false, error: "email_from_not_configured" };
    const viaResend = await sendViaResend({ from, to: recipients, subject, html });
    if (viaResend.ok || !relayError) return viaResend;
    return { ok: false, error: `${relayError}; ${viaResend.error}` };
  }
  // Com relé configurado, o SMTP daqui está bloqueado: não vale a pena esperar.
  if (relayError) return { ok: false, error: relayError };

  const configured = await studioSmtp(storeId);
  if (configured) {
    const results = await Promise.all(
      (Array.isArray(to) ? to : [to]).map((recipient) =>
        sendStudioMail(configured, { to: recipient, subject, html }),
      ),
    );
    return results.find((result) => !result.ok) ?? { ok: true };
  }
  if (!(process.env.SMTP_USER && process.env.SMTP_PASS))
    return { ok: false, error: "smtp_not_configured" };

  try {
    await getTransporter().sendMail({ from, to, subject, html });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
