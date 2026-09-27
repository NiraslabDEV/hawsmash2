import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';

type Settings = {
  host: string;
  port: number;
  username: string;
  password: string;
  from_name: string;
  from_email: string;
  reply_to: string;
};
export async function studioSmtp(storeId?: string): Promise<Settings | null> {
  try {
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    )
      return null;
    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await svc.rpc('email_smtp', {
      p_store_id: storeId ?? null,
    });
    return error ? null : (data as Settings | null);
  } catch {
    return null;
  }
}
function connection(settings: Settings) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.port === 465,
    requireTLS: true,
    auth: { user: settings.username, pass: settings.password },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}
export async function verifyStudioSmtp(storeId: string) {
  const settings = await studioSmtp(storeId);
  if (!settings)
    return {
      ok: false,
      error: 'Guarda e activa a configuração, incluindo a palavra-passe.',
    };
  const transport = connection(settings);
  try {
    await transport.verify();
    return { ok: true };
  } catch {
    return {
      ok: false,
      error:
        'A ligação SMTP falhou. Verifica servidor, porta, utilizador e palavra-passe.',
    };
  } finally {
    transport.close();
  }
}
export async function sendStudioMail(
  settings: Settings,
  input: {
    to: string;
    subject: string;
    html: string;
    messageId?: string;
    unsubscribeUrl?: string;
  },
) {
  const transport = connection(settings);
  try {
    const result = await transport.sendMail({
      from: { name: settings.from_name, address: settings.from_email },
      replyTo: settings.reply_to || undefined,
      to: input.to,
      subject: input.subject,
      html: input.html,
      messageId: input.messageId,
      ...(input.unsubscribeUrl
        ? { list: { unsubscribe: input.unsubscribeUrl } }
        : {}),
    });
    return result.accepted.length > 0
      ? { ok: true as const }
      : { ok: false as const, error: 'O servidor recusou o destinatário.' };
  } catch {
    return {
      ok: false as const,
      error:
        'Envio SMTP não confirmado. Verifica no fornecedor antes de voltar a enviar.',
    };
  } finally {
    transport.close();
  }
}
