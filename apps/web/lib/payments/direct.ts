import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import { isDirectProvider, type PaymentProvider } from '@delivery/payments';

import { confirmOrderPaid } from './confirm';

/**
 * Cobrança directa (M-Pesa): o que acontece **depois** de o gateway responder.
 *
 * Está separado da rota HTTP porque é aqui que moram as decisões que não podem
 * variar entre caminhos — e porque é o que se consegue testar sem levantar um
 * servidor.
 *
 * As três decisões, por ordem de quanto custa errar:
 *
 * 1. **`pending` deixa o pedido onde está.** Não se marca falhado, não se
 *    devolve o cliente ao carrinho, não se roda a referência. O dinheiro pode
 *    ter saído; quem decide é o M-Pesa quando lhe perguntarmos.
 * 2. **`failed` roda a referência.** Só aqui, porque só aqui sabemos que a
 *    tentativa anterior não levou dinheiro. Sem rodar, o cliente que cancela
 *    fica preso: o M-Pesa recusaria a segunda tentativa como duplicada.
 * 3. **`success` confirma pelo caminho comum**, com a chave de idempotência do
 *    pedido — a mesma do webhook e do cron.
 */

export type DirectOutcome = 'paid' | 'pending' | 'failed';

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
    total_cents: number;
    order_number?: string | null;
    customer_email?: string | null;
    customer_name?: string | null;
  };
  msisdn: string;
  origin?: string;
}

export function serviceClient(): SupabaseClient {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function runDirectCharge(
  input: RunDirectChargeInput,
): Promise<DirectChargeOutcome> {
  const { svc, provider, providerName, order, msisdn, origin } = input;

  if (!isDirectProvider(provider)) {
    throw new Error('provider_is_not_direct');
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
      message: 'Não foi possível iniciar o pagamento. Tenta de novo dentro de instantes.',
    };
  }

  const resultado = await provider.charge({
    amountCents: order.total_cents,
    msisdn,
    reference: reference as string,
    description: order.order_number ? `Pedido ${order.order_number}` : 'Encomenda',
  });

  await svc.from('event_log').insert({
    order_id: order.id,
    type: `payment.${resultado.status}`,
    payload: {
      provider: providerName,
      source: 'direct_charge',
      code: resultado.code,
      reference,
      // Número parcial: chega para o suporte reconhecer a tentativa e não
      // deixa o número inteiro de um cliente escrito no registo.
      msisdn: `…${msisdn.slice(-4)}`,
    },
  });

  if (resultado.status === 'success') {
    const confirm = await confirmOrderPaid({
      svc,
      orderId: order.id,
      provider: providerName,
      providerRef: resultado.providerRef,
      method: 'mpesa',
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
    await svc
      .from('orders')
      .update({ status: 'payment_failed', updated_at: new Date().toISOString() })
      .eq('id', order.id)
      .in('status', ['awaiting_payment', 'payment_failed']);

    // Só aqui se roda a referência: sabemos que esta tentativa não levou
    // dinheiro, portanto a próxima pode ser uma cobrança nova.
    await svc.rpc('ensure_payment_reference', { p_order_id: order.id, p_rotate: true });

    return { status: 'failed', code: resultado.code, message: resultado.message };
  }

  // pending: o pedido fica exactamente como está.
  return { status: 'pending', code: resultado.code, message: resultado.message };
}
