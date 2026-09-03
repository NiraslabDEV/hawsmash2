import { NextResponse } from 'next/server';
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

  // Config da LOJA (cai em settings, e depois no .env) — cada unidade pode ter
  // a sua conta (CLAUDE.md §5.6).
  const cfg = await getPaymentConfig(
    typeof payloadInicial.storeSlug === 'string' ? payloadInicial.storeSlug : null,
  );

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
  let storeSlug: string;
  try {
    storeSlug = resolveStoreSlug(payload.storeSlug);
  } catch (error) {
    if (error instanceof InvalidStoreSlugError) {
      return NextResponse.json({ error: 'Loja inválida.' }, { status: 400 });
    }
    throw error;
  }

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
  const { data: order } = await supabase
    .from('orders')
    .select('total_cents, order_number, payment_method, customer_email, customer_name')
    .eq('id', orderId)
    .single();

  if (!order) {
    return NextResponse.json({ error: 'order_fetch_failed' }, { status: 500 });
  }

  // URL público (com esquema) para return_url/callback_url — Paysuite valida-os.
  const appBase = resolvePublicBase(request);

  // ── Fluxo DIRECTO (M-Pesa): cobra-se já, sem o cliente sair do site ──────
  //
  // O cliente fica neste ecrã a olhar para o telemóvel. A resposta pode
  // demorar (é o tempo de ele digitar o PIN) e pode não chegar — e é por isso
  // que `pending` é uma resposta legítima aqui, não um erro.
  if (isDirectFlow(cfg.provider) && msisdn) {
    let provider;
    try {
      provider = buildProvider(cfg);
    } catch {
      // Loja marcada como M-Pesa mas sem credenciais: não se finge que dá.
      // O pedido fica a aguardar pagamento e segue pelo caminho manual.
      return NextResponse.json(
        {
          orderId,
          orderNumber: order.order_number,
          status: 'unavailable',
          message: 'O pagamento automático está indisponível. A loja vai confirmar contigo.',
        },
        { status: 200 },
      );
    }

    const outcome = await runDirectCharge({
      svc: serviceClient(),
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
  const provider = buildProvider(cfg, { autoWebhookMs: 2000 });
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
  } catch (err) {
    // Falha de checkout → cancelar o pedido (erro aqui é não-fatal)
    await supabase.rpc('advance_order', {
      p_order_id: orderId,
      p_event:    'CANCEL',
      p_reason:   'Falha ao criar checkout de pagamento',
    });

    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'checkout_failed' },
      { status: 502 },
    );
  }

  // 4. Guardar provider_ref no pedido para reconciliação (CLAUDE.md F2.1)
  await supabase
    .from('orders')
    .update({ payment_provider_ref: providerPaymentId })
    .eq('id', orderId);

  return NextResponse.json({ orderId, checkoutUrl, orderNumber: order.order_number });
}
