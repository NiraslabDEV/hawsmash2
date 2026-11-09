import { NextResponse } from "next/server";
import { cronUnauthorized } from "@/lib/cron/auth";
import { serviceClient } from "@/lib/payments/direct";
import { whatsappTransport } from "@/lib/whatsapp/config";
import { dispatchWhatsApp } from "@/lib/whatsapp/dispatch";
import { renderWhatsAppEvent } from "@/lib/whatsapp/events";
import { aiInterpreterFromEnv } from "@/lib/whatsapp/pedido/ai";
import { processPendingInbound, publicBaseUrl } from "@/lib/whatsapp/pedido/run";

export const dynamic = "force-dynamic";

const interpret = aiInterpreterFromEnv();

// A cada minuto (ADR 0011, 0012): conversas que ficaram a meio, depois a fila (avisos e respostas).
// Sem transporte configurado não reclama nada: a fila espera.
export async function GET(request: Request) {
  const denied = cronUnauthorized(request);
  if (denied) return denied;
  const transport = whatsappTransport();
  if (!transport)
    return NextResponse.json({ ok: false, error: "whatsapp_not_configured" }, { status: 503 });
  const svc = serviceClient();
  let conversations = { processed: 0, failed: 0 };
  try {
    conversations = await processPendingInbound({ svc, transport, baseUrl: publicBaseUrl(request), interpret });
  } catch {
    // Conversas em atraso não podem impedir os avisos de sair.
  }
  try {
    const summary = await dispatchWhatsApp({ svc, transport, render: renderWhatsAppEvent });
    const failed = summary.failed + conversations.failed;
    return NextResponse.json({ ok: failed === 0, ...summary, conversations }, { status: failed ? 502 : 200 });
  } catch {
    return NextResponse.json({ error: "Não foi possível ler a fila." }, { status: 503 });
  }
}
