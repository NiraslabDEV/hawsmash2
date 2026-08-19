import nodemailer from "npm:nodemailer@6.9.13";
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SMTP_USER = "haw@hawsmash.com";
const SMTP_PASS = Deno.env.get('SMTP_PASS') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'https://tsrgileifpiaiicwjfar.supabase.co';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const GOOGLE_REVIEW_URL = 'https://g.page/r/CQI_-WS6UUKyEBM/review';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com", port: 465, secure: true,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

function orderLabel(order: any) {
  return order.order_number ? `#${order.order_number}` : `#${order.id.slice(0,8).toUpperCase()}`;
}

function totalBlock(order: any) {
  const df = Number(order.delivery_fee_mt) || 0;
  const sub = order.subtotal_mt != null ? order.subtotal_mt : (order.total_mt - df);
  const line = df > 0
    ? `<div style="font-size:13px;color:#9b9590;margin-bottom:4px">Subtotal: ${sub} MT &nbsp;·&nbsp; 🚚 Entrega: ${df} MT</div>`
    : '';
  return `${line}<div style="font-size:24px;font-weight:700;color:#e5a93c">Total: ${order.total_mt} MT</div>`;
}

const WA = 'https://wa.me/27634851904?text=' + encodeURIComponent('Olá Niraslab, gostava de um sistema como o da HAWSMASH para o meu negócio.');

const GOOGLE_REVIEW_BLOCK_CONFIRMATION = `
  <div style="margin-top:28px;padding:24px 20px;background:linear-gradient(135deg,rgba(229,169,60,.08),rgba(0,0,0,0));border:1px solid rgba(229,169,60,.25);border-radius:14px">
    <div style="font-size:15px;font-weight:700;color:#f6f1e6;margin-bottom:10px;line-height:1.5">👋 Enquanto esperas pelo teu pedido...</div>
    <p style="font-size:14px;color:#cfc7bb;line-height:1.7;margin:0 0 16px">
      A Hawsmash é um projeto que nasceu com muito amor e determinação. Cada pedido que fazemos é uma conquista para nós.
      Contar como foi a tua experiência de compra no Google ajuda outras pessoas a descobrir-nos — e para nós significa o mundo.
    </p>
    <div style="padding:14px 16px;background:rgba(255,255,255,.04);border-radius:10px;margin-bottom:16px">
      <div style="font-size:12px;color:#9b9590;margin-bottom:6px;letter-spacing:.08em;text-transform:uppercase">O que podes partilhar</div>
      <div style="font-size:13px;color:#cfc7bb;line-height:1.8">
        • Como correu o processo de encomenda?<br/>
        • Foi fácil de usar? Chegou rápido a confirmação?<br/>
        • O que sentiste ao fazer o teu pedido?
      </div>
    </div>
    <div style="text-align:center">
      <a href="${GOOGLE_REVIEW_URL}" target="_blank" style="display:inline-block;background:#4285F4;color:#fff;padding:14px 30px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">⭐ Deixar Avaliação no Google</a>
      <div style="margin-top:12px;padding:10px 14px;background:rgba(46,204,113,.08);border:1px solid rgba(46,204,113,.25);border-radius:8px;font-size:12px;color:#7ee2a1">
        📸 <strong>Guarda o print da tua avaliação!</strong> Estamos a preparar uma surpresa para quem comentar — em breve.
      </div>
    </div>
  </div>`;

const CLIENT_FOOTER = `
  <div style="margin-top:24px;padding:18px;background:#1a1208;border-radius:10px;text-align:center">
    <div style="font-size:13px;color:#f6f1e6;margin-bottom:12px">Não percas as novidades e promoções 🔥</div>
    <a href="https://instagram.com/hawsmash" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#f9ce34,#ee2a7b,#6228d7);color:#fff;padding:11px 24px;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px">📸 Seguir @hawsmash</a>
  </div>
  <div style="margin-top:18px;padding-top:16px;border-top:1px solid rgba(255,255,255,.08);text-align:center">
    <div style="font-size:11px;color:#9b9590;margin-bottom:10px">Queres um sistema de encomendas como este para o teu negócio?</div>
    <a href="${WA}" target="_blank" style="display:inline-block;background:#25d366;color:#ffffff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">💬 Falar com a Niraslab</a>
    <div style="font-size:10px;color:#6b6560;margin-top:10px;letter-spacing:.12em;text-transform:uppercase">Desenvolvido por Niraslab</div>
  </div>`;

