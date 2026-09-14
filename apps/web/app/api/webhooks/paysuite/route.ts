import { NextResponse } from 'next/server';
import { isRedirectProvider } from '@delivery/payments';
import { z } from 'zod';

import { getPaymentConfig, buildProvider } from '@/lib/payments/config';
import { referenceToOrderId } from '@/lib/payments/reference';
import { serviceClient } from '@/lib/payments/direct';
import { confirmOrderPaid } from '@/lib/payments/confirm';

export async function POST(request: Request) {
  // O conteúdo ainda não assinado serve apenas para localizar a conta. Nenhuma
  // escrita ou confirmação ocorre antes de validar o HMAC dessa conta.
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 65_536) return new Response('payload_too_large', { status: 413 });
  let payload: unknown;
  try { payload = JSON.parse(raw); }
  catch { return new Response('invalid_payload', { status: 400 }); }
  const envelope = z.object({ data: z.object({ reference: z.string().max(100) }) }).safeParse(payload);
  if (!envelope.success) return new Response('invalid_payload', { status: 400 });
  const orderId = referenceToOrderId(envelope.data.data.reference);
  if (!z.string().uuid().safeParse(orderId).success) return new Response('invalid_payload', { status: 400 });

  const svc = serviceClient();
  const { data: order, error: readError } = await svc.from('orders')
    .select('id,store_id,status,total_cents,payment_method,payment_provider_ref,checkout_started_at,customer_email,customer_name,order_number')
    .eq('id', orderId).maybeSingle();
  if (readError) return new Response('temporarily_unavailable', { status: 503 });
  if (!order) return new Response('not_found', { status: 404 });
  const { data: store } = await svc.from('stores').select('slug').eq('id', order.store_id).maybeSingle();
  if (!store?.slug) return new Response('temporarily_unavailable', { status: 503 });
  let cfg;
  let provider;
  try {
    cfg = await getPaymentConfig(store.slug, { requireStore: true, method: order.payment_method ?? '' });
    if (cfg.provider !== 'paysuite' && cfg.provider !== 'mock') return new Response('not_found', { status: 404 });
    provider = buildProvider(cfg);
  } catch { return new Response('temporarily_unavailable', { status: 503 }); }
  if (!isRedirectProvider(provider)) return new Response('not_found', { status: 404 });
  if (!provider.verifyWebhookSignature(raw, request.headers.get('x-webhook-signature') ?? '')) {
    return new Response('invalid_signature', { status: 401 });
  }
  let parsed;
  try { parsed = provider.parseWebhook(payload); }
  catch { return new Response('invalid_payload', { status: 400 }); }

  if (referenceToOrderId(parsed.requestId) !== order.id || parsed.amountCents !== order.total_cents ||
      (parsed.method && parsed.method !== order.payment_method)) {
    return new Response('payment_mismatch', { status: 409 });
  }
  if (order.status === 'cancelled') return NextResponse.json({ ok: true, ignored: true });

  // O callback assinado pode recuperar o ID perdido na resposta HTTP, mas só
  // para a tentativa que o servidor já reclamou e validou por valor/método.
  let storedReference = order.payment_provider_ref;
  if (!storedReference) {
    if (!order.checkout_started_at) return new Response('payment_reference_pending', { status: 503 });
    const { error } = await svc.from('orders').update({ payment_provider_ref: parsed.providerRef })
      .eq('id', order.id).eq('store_id', order.store_id).is('payment_provider_ref', null);
    if (error) return new Response('payment_reference_pending', { status: 503 });
    const { data: bound } = await svc.from('orders').select('payment_provider_ref')
      .eq('id', order.id).eq('store_id', order.store_id).maybeSingle();
    storedReference = bound?.payment_provider_ref;
  }
  if (storedReference !== parsed.providerRef) return new Response('payment_mismatch', { status: 409 });
  if (parsed.event === 'failed') {
    const { error } = await svc.rpc('advance_order', {
      p_order_id: order.id, p_event: 'PAYMENT_FAILED', p_reason: 'Falha definitiva confirmada pelo webhook do fornecedor.',
    });
    if (error) return new Response('confirmation_pending', { status: 503 });
    return NextResponse.json({ ok: true, event: 'failed' });
  }
  const result = await confirmOrderPaid({
    svc, orderId: order.id, storeId: order.store_id, provider: cfg.provider, providerRef: parsed.providerRef,
    method: parsed.method, amountCents: parsed.amountCents, source: 'webhook',
    origin: new URL(request.url).origin,
    customer: { email: order.customer_email, name: order.customer_name, orderNumber: order.order_number },
  });
  if (!result.ok) return new Response('confirmation_pending', { status: 503 });
  return NextResponse.json({ ok: true, result: result.result });
}
