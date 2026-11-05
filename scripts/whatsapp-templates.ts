/**
 * Submete os templates do WhatsApp à Meta e mostra o estado da aprovação (ADR 0011/0012, plano §3.1 e §7).
 *
 *   npx tsx scripts/whatsapp-templates.ts --dry-run            # mostra o que seria enviado, não chama a Meta
 *   npx tsx scripts/whatsapp-templates.ts --status             # estado de cada template na WABA
 *   npx tsx scripts/whatsapp-templates.ts                      # submete os que ainda não existem
 *
 * Ambiente: META_WHATSAPP_TOKEN, META_WABA_ID, APP_BASE_URL (https, origem do botão "Acompanhar"),
 * META_GRAPH_VERSION (opcional). Nunca apaga nem edita um template existente: um texto mudado vai com nome novo.
 */
import { metaTemplatePayload, TEMPLATES, TEMPLATE_LANGUAGE } from "../apps/web/lib/whatsapp/templates";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const statusOnly = args.has("--status");
const version = process.env.META_GRAPH_VERSION?.trim() || "v23.0";
const baseUrl = process.env.APP_BASE_URL?.trim().replace(/\/+$/, "") ?? "";

function fail(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

async function graph(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const token = process.env.META_WHATSAPP_TOKEN?.trim();
  if (!token) fail("Falta META_WHATSAPP_TOKEN.");
  const res = await fetch(`https://graph.facebook.com/${version}/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const error = (body.error ?? {}) as Record<string, unknown>;
    throw new Error(`HTTP ${res.status} · ${error.code ?? ""} ${error.message ?? ""} ${((error.error_data ?? {}) as Record<string, unknown>).details ?? ""}`.trim());
  }
  return body;
}

async function existing(waba: string): Promise<Map<string, { status: string; reason: string | null }>> {
  const out = new Map<string, { status: string; reason: string | null }>();
  let next: string | null = `${waba}/message_templates?fields=name,language,status,rejected_reason&limit=100`;
  while (next) {
    const page = await graph(next);
    for (const t of (page.data ?? []) as Array<Record<string, string>>) {
      if (t.language === TEMPLATE_LANGUAGE) out.set(t.name, { status: t.status, reason: t.rejected_reason ?? null });
    }
    const after = ((page.paging ?? {}) as { cursors?: { after?: string }; next?: string });
    next = after.next && after.cursors?.after
      ? `${waba}/message_templates?fields=name,language,status,rejected_reason&limit=100&after=${after.cursors.after}` : null;
  }
  return out;
}

async function main() {
  if (!/^https:\/\/[^/]+$/.test(baseUrl)) fail("APP_BASE_URL tem de ser a origem https do site (ex.: https://exemplo.com).");
  if (dryRun) {
    for (const spec of TEMPLATES) console.log(JSON.stringify(metaTemplatePayload(spec, baseUrl), null, 2));
    console.log(`\n${TEMPLATES.length} templates (dry-run, nada enviado).`);
    return;
  }
  const waba = process.env.META_WABA_ID?.trim();
  if (!waba || !/^\d+$/.test(waba)) fail("Falta META_WABA_ID (id numérico da conta WhatsApp Business).");
  const current = await existing(waba);
  let failed = 0;
  for (const spec of TEMPLATES) {
    const found = current.get(spec.name);
    if (statusOnly || found) {
      console.log(`${found ? found.status.padEnd(10) : "EM FALTA  "} ${spec.name}${found?.reason && found.reason !== "NONE" ? ` — ${found.reason}` : ""}`);
      continue;
    }
    try {
      const created = await graph(`${waba}/message_templates`, { method: "POST", body: JSON.stringify(metaTemplatePayload(spec, baseUrl)) });
      console.log(`SUBMETIDO  ${spec.name} (${created.status ?? "PENDING"})`);
    } catch (error) {
      failed++;
      console.error(`✖ ${spec.name}: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (failed) process.exit(1);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
