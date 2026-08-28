import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';
import {
  FIRST_TOUCH_COOKIE,
  LAST_TOUCH_COOKIE,
  SESSION_COOKIE,
  attributionPayload,
  decodeTouch,
  readCookie,
} from '@/lib/attribution';
import { firstForwardedIp } from '@/lib/server-analytics/user-data';
import { InvalidStoreSlugError, resolveStoreSlug } from '@/lib/store-context';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Liga o pedido à origem que o trouxe. É deliberadamente um passo separado e
 * best-effort (CLAUDE.md §1.1): a atribuição é marketing, a venda é dinheiro.
 * Se isto falhar, o pedido continua criado e impresso — perde-se a linha do
 * relatório, nunca a venda. Por isso não entra dentro de `create_order`.
 */
async function recordAttribution(
  supabase: SupabaseServerClient,
  orderId: string,
  headers: Headers,
) {
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

function translateError(msg: string): string {
  if (msg.startsWith('out_of_stock:'))   return 'Um ou mais itens do teu pedido estão esgotados. Volta ao cardápio e ajusta a quantidade.';
  if (msg.startsWith('item_unavailable:')) return 'Um item do teu pedido deixou de estar disponível. Volta ao cardápio e remove-o.';
  if (msg.startsWith('invalid_variant:'))  return 'O tamanho escolhido já não está disponível. Volta ao cardápio e escolhe outro.';
  if (msg.startsWith('invalid_addon:'))    return 'Um dos adicionais escolhidos já não está disponível. Volta ao cardápio e ajusta.';
  if (msg === 'store_closed')             return 'A loja está encerrada de momento.';
  if (msg === 'store_not_found')          return 'Loja inválida.';
  if (msg === 'store_not_accepting_orders') return 'Esta loja não está a aceitar pedidos neste momento.';
  if (msg === 'delivery_zone_store_mismatch') return 'A zona de entrega não pertence à loja escolhida.';
  if (msg === 'empty_order')              return 'O carrinho está vazio.';
  if (msg === 'invalid_customer_name')    return 'Nome inválido.';
  if (msg === 'delivery_zone_required')   return 'Seleciona uma zona de entrega.';
  if (msg === 'delivery_address_required') return 'Indica a morada de entrega.';
  if (msg === 'scheduled_for_must_be_future') return 'O horário agendado deve ser no futuro.';
  if (msg === 'scheduled_for_outside_hours')  return 'Horário fora do período de funcionamento.';
  if (msg === 'scheduled_for_invalid_slot')   return 'Horário inválido. Escolhe um dos slots disponíveis.';
  if (msg === 'referral_invalid_or_expired')  return 'Código de referral inválido ou expirado.';
  if (msg === 'referral_auto_redemption')     return 'Não podes usar o teu próprio código de referral.';
  if (msg === 'referral_already_redeemed')    return 'Já usaste este código de referral.';
  if (msg === 'referral_max_redemptions')     return 'Este código de referral já atingiu o limite de utilizações.';
  if (msg === 'gift_item_not_authorized')     return 'Item de brinde não autorizado. Aplica um código válido primeiro.';
  if (msg === 'gift_item_max_one')            return 'Só é permitida 1 unidade do item de brinde.';
  if (msg === 'table_required')               return 'Mesa em falta. Lê o QR code novamente.';
  if (msg === 'invalid_table')                return 'Mesa inválida ou inativa. Chama um funcionário.';
  if (msg.startsWith('invalid_modifier_selection:')) return `Verifica as opções de "${msg.split(':')[1]}" — número de escolhas inválido.`;
  if (msg.startsWith('invalid_modifier_option:'))    return 'Uma das opções escolhidas já não está disponível.';
  return msg;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const payload = await request.json();
    const storeSlug = resolveStoreSlug(payload?.storeSlug);

    const { data, error } = await supabase.rpc('create_order', {
      p_store_slug: storeSlug,
      p_payload: payload,
    });

    if (error) {
      console.error('Error creating order:', error);
      return NextResponse.json({ error: translateError(error.message) }, { status: 400 });
    }

    if (typeof data === 'string') {
      await recordAttribution(supabase, data, request.headers);
    }

    return NextResponse.json({ orderId: data });
  } catch (error) {
    if (error instanceof InvalidStoreSlugError) {
      return NextResponse.json({ error: 'Loja inválida.' }, { status: 400 });
    }
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Erro interno. Tenta novamente.' }, { status: 500 });
  }
}
