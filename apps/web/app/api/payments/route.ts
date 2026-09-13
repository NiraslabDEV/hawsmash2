import { NextResponse } from 'next/server';
import { z } from 'zod';
import { InvalidMsisdnError, MSISDN_ERROR_PT, isRedirectProvider, normalizeMsisdn } from '@delivery/payments';

import { createClient } from '@/utils/supabase/server';
import { getPaymentConfig, buildProvider, isDirectFlow } from '@/lib/payments/config';
import { runDirectCharge, serviceClient } from '@/lib/payments/direct';
import { orderToReference } from '@/lib/payments/reference';
import { InvalidStoreSlugError, resolveStoreSlug } from '@/lib/store-context';

/**
 * URL público base para return_url/callback_url do Paysuite.
 * O Paysuite valida que são URLs absolutas (com esquema) — daí a normalização.
 * Precedência: APP_BASE_URL (normalizado com https se faltar esquema) →
 * headers x-forwarded-proto/host do proxy (Railway/Vercel) → origin do request.
 */
function resolvePublicBase(request: Request): string {
  const env = process.env.APP_BASE_URL?.trim();
  if (env && !env.includes('localhost')) {
    const clean = env.replace(/\/+$/, '');
    return /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
  }
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : new URL(request.url).origin;
}

