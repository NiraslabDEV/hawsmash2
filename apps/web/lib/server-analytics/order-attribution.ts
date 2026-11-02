import {
  FIRST_TOUCH_COOKIE,
  LAST_TOUCH_COOKIE,
  SESSION_COOKIE,
  attributionPayload,
  decodeTouch,
  readCookie,
} from '@/lib/attribution';
import { firstForwardedIp } from '@/lib/server-analytics/user-data';

/** O que isto precisa do cliente Supabase — o do servidor serve, o dos testes também. */
interface AttributionRpcClient {
  rpc(fn: 'record_order_attribution', args: { p_order_id: string; p_payload: Record<string, unknown> }):
    PromiseLike<{ error: unknown }>;
}

/**
 * Liga o pedido à origem que o trouxe. É deliberadamente um passo separado e
 * best-effort (CLAUDE.md §1.1): a atribuição é marketing, a venda é dinheiro.
 * Se isto falhar, o pedido continua criado e impresso — perde-se a linha do
 * relatório, nunca a venda. Por isso não entra dentro de `create_order`.
 *
 * Todas as rotas que criam pedidos online chamam isto: o comprovativo
 * (/api/create-order) e o pagamento automático (/api/payments). Sem a
 * segunda, todo o pedido pago por M-Pesa/e-Mola aparecia como "Directo".
 */
export async function recordOrderAttribution(
  supabase: AttributionRpcClient,
  orderId: string,
  headers: Headers,
): Promise<void> {
  try {
    const cookieHeader = headers.get('cookie');
    const first = decodeTouch(readCookie(cookieHeader, FIRST_TOUCH_COOKIE));
    const last = decodeTouch(readCookie(cookieHeader, LAST_TOUCH_COOKIE));
    if (!first && !last) return;

    const { error } = await supabase.rpc('record_order_attribution', {
      p_order_id: orderId,
      p_payload: {
        ...attributionPayload(first, last),
        session_id: readCookie(cookieHeader, SESSION_COOKIE),
        // Identificação técnica que a Meta CAPI usa para fazer match (1030).
        // É aqui que se apanha, porque é o último momento em que existe um
        // pedido HTTP do próprio cliente — depois disto só há servidor.
        fbp: readCookie(cookieHeader, '_fbp'),
        client_ip: firstForwardedIp(headers.get('x-forwarded-for')),
        user_agent: headers.get('user-agent'),
        event_source_url: headers.get('referer'),
      },
    });
    if (error) console.error('[attribution]', error);
  } catch (err) {
    console.error('[attribution]', err);
  }
}
