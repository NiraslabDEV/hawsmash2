import { createMetaTransport, createMockTransport, createTyxterTransport, type WhatsAppTransport } from "@delivery/whatsapp";

/**
 * Transporte escolhido pelo ambiente. `null` = WhatsApp desligado: o cron não reclama a fila e o
 * webhook responde 503, sem tocar em nada.
 *
 * - `WHATSAPP_PROVIDER=meta` (ADR 0012): `META_WHATSAPP_TOKEN` + `META_APP_SECRET` +
 *   `META_WEBHOOK_VERIFY_TOKEN` (`META_GRAPH_VERSION` opcional)
 * - `WHATSAPP_PROVIDER=tyxter`: `TYXTER_API_KEY` + `TYXTER_WEBHOOK_SECRET` (`TYXTER_API_BASE_URL` opcional)
 * - `WHATSAPP_PROVIDER=mock` só fora de produção: em produção aceitaria mensagens sem enviar nenhuma.
 */
export function whatsappTransport(env: NodeJS.ProcessEnv = process.env): WhatsAppTransport | null {
  const provider = (env.WHATSAPP_PROVIDER ?? "").trim().toLowerCase();
  if (provider === "meta") {
    const accessToken = env.META_WHATSAPP_TOKEN?.trim();
    const appSecret = env.META_APP_SECRET?.trim();
    const verifyToken = env.META_WEBHOOK_VERIFY_TOKEN?.trim();
    // Um verify token curto adivinha-se: o aperto de mão do webhook deixava qualquer um registar-se.
    if (!accessToken || !appSecret || !verifyToken || verifyToken.length < 16) return null;
    return createMetaTransport({
      accessToken, appSecret, verifyToken, graphVersion: env.META_GRAPH_VERSION?.trim() || undefined,
    });
  }
  if (provider === "tyxter") {
    const apiKey = env.TYXTER_API_KEY?.trim();
    const webhookSecret = env.TYXTER_WEBHOOK_SECRET?.trim();
    if (!apiKey || !webhookSecret || !/^tx_(sandbox|live)_/.test(apiKey)) return null;
    return createTyxterTransport({ apiKey, webhookSecret, baseUrl: env.TYXTER_API_BASE_URL?.trim() || undefined });
  }
  if (provider === "mock" && env.NODE_ENV !== "production") {
    return createMockTransport(env.TYXTER_WEBHOOK_SECRET?.trim() || undefined);
  }
  return null;
}