export async function POST(request: Request) {
  const payloadInicial = await request.json().catch(() => null);
  if (!payloadInicial) {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const selection = z.object({ paymentMethod: z.enum(['mpesa', 'emola', 'credit_card']), clientCheckoutId: z.string().uuid() }).safeParse(payloadInicial);
  if (!selection.success) return NextResponse.json({ error: 'Método ou referência de pagamento inválidos.' }, { status: 400 });
  let storeSlug: string;
  try { storeSlug = resolveStoreSlug(payloadInicial.storeSlug); }
  catch (error) {
    if (error instanceof InvalidStoreSlugError) return NextResponse.json({ error: 'Loja inválida.' }, { status: 400 });
    throw error;
  }
  let cfg;
  let provider;
  try {
    cfg = await getPaymentConfig(storeSlug, { requireStore: true, method: selection.data.paymentMethod });
    if (cfg.provider !== 'manual') provider = buildProvider(cfg, { autoWebhookMs: 2000 });
  } catch {
    return NextResponse.json({ error: 'payment_unavailable', status: 'unavailable', message: 'O pagamento automático está indisponível. Podes usar comprovativo.' }, { status: 503 });
  }

  if (cfg.provider === 'manual') {
    return NextResponse.json(
      { error: 'payment_provider_is_manual' },
      { status: 400 },
    );
  }

  const payload = payloadInicial;

  // Fluxo directo: o número tem de ser válido ANTES de existir pedido nenhum.
  // Criar o pedido e só depois recusar o número deixava encomendas mortas na
  // base de dados a cada erro de digitação.
  let msisdn: string | null = null;
  if (isDirectFlow(cfg.provider)) {
    try {
      msisdn = normalizeMsisdn(String(payload.msisdn ?? ''));
    } catch (error) {
      const reason = error instanceof InvalidMsisdnError ? error.reason : 'empty';
      return NextResponse.json(
        { error: 'invalid_msisdn', message: MSISDN_ERROR_PT[reason] },
        { status: 400 },
      );
    }
  }

  const supabase = await createClient();

  // 1. Criar pedido com flow=digital — status = awaiting_payment (CLAUDE.md 5)
  const orderPayload = { ...payload, flow: 'digital' };

  const { data: orderId, error: orderError } = await supabase.rpc('create_order', {
    p_store_slug: storeSlug,
    p_payload: orderPayload,
  });

  if (orderError || !orderId) {
    return NextResponse.json(
      { error: orderError?.message ?? 'create_order_failed' },
      { status: 400 },
    );
  }

  // 2. Ler total calculado pelo servidor (NUNCA confiar no client)
  const svc = serviceClient();
  const { data: order } = await svc
    .from('orders')
    .select('store_id,status,total_cents,order_number,payment_method,customer_email,customer_name,stores!inner(slug)')
    .eq('id', orderId)
    .eq('stores.slug', storeSlug)
    .single();

  if (!order || order.payment_method !== selection.data.paymentMethod) {
    return NextResponse.json({ error: 'order_fetch_failed' }, { status: 500 });
  }

  // A criação bloqueia mudanças de gateway enquanto há pagamentos pendentes.
  // Reler fecha a janela entre a primeira consulta de configuração e a criação.
  try {
    cfg = await getPaymentConfig(storeSlug, { requireStore: true, method: order.payment_method });
    provider = buildProvider(cfg, { autoWebhookMs: 2000 });
  } catch {
    return NextResponse.json({ orderId, orderNumber: order.order_number, status: 'unavailable', message: 'O pagamento automático está indisponível. A loja vai confirmar contigo.' });
  }

  // Uma única chamada ganha o direito de iniciar o fornecedor. O identificador
  // vem do navegador antes do primeiro POST e a BD verifica o mesmo payload.
  const { data: claim, error: claimError } = await svc.rpc('claim_online_checkout', { p_order_id: orderId });
  if (claimError || !claim) return NextResponse.json({ orderId, orderNumber: order.order_number, status: 'pending' });
  if (!claim.claimed) {
    const status = claim.status ?? order.status;
    if (['paid', 'in_preparation', 'ready', 'delivered'].includes(status)) return NextResponse.json({ orderId, status: 'paid' });
    if (status === 'payment_failed') return NextResponse.json({ orderId, status: 'failed', message: 'O fornecedor confirmou que esta tentativa não foi concluída.' });
    if (status === 'cancelled') return NextResponse.json({ orderId, status: 'cancelled' });
    return NextResponse.json({ orderId, orderNumber: order.order_number,
      ...(claim.checkoutUrl ? { checkoutUrl: claim.checkoutUrl } : { status: 'pending' }) });
  }

  // URL público (com esquema) para return_url/callback_url — Paysuite valida-os.
  const appBase = resolvePublicBase(request);

  // ── Fluxo DIRECTO (M-Pesa): cobra-se já, sem o cliente sair do site ──────
  //
  // O cliente fica neste ecrã a olhar para o telemóvel. A resposta pode
  // demorar (é o tempo de ele digitar o PIN) e pode não chegar — e é por isso
  // que `pending` é uma resposta legítima aqui, não um erro.
  if (isDirectFlow(cfg.provider) && msisdn) {
    const outcome = await runDirectCharge({
      svc,
      provider,
      providerName: cfg.provider,
      order: {
        id: orderId,
        total_cents: order.total_cents,
        order_number: order.order_number,
        customer_email: order.customer_email,
        customer_name: order.customer_name,
      },
      msisdn,
      origin: appBase,
    });

    return NextResponse.json({
      orderId,
      orderNumber: order.order_number,
      status: outcome.status,
      message: outcome.message,
    });
  }

  // Paysuite exige reference alfanumérico → orderToReference (CLAUDE.md 6.4)
  const idempotencyKey = orderToReference(orderId);
  // autoWebhookMs: no mock dispara webhook 2s depois (simula Paysuite); ignorado no real
  if (!isRedirectProvider(provider)) {
    return NextResponse.json({ error: 'provider_flow_mismatch' }, { status: 500 });
  }

  // 3. Criar checkout Paysuite
  let checkoutUrl: string;
  let providerPaymentId: string;

  try {
    const result = await provider.createCheckout({
      amountCents: order.total_cents,
      idempotencyKey,
      method: order.payment_method as 'mpesa' | 'emola' | 'credit_card',
      returnUrl: `${appBase}/payment/return/${orderId}`,
      webhookUrl: `${appBase}/api/webhooks/paysuite`,
    });
    checkoutUrl      = result.checkoutUrl;
    providerPaymentId = result.providerPaymentId;
  } catch {
    // DECISÃO: a resposta pode ter-se perdido depois de o gateway criar o
    // checkout. Não cancelar nem sugerir nova cobrança sem saber o resultado.
    return NextResponse.json({ orderId, orderNumber: order.order_number, status: 'pending', message: 'Estamos a verificar o pagamento. Não voltes a pagar; acompanha esta encomenda.' });
  }

  // 4. Guardar provider_ref no pedido para reconciliação (CLAUDE.md F2.1)
  const { error: referenceError } = await svc
    .from('orders')
    .update({ payment_provider_ref: providerPaymentId, checkout_url: checkoutUrl })
    .eq('id', orderId)
    .eq('store_id', order.store_id);

  if (referenceError) return NextResponse.json({ orderId, orderNumber: order.order_number, status: 'pending', message: 'Estamos a verificar o pagamento. Não voltes a pagar; acompanha esta encomenda.' });

  return NextResponse.json({ orderId, checkoutUrl, orderNumber: order.order_number });
}
