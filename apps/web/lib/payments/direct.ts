import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import { isDirectProvider, type DirectChargeResult, type PaymentProvider } from '@delivery/payments';

import { confirmOrderPaid } from './confirm';

/**
 * Cobrança directa: o que acontece **depois** de o fornecedor responder.
 *
 * Está separado da rota HTTP porque é aqui que moram as decisões que não podem
 * variar entre caminhos — e porque é o que se consegue testar sem levantar um
 * servidor.
 *
 * As três decisões, por ordem de quanto custa errar:
 *
 * 1. **`pending` deixa o pedido onde está.** Não se marca falhado, não se
 *    devolve o cliente ao carrinho, não se roda a referência. O dinheiro pode
 *    ter saído; quem decide é o fornecedor quando lhe perguntarmos.
 * 2. **`failed` passa pela transição de domínio.** A referência conserva-se
 *    para consulta: a tentativa de checkout já foi reclamada uma única vez.
 * 3. **`success` confirma pelo caminho comum**, com a chave de idempotência do
 *    pedido — a mesma do webhook e do cron.
 */

export type DirectOutcome = 'paid' | 'pending' | 'failed' | 'cancelled';

export interface DirectChargeOutcome {
  status: DirectOutcome;
  /** Mensagem já em português, pronta a mostrar. */
  message: string;
  /** Código do gateway — para o painel e para os logs, não para o cliente. */
  code: string | null;
}

export interface RunDirectChargeInput {
  svc: SupabaseClient;
  provider: PaymentProvider;
  providerName: string;
  order: {
    id: string;
    store_id: string;
    total_cents: number;
    payment_method: string | null;
    order_number?: string | null;
    customer_email?: string | null;
    customer_name?: string | null;
  };
  msisdn: string;
  origin?: string;
}

export function serviceClient(options?: { signal?: AbortSignal }): SupabaseClient {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
      ...(options?.signal ? { global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, options.signal!]) : options.signal }) } } : {}),
    },
  );
}

export async function runDirectCharge(
  input: RunDirectChargeInput,
): Promise<DirectChargeOutcome> {
  const { svc, provider, providerName, order, msisdn, origin } = input;

  if (!isDirectProvider(provider)) {
    throw new Error('provider_is_not_direct');
  }
  const expectedMethod = ['emola', 'emola_sim'].includes(providerName) ? 'emola'
    : ['mpesa', 'mpesa_sim'].includes(providerName) ? 'mpesa' : null;
  if (!expectedMethod || order.payment_method !== expectedMethod) {
    throw new Error('direct_payment_method_mismatch');
  }

  // A referência da tentativa. Sem rodar: repetir esta chamada tem de repetir
  // a MESMA tentativa, não criar uma nova cobrança.
  const { data: reference, error: refError } = await svc.rpc('ensure_payment_reference', {
    p_order_id: order.id,
    p_rotate: false,
  });

  if (refError || !reference) {
    return {
      status: 'pending',
      code: 'reference_failed',
      message: 'Estamos a verificar esta tentativa. Acompanha esta encomenda.',
    };
  }

  let resultado: DirectChargeResult;
  try {
    resultado = await provider.charge({
      amountCents: order.total_cents,
      msisdn,
      reference: reference as string,
      description: order.order_number ? `Pedido ${order.order_number}` : 'Encomenda',
    });
  } catch {
    return { status: 'pending', code: 'provider_unavailable', message: 'Ainda não recebemos a confirmação. Acompanha esta encomenda.' };
  }

  if (resultado.providerRef) {
    try {
      await svc.from('orders').update({ payment_provider_ref: resultado.providerRef })
        .eq('id', order.id).eq('store_id', order.store_id).eq('payment_reference', reference);
    } catch { /* A confirmação comum e a referência da tentativa continuam disponíveis. */ }
  }

  try { await svc.from('event_log').insert({
    order_id: order.id,
    store_id: order.store_id,
    actor_user_id: null,
    type: `payment.${resultado.status}`,
    payload: {
      provider: providerName,
      method: order.payment_method,
      source: 'direct_charge',
      code: resultado.code,
      reference,
      // Número parcial: chega para o suporte reconhecer a tentativa e não
      // deixa o número inteiro de um cliente escrito no registo.
      msisdn: `…${msisdn.slice(-4)}`,
    },
  }); } catch { /* Best-effort: o registo de diagnóstico não impede confirmar dinheiro recebido. */ }

  if (resultado.status === 'success') {
    const confirm = await confirmOrderPaid({
      svc,
      orderId: order.id,
      storeId: order.store_id,
      provider: providerName,
      providerRef: resultado.providerRef,
      method: order.payment_method,
      amountCents: order.total_cents,
      source: 'direct_charge',
      origin,
      customer: {
        email: order.customer_email,
        name: order.customer_name,
        orderNumber: order.order_number,
      },
    });

    // Cobrou mas não conseguimos gravar: o pior sítio para dizer "falhou".
    // Fica pendente — a verificação activa e o cron fecham-no.
    if (!confirm.ok) {
      return {
        status: 'pending',
        code: resultado.code,
        message: 'Pagamento recebido. Estamos a confirmar a tua encomenda.',
      };
    }

    return { status: 'paid', code: resultado.code, message: resultado.message };
  }

  if (resultado.status === 'failed') {
    const { data: transition, error } = await svc.rpc('advance_order', {
      p_order_id: order.id, p_event: 'PAYMENT_FAILED',
      p_reason: 'Falha definitiva confirmada na cobrança directa do fornecedor.',
    });
    // DECISÃO: a referência fica imutável neste checkout (1047). Novas
    // tentativas após falha usam outra encomenda/chave; consultas tardias
    // continuam a apontar para a tentativa que realmente foi enviada.
    if (!error && transition?.status === 'payment_failed') {
      return { status: 'failed', code: resultado.code, message: resultado.message };
    }
    if (!error && ['paid', 'in_preparation', 'ready', 'delivered'].includes(transition?.status)) {
      return { status: 'paid', code: resultado.code, message: 'A tua encomenda já está paga.' };
    }
    if (!error && transition?.status === 'cancelled') {
      return { status: 'cancelled', code: resultado.code, message: 'Esta encomenda foi cancelada.' };
    }
    return { status: 'pending', code: resultado.code, message: 'Estamos a confirmar o estado desta encomenda.' };
  }

  // pending: o pedido fica exactamente como está.
  return { status: 'pending', code: resultado.code, message: resultado.message };
}