async function imageToDataUri(publicUrl: string): Promise<string | null> {
  try {
    const prefix = `${SUPABASE_URL}/storage/v1/object/public/payment-proofs/`;
    const filePath = publicUrl.replace(prefix, '');
    const { data, error } = await supabase.storage.from('payment-proofs').download(filePath);
    if (error || !data) return null;
    const buffer = await data.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    const base64 = btoa(binary);
    const ext = filePath.split('.').pop()?.toLowerCase() ?? 'jpg';
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${base64}`;
  } catch (_) { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    const { type, order, items } = body;

    // Alerta genérico do sistema (ex.: print-bridge a avisar que a impressora
    // parou). Sem `order` — sai antes de orderLabel(), que precisa de um pedido.
    if (type === "system_alert") {
      const { subject, message } = body;
      await transporter.sendMail({
        from: `"HAWSMASH" <${SMTP_USER}>`, to: SMTP_USER,
        subject: String(subject || 'Alerta HAWSMASH'),
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d0b09;color:#f6f1e6;padding:32px;border-radius:12px">
            <h1 style="font-size:22px;color:#e5a93c;margin:0 0 16px">${String(subject || 'Alerta HAWSMASH')}</h1>
            <p style="font-size:15px;line-height:1.7;white-space:pre-line;color:#cfc7bb">${String(message || '')}</p>
          </div>`,
      });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const label = orderLabel(order);

    if (type === "new_order") {
      const itemsList = (items || []).map((i: any) => `${i.qty}× ${i.product_name} — ${i.line_total_mt} MT`).join("<br/>");
      let proofHtml = `<div style="margin-top:16px;padding:12px;background:rgba(255,100,80,.1);border-radius:8px;font-size:13px;color:#ff8868">⚠️ Nenhum comprovativo enviado</div>`;
      if (order.payment_proof_url) {
        const dataUri = await imageToDataUri(order.payment_proof_url);
        proofHtml = dataUri
          ? `<div style="margin-top:20px;padding:16px;background:#1a1208;border-radius:8px;border:1px solid rgba(229,169,60,.2)"><div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#9b9590;margin-bottom:10px">🖼️ Comprovativo</div><img src="${dataUri}" alt="Comprovativo" width="520" style="max-width:100%;border-radius:8px;display:block"/></div>`
          : `<div style="margin-top:16px;padding:12px;background:rgba(229,169,60,.1);border-radius:8px;font-size:13px">🖼️ <a href="${order.payment_proof_url}" style="color:#e5a93c">Ver comprovativo</a></div>`;
      }
      const approveUrl = `${SUPABASE_URL}/functions/v1/approve-order?id=${order.id}&action=approve`;
      const rejectUrl  = `${SUPABASE_URL}/functions/v1/approve-order?id=${order.id}&action=reject`;
      await transporter.sendMail({
        from: `"HAWSMASH" <${SMTP_USER}>`, to: SMTP_USER,
        subject: `🍔 Novo Pedido ${label} — ${order.customer_name}`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d0b09;color:#f6f1e6;padding:32px;border-radius:12px">
            <h1 style="font-size:28px;color:#e5a93c;margin:0 0 4px">🍔 Novo Pedido!</h1>
            <p style="font-size:32px;font-weight:700;color:#e5a93c;margin:0 0 20px;letter-spacing:.04em">${label}</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <tr><td style="padding:8px 0;color:#9b9590">Cliente</td><td style="padding:8px 0;font-weight:600">${order.customer_name}</td></tr>
              <tr><td style="padding:8px 0;color:#9b9590">WhatsApp</td><td style="padding:8px 0">${order.customer_phone}</td></tr>
              <tr><td style="padding:8px 0;color:#9b9590">Levantamento</td><td style="padding:8px 0">${order.slot_date} às ${order.slot_window}</td></tr>
              <tr><td style="padding:8px 0;color:#9b9590">Entrega</td><td style="padding:8px 0">${order.fulfillment === 'delivery' ? '🚚 Em casa — ' + (order.delivery_address || '') : order.fulfillment === 'yango' ? '🚕 Yango' : '🏪 Levantamento'}</td></tr>
            </table>
            <div style="margin:20px 0;padding:16px;background:#1a1208;border-radius:8px"><div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#9b9590;margin-bottom:8px">Itens</div><div style="font-size:14px;line-height:2">${itemsList}</div></div>
            ${totalBlock(order)}
            ${order.customer_notes ? `<div style="margin-top:12px;padding:12px;background:rgba(232,90,42,.15);border-radius:8px;font-size:13px;color:#ffb080">⚠️ ${order.customer_notes}</div>` : ''}
            ${proofHtml}
            <div style="margin-top:28px"><a href="${approveUrl}" style="background:#2ecc71;color:#fff;padding:16px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;margin:4px">✅ Aprovar Pagamento</a><a href="${rejectUrl}" style="background:#e74c3c;color:#fff;padding:16px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;margin:4px">❌ Recusar</a></div>
          </div>`,
      });
    }

    if (type === "order_confirmed" && order.customer_email) {
      const itemsList = (items || []).map((i: any) => `${i.qty}× ${i.product_name} — ${i.line_total_mt} MT`).join("<br/>");
      await transporter.sendMail({
        from: `"HAWSMASH" <${SMTP_USER}>`, to: order.customer_email,
        subject: `✅ Pedido Confirmado ${label} — HAWSMASH`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d0b09;color:#f6f1e6;padding:32px;border-radius:12px">
            <h1 style="font-size:28px;color:#e5a93c;margin:0 0 4px">Pedido Confirmado! ✅</h1>
            <p style="font-size:32px;font-weight:700;color:#e5a93c;margin:0 0 16px;letter-spacing:.04em">${label}</p>
            <p style="color:#9b9590;margin:0 0 24px;font-size:14px">Olá ${order.customer_name}, o teu pagamento foi verificado.</p>
            <div style="padding:16px;background:#1a1208;border-radius:8px;margin-bottom:20px"><div style="font-size:14px;line-height:2">${itemsList}</div><div style="margin-top:10px">${totalBlock(order)}</div></div>
            <div style="padding:16px;background:rgba(229,169,60,.1);border:1px solid rgba(229,169,60,.3);border-radius:8px"><div style="font-size:22px;font-weight:700;color:#f6f1e6">${order.slot_date} · ${order.slot_window}</div>${order.fulfillment !== 'delivery' ? `<div style="font-size:13px;color:#9b9590;margin-top:4px">Casa do Bom Pasteleiro · Av. 24 de Julho, Maputo</div>` : `<div style="font-size:13px;color:#9b9590;margin-top:4px">${order.delivery_address || ''}</div>`}</div>
            <p style="font-size:13px;color:#9b9590;margin-top:20px">Dúvidas? <a href="https://wa.me/258860760009" style="color:#e5a93c">WhatsApp +258 860 760 009</a></p>
            <p style="font-size:18px;margin-top:16px">Obrigado pela tua encomenda! 🍔</p>
            ${GOOGLE_REVIEW_BLOCK_CONFIRMATION}
            ${CLIENT_FOOTER}
          </div>`,
      });
    }

    if (type === "order_ready" && order.customer_email) {
      const entrega = order.fulfillment === 'delivery';
      await transporter.sendMail({
        from: `"HAWSMASH" <${SMTP_USER}>`, to: order.customer_email,
        subject: `🍔 O teu pedido ${label} está PRONTO! — HAWSMASH`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d0b09;color:#f6f1e6;padding:32px;border-radius:12px">
            <h1 style="font-size:30px;color:#2ecc71;margin:0 0 4px">🍔 Está Pronto!</h1>
            <p style="font-size:32px;font-weight:700;color:#2ecc71;margin:0 0 16px;letter-spacing:.04em">${label}</p>
            <p style="color:#f6f1e6;margin:0 0 20px;font-size:16px;line-height:1.6">Olá ${order.customer_name}, o teu smash burger acabou de sair da grelha! 🔥</p>
            <div style="padding:18px;background:rgba(46,204,113,.1);border:1px solid rgba(46,204,113,.3);border-radius:10px;margin-bottom:20px"><div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#9b9590;margin-bottom:6px">${entrega ? '🚚 A caminho' : '🏪 Pronto para levantar'}</div><div style="font-size:20px;font-weight:700;color:#f6f1e6">${entrega ? 'O teu pedido vai a caminho!' : 'Vem buscar enquanto está quentinho!'}</div></div>
            <p style="font-size:18px;margin-top:16px">Bom apetite! 🍔</p>
            ${CLIENT_FOOTER}
          </div>`,
      });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
