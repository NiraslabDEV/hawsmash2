import { prepareSystemEmail, logSystemEmail } from "./system-runtime";
import type { SystemEmailKey } from "./system-catalog";
import nodemailer, { type Transporter } from "nodemailer";
import { studioSmtp, sendStudioMail } from "./studio-transport";

/**
 * Envio transacional por SMTP (Hostinger) — ADR 0004. Substitui o Resend: o
 * 1.0 já usa a caixa de email do próprio dono na Hostinger e funciona bem.
 *
 * Falha de email nunca é fatal (CLAUDE §1) — `sendMail` nunca lança, devolve
 * `{ ok:false, error }` e quem chama decide se isso bloqueia alguma coisa
 * (normalmente não bloqueia nada).
 */

let transporter: Transporter | null = null;

export async function isEmailConfigured(): Promise<boolean> {
  return (
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

  // Sem EMAIL_FROM sai o endereço nu, sem nome de exibição. O nome que estava
  // aqui era o de um cliente: outra instalação mandava emails assinados com a
  // marca errada (CLAUDE.md §18.3). Quem quer nome bonito preenche EMAIL_FROM.
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
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
