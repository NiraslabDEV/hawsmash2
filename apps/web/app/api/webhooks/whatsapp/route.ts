import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/payments/direct";
import { whatsappTransport } from "@/lib/whatsapp/config";
import { handleWhatsAppChallenge, handleWhatsAppWebhook } from "@/lib/whatsapp/dispatch";
import { aiInterpreterFromEnv } from "@/lib/whatsapp/pedido/ai";
import { processInbound, publicBaseUrl } from "@/lib/whatsapp/pedido/run";

export const dynamic = "force-dynamic";

// Uma instância por processo: guarda o texto do cardápio para a cache do prompt.
const interpret = aiInterpreterFromEnv();

// A Meta confirma o endereço com um GET antes de mandar eventos (hub.challenge).
export async function GET(request: Request) {
  const transport = whatsappTransport();
  if (!transport) return new Response("whatsapp_not_configured", { status: 503 });
  const result = handleWhatsAppChallenge(transport, new URL(request.url));
  return new Response(result.body, { status: result.status, headers: { "content-type": "text/plain" } });
}

// Estados de entrega, mensagens recebidas e opt-out (ADR 0011, 0012). Assinatura verificada no corpo cru.
export async function POST(request: Request) {
  const transport = whatsappTransport();
  if (!transport) return new Response("whatsapp_not_configured", { status: 503 });
  const rawBody = await request.text();
  const svc = serviceClient();
  const result = await handleWhatsAppWebhook({ svc, transport, rawBody, headers: request.headers });

  if (result.inbound.length) {
    // As conversas respondem já. Se demorar (IA, rede), a Meta recebe o 200 na mesma ao fim de 8 s e o
    // processamento continua no processo (servidor Node persistente); o que morrer a meio o cron apanha.
    const deps = { svc, transport, baseUrl: publicBaseUrl(request), interpret };
    const work = (async () => { for (const id of result.inbound) await processInbound(deps, id); })()
      .catch((error) => console.error("[whatsapp] process failed:", error));
    await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 8_000))]);
  }
  return NextResponse.json(result.body, { status: result.status });
}
