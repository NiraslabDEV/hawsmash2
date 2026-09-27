import type { SupabaseClient } from '@supabase/supabase-js';
import { cents, formatMT } from '@delivery/core';

import { sendMail, type SendMailResult } from './transport';

/**
 * Os emails de um pedido — destinatário e conteúdo saem **sempre da BD**.
 *
 * As rotas antigas recebiam `to`, assunto e HTML de quem as chamava e não
 * pediam sessão: qualquer pessoa na internet usava o SMTP do dono para mandar
 * o que quisesse a quem quisesse. Aqui quem chama só diz **que pedido** é; o
 * endereço é o `customer_email` gravado nesse pedido, e o email só sai se o
 * estado do pedido o justificar (aprovação só de pedido aprovado/pago, recusa
 * só de pedido cancelado).
 *
 * Tudo best-effort (CLAUDE §1): nada aqui lança.
 */

const PAID_STATES = ['approved', 'paid', 'in_preparation', 'ready', 'delivered'] as const;

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function brandName(): string {
  return process.env.BRAND_NAME || 'Delivery OS';
}

function money(totalCents: unknown): string {
  const n = Number(totalCents);
  return Number.isInteger(n) && n >= 0 ? formatMT(cents(n)) : '—';
}

export interface OrderEmailData {
  customerName: string | null;
  orderNumber: string;
  totalCents: number;
  paymentMethod: string | null;
  storeName?: string | null;
  storePhone?: string | null;
}

export function approvalEmail(o: OrderEmailData): { subject: string; html: string } {
  const store = o.storeName
    ? `<p><strong>Loja:</strong> ${escapeHtml(o.storeName)}${o.storePhone ? ` · ${escapeHtml(o.storePhone)}` : ''}</p>`
    : '';
  const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #e5a93c;">Pagamento Confirmado!</h1>
        <p>Olá ${escapeHtml(o.customerName)},</p>
        <p>O seu pagamento foi confirmado com sucesso.</p>
        <div style="background: #1a1614; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Número do Pedido:</strong> ${escapeHtml(o.orderNumber)}</p>
          ${store}
          <p><strong>Total Pago:</strong> ${money(o.totalCents)}</p>
          <p><strong>Método de Pagamento:</strong> ${escapeHtml(String(o.paymentMethod ?? '').toUpperCase())}</p>
        </div>
        <p>Obrigado pela sua encomenda!</p>
        <p>Equipa ${escapeHtml(brandName())}</p>
      </div>`;
  const subject = o.storeName
    ? `Pagamento confirmado — Pedido ${o.orderNumber} · ${o.storeName}`
    : `Pagamento confirmado — Pedido ${o.orderNumber}`;
  return { subject, html };
}

export function rejectionEmail(o: OrderEmailData & { reason: string }): { subject: string; html: string } {
  const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #e5a93c;">Pagamento Não Confirmado</h1>
        <p>Olá ${escapeHtml(o.customerName)},</p>
        <p>Lamentamos informar que o seu pagamento não foi confirmado.</p>
        <div style="background: #1a1614; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Número do Pedido:</strong> ${escapeHtml(o.orderNumber)}</p>
          <p><strong>Método de Pagamento:</strong> ${escapeHtml(String(o.paymentMethod ?? '').toUpperCase())}</p>
          <p><strong>Motivo:</strong> ${escapeHtml(o.reason)}</p>
        </div>
        <p>Por favor, verifique os dados do pagamento ou entre em contacto com o restaurante.</p>
        <p>Equipa ${escapeHtml(brandName())}</p>
      </div>`;
  return { subject: `Pagamento Não Confirmado - Pedido ${o.orderNumber}`, html };
}

