import { NextResponse } from 'next/server';
import { isDirectProvider } from '@delivery/payments';

import { buildProvider, getPaymentConfig, isDirectFlow } from '@/lib/payments/config';
import { confirmOrderPaid } from '@/lib/payments/confirm';
import { serviceClient } from '@/lib/payments/direct';

/**
 * Verificação ACTIVA do pagamento — chamada pelo ecrã de espera do cliente.
 *
 * Não depende de webhook nem de cron: pergunta o estado ao gateway e, se
 * estiver pago, confirma pelo caminho comum (`confirmOrderPaid`, idempotente).
 *
 * É esta rota que fecha o buraco do M-Pesa directo: tudo o que a cobrança
 * deixou `pending` — tempo esgotado, duplicado, rede em baixo — resolve-se
 * aqui, enquanto o cliente ainda está a olhar para o ecrã.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const orderId = body?.orderId as string | undefined;
  if (!orderId) {
    return NextResponse.json({ error: 'order_id_required' }, { status: 400 });
  }

  const svc = serviceClient();

  interface OrderRow {
    id: string;
    status: string;
    total_cents: number;
    payment_provider_ref: string | null;
    payment_reference: string | null;
    payment_method: string | null;
    customer_email: string | null;
    customer_name: string | null;
    order_number: string | null;
    store_id: string;
  }

  const { data: order } = await svc
    .from('orders')
    .select(
      'id, status, total_cents, payment_provider_ref, payment_reference, payment_method, customer_email, customer_name, order_number, store_id',
    )
    .eq('id', orderId)
    .single<OrderRow>();

  if (!order) {
    return NextResponse.json({ error: 'order_not_found' }, { status: 404 });
  }

  // Já confirmado — nada a perguntar.
  if (['paid', 'in_preparation', 'ready', 'delivered'].includes(order.status)) {
    return NextResponse.json({ status: 'paid' });
  }

  // A config é da loja do pedido, não da empresa: cada unidade pode ter a sua
  // conta. Sem isto, uma loja verificava pagamentos contra a conta de outra.
  const { data: store } = await svc
    .from('stores')
    .select('slug')
    .eq('id', order.store_id)
    .maybeSingle();

  const cfg = await getPaymentConfig(store?.slug ?? null);
  if (cfg.provider === 'manual') {
    return NextResponse.json({ status: 'manual' });
  }

  // A referência a perguntar depende do fluxo: o gateway de redirect conhece o
  // pagamento pelo id dele; o M-Pesa directo conhece-o pela nossa referência.
  const lookup = isDirectFlow(cfg.provider) ? order.payment_reference : order.payment_provider_ref;
  if (!lookup) {
    return NextResponse.json({ status: order.status });
  }

  let provider;
  try {
    provider = buildProvider(cfg);
  } catch {
    return NextResponse.json({ status: 'pending' });
  }

  if (!isDirectProvider(provider) && !provider.getPaymentStatus) {
    return NextResponse.json({ status: order.status });
  }

  let paymentStatus: 'success' | 'failed' | 'pending';
  try {
    paymentStatus = isDirectProvider(provider)
      ? await provider.getPaymentStatus(lookup)
      : await provider.getPaymentStatus!(lookup);
  } catch {
    // Não conseguir perguntar não é resposta. Continua pendente.
    return NextResponse.json({ status: 'pending' });
  }

  if (paymentStatus === 'failed') {
    await svc
      .from('orders')
      .update({ status: 'payment_failed', updated_at: new Date().toISOString() })
      .eq('id', order.id)
      .in('status', ['awaiting_payment', 'payment_failed']);

    await svc.from('event_log').insert({
      order_id: order.id,
      type: 'payment.failed',
      payload: { provider: cfg.provider, source: 'return_verify' },
    });

    // No fluxo directo, roda-se a referência: agora sabemos que a tentativa
    // não levou dinheiro, e sem isto o cliente ficava sem poder tentar outra
    // vez (o M-Pesa recusaria a repetição como duplicada).
    if (isDirectFlow(cfg.provider)) {
      await svc.rpc('ensure_payment_reference', { p_order_id: order.id, p_rotate: true });
    }

    return NextResponse.json({ status: 'failed' });
  }

  if (paymentStatus !== 'success') {
    return NextResponse.json({ status: 'pending' });
  }

  const confirm = await confirmOrderPaid({
    svc,
    orderId: order.id,
    provider: cfg.provider,
    providerRef: order.payment_provider_ref ?? order.payment_reference,
    method: order.payment_method ?? 'mpesa',
    amountCents: order.total_cents,
    source: 'return_verify',
    origin: new URL(request.url).origin,
    customer: {
      email: order.customer_email,
      name: order.customer_name,
      orderNumber: order.order_number,
    },
  });

  if (!confirm.ok) {
    return NextResponse.json({ status: 'pending', error: confirm.error });
  }

  return NextResponse.json({ status: 'paid', confirm: confirm.result });
}
