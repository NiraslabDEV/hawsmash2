import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.13';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SMTP_USER = 'haw@hawsmash.com';
const SMTP_PASS = Deno.env.get('SMTP_PASS') ?? '';
const SITE = 'https://hawsmash-production.up.railway.app';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const transporter = nodemailer.createTransport({
  host: 'smtp.hostinger.com', port: 465, secure: true,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

function orderLabel(order: any) {
  return order.order_number ? `#${order.order_number}` : `#${order.id.slice(0,8).toUpperCase()}`;
}

const WA = 'https://wa.me/27634851904?text=' + encodeURIComponent('Olá Niraslab, gostava de um sistema como o da HAWSMASH para o meu negócio.');
const NIRASLAB_FOOTER = `
  <div style="margin-top:28px;padding-top:20px;border-top:1px solid rgba(255,255,255,.08);text-align:center">
    <div style="font-size:12px;color:#9b9590;margin-bottom:12px;line-height:1.6">Queres um sistema de encomendas como este<br/>para o teu negócio?</div>
    <a href="${WA}" target="_blank" style="display:inline-block;background:#25d366;color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">💬 Falar com a Niraslab</a>
    <div style="font-size:10px;color:#6b6560;margin-top:12px;letter-spacing:.12em;text-transform:uppercase">Desenvolvido por Niraslab</div>
  </div>`;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const orderId = url.searchParams.get('id');
  const action  = url.searchParams.get('action') ?? 'approve';
  if (!orderId) return new Response(null, { status: 302, headers: { Location: `${SITE}/admin` } });

  const { data: order, error } = await supabase.from('orders').select('*, order_items(*)').eq('id', orderId).single();
  if (error || !order) return new Response(null, { status: 302, headers: { Location: `${SITE}/admin` } });
  if (order.status !== 'pending') return new Response(null, { status: 302, headers: { Location: `${SITE}/admin` } });

  const label = orderLabel(order);
  const items = order.order_items || [];
  const itemsList = items.map((i: any) => `${i.qty}× ${i.product_name} — ${i.line_total_mt} MT`).join('<br/>');

  if (action === 'approve') {
    await supabase.from('orders').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', orderId);
    if (order.customer_email) {
      try {
        await transporter.sendMail({
          from: `"HAWSMASH" <${SMTP_USER}>`, to: order.customer_email,
          subject: `✅ Pedido Confirmado ${label} — HAWSMASH`,
          html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d0b09;color:#f6f1e6;padding:32px;border-radius:12px"><h1 style="color:#e5a93c">Pedido Confirmado! ✅</h1><p style="font-size:32px;font-weight:700;color:#e5a93c">${label}</p><p>Olá ${order.customer_name}, o teu pagamento foi verificado.</p><div style="padding:16px;background:#1a1208;border-radius:8px;margin:16px 0"><div style="font-size:14px;line-height:2">${itemsList}</div><div style="font-size:20px;font-weight:700;color:#e5a93c;margin-top:8px">Total: ${order.total_mt} MT</div></div><div style="padding:16px;background:rgba(229,169,60,.1);border:1px solid rgba(229,169,60,.3);border-radius:8px"><div style="font-size:22px;font-weight:700">${order.slot_date} · ${order.slot_window}</div>${order.fulfillment !== 'delivery' ? '<div style="color:#9b9590;font-size:13px;margin-top:4px">Casa do Bom Pasteleiro · Av. 24 de Julho, Maputo</div>' : `<div style="color:#9b9590;font-size:13px">${order.delivery_address||''}</div>`}</div><p style="color:#9b9590;font-size:13px;margin-top:20px">Dúvidas? <a href="https://wa.me/258860760009" style="color:#e5a93c">WhatsApp +258 860 760 009</a></p><p style="font-size:18px;margin-top:16px">Obrigado pela tua encomenda! 🍔</p>${NIRASLAB_FOOTER}</div>`,
        });
      } catch(_) {}
    }
  }

  if (action === 'reject') {
    await supabase.from('orders').update({ status: 'cancelled' }).eq('id', orderId);
    if (order.customer_email) {
      try {
        await transporter.sendMail({
          from: `"HAWSMASH" <${SMTP_USER}>`, to: order.customer_email,
          subject: `❌ Pedido ${label} não confirmado — HAWSMASH`,
          html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d0b09;color:#f6f1e6;padding:32px;border-radius:12px"><h1 style="color:#ff8868">Pagamento não confirmado ❌</h1><p style="font-size:24px;font-weight:700;color:#ff8868">${label}</p><p>Olá ${order.customer_name}, não conseguimos confirmar o teu pagamento.</p><p style="color:#9b9590">Se achas que é um engano, fala connosco via WhatsApp.</p><a href="https://wa.me/258860760009" style="display:inline-block;margin-top:20px;background:#e5a93c;color:#1a1208;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700">Contactar HAWSMASH</a>${NIRASLAB_FOOTER}</div>`,
        });
      } catch(_) {}
    }
  }

  return new Response(null, { status: 302, headers: { Location: `${SITE}/admin` } });
});
