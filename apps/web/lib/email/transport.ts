import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Envio transacional por SMTP (Hostinger) — ADR 0004. Substitui o Resend: o
 * 1.0 já usa a caixa de email do próprio dono na Hostinger e funciona bem.
 *
 * Falha de email nunca é fatal (CLAUDE §1) — `sendMail` nunca lança, devolve
 * `{ ok:false, error }` e quem chama decide se isso bloqueia alguma coisa
 * (normalmente não bloqueia nada).
 */

let transporter: Transporter | null = null;

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.hostinger.com',
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
};

export type SendMailResult = { ok: true } | { ok: false; error: string };

export async function sendMail({ to, subject, html }: SendMailInput): Promise<SendMailResult> {
  if (!isEmailConfigured()) return { ok: false, error: 'smtp_not_configured' };

  const from = process.env.EMAIL_FROM || `"HAWSMASH" <${process.env.SMTP_USER}>`;
  try {
    await getTransporter().sendMail({ from, to, subject, html });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
