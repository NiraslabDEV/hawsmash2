// Relé de email (ADR 0010): o site no Railway não pode abrir SMTP (bloqueado
// fora do plano Pro), o Supabase pode — era daqui que o 1.0 enviava. O site
// chama esta função por HTTPS e ela entrega pela caixa Hostinger do dono.
//
// Só o servidor do site a chama: exige o segredo partilhado em
// `x-relay-secret`. O remetente é sempre o da instalação (EMAIL_FROM), nunca
// o que vem no pedido — a função não serve para enviar em nome de outro.
import nodemailer from "npm:nodemailer@6.9.13";

const SECRET = Deno.env.get("EMAIL_RELAY_SECRET") ?? "";
const SMTP_USER = Deno.env.get("SMTP_USER") ?? "";
const SMTP_PASS = Deno.env.get("SMTP_PASS") ?? "";
const FROM = Deno.env.get("EMAIL_FROM") || SMTP_USER;

const transporter = nodemailer.createTransport({
  host: Deno.env.get("SMTP_HOST") || "smtp.hostinger.com",
  port: Number(Deno.env.get("SMTP_PORT")) || 465,
  secure: true,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
});

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Comparação em tempo constante: o segredo não se adivinha pela demora. */
function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });
  if (SECRET.length < 32 || !sameSecret(req.headers.get("x-relay-secret") ?? "", SECRET)) {
    return json(401, { ok: false, error: "unauthorized" });
  }
  if (!SMTP_USER || !SMTP_PASS || !FROM) {
    return json(503, { ok: false, error: "smtp_not_configured" });
  }

  const body = await req.json().catch(() => null) as
    | { to?: unknown; subject?: unknown; html?: unknown }
    | null;
  const to = Array.isArray(body?.to) ? body.to : [];
  if (
    to.length < 1 || to.length > 50 ||
    !to.every((r) => typeof r === "string" && EMAIL.test(r)) ||
    typeof body?.subject !== "string" || body.subject.length > 300 ||
    typeof body?.html !== "string" || body.html.length > 500_000
  ) {
    return json(400, { ok: false, error: "invalid_payload" });
  }

  try {
    const info = await transporter.sendMail({
      from: FROM,
      to: to as string[],
      subject: body.subject,
      html: body.html,
    });
    return info.accepted.length > 0
      ? json(200, { ok: true })
      : json(502, { ok: false, error: "smtp_rejected_all" });
  } catch (error) {
    return json(502, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