export function ownerProofEmail(o: OrderEmailData & { fulfillmentType: string | null }): { subject: string; html: string } {
  const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #e5a93c;">Novo pedido com comprovativo</h1>
          <div style="background: #1a1614; color: #e5e5e5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p><strong>Pedido:</strong> ${escapeHtml(o.orderNumber)}</p>
            <p><strong>Cliente:</strong> ${escapeHtml(o.customerName)}</p>
            <p><strong>Total:</strong> ${money(o.totalCents)}</p>
            <p><strong>Método:</strong> ${escapeHtml(String(o.paymentMethod ?? '').toUpperCase())}</p>
            <p><strong>Tipo:</strong> ${o.fulfillmentType === 'delivery' ? 'Entrega' : 'Levantamento'}</p>
          </div>
          <p>Abre o painel para ver o comprovativo e aprovar/negar o pedido.</p>
        </div>`;
  return { subject: `Novo pedido ${o.orderNumber} — comprovativo recebido`, html };
}

interface OrderRow {
  store_id: string;
  status: string;
  customer_email: string | null;
  customer_name: string | null;
  order_number: string;
  total_cents: number;
  payment_method: string | null;
  stores: { name: string | null; phone: string | null } | null;
}

export type OrderEmailOutcome = SendMailResult | { ok: false; error: 'order_not_found' | 'no_recipient' | 'invalid_state' };

async function loadOrder(svc: SupabaseClient, orderId: string): Promise<OrderRow | null> {
  try {
    const { data, error } = await svc.from('orders')
      .select('store_id,status,customer_email,customer_name,order_number,total_cents,payment_method,stores(name,phone)')
      .eq('id', orderId).maybeSingle();
    if (error || !data) return null;
    return data as unknown as OrderRow;
  } catch {
    return null;
  }
}

function emailData(order: OrderRow): OrderEmailData {
  return {
    customerName: order.customer_name,
    orderNumber: order.order_number,
    totalCents: order.total_cents,
    paymentMethod: order.payment_method,
    storeName: order.stores?.name ?? null,
    storePhone: order.stores?.phone ?? null,
  };
}

async function hasSequence(svc: SupabaseClient, order: OrderRow, orderId: string, event: string) {
  if (!order.store_id) return false;
  const { data } = await svc.from('email_jobs').select('id').eq('store_id', order.store_id)
    .eq('event_key', `${orderId}:${event}`).limit(1).maybeSingle();
  if (data) return true;
  // Pausar não pode fazer o transporte antigo contornar a decisão do dono.
  const { data: paused } = await svc.from('email_flows').select('id').eq('store_id', order.store_id)
    .eq('kind', 'transactional').eq('trigger', event).eq('status', 'paused').limit(1).maybeSingle();
  return Boolean(paused);
}

/** Email "pagamento confirmado" ao cliente do pedido — só se o pedido estiver aprovado/pago. */
export async function sendApprovalEmailForOrder(svc: SupabaseClient, orderId: string): Promise<OrderEmailOutcome> {
  const order = await loadOrder(svc, orderId);
  if (!order) return { ok: false, error: 'order_not_found' };
  if (!order.customer_email) return { ok: false, error: 'no_recipient' };
  if (!(PAID_STATES as readonly string[]).includes(order.status)) return { ok: false, error: 'invalid_state' };
  if (await hasSequence(svc, order, orderId, 'paid')) return { ok: true };
  const { subject, html } = approvalEmail(emailData(order));
  return sendMail({ to: order.customer_email, subject, html, storeId: order.store_id });
}

/** Email "pagamento não confirmado" ao cliente do pedido — só se o pedido estiver cancelado. */
export async function sendRejectionEmailForOrder(
  svc: SupabaseClient, orderId: string, reason: string,
): Promise<OrderEmailOutcome> {
  const order = await loadOrder(svc, orderId);
  if (!order) return { ok: false, error: 'order_not_found' };
  if (!order.customer_email) return { ok: false, error: 'no_recipient' };
  if (order.status !== 'cancelled') return { ok: false, error: 'invalid_state' };
  if (await hasSequence(svc, order, orderId, 'cancelled')) return { ok: true };
  const { subject, html } = rejectionEmail({ ...emailData(order), reason });
  return sendMail({ to: order.customer_email, subject, html, storeId: order.store_id });
}
