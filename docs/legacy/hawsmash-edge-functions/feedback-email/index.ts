import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.13';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SMTP_USER = 'haw@hawsmash.com';
const SMTP_PASS = Deno.env.get('SMTP_PASS') ?? '';
const SITE = 'https://hawsmash-production.up.railway.app';
const GOOGLE_REVIEW_URL = 'https://g.page/r/CQI_-WS6UUKyEBM/review';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const transporter = nodemailer.createTransport({
  host: 'smtp.hostinger.com', port: 465, secure: true,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

function orderLabel(o: any) {
  return o.order_number ? `#${o.order_number}` : `#${o.id.slice(0,8).toUpperCase()}`;
}

let OBRIGADO_CACHE: string | null = null;
async function getObrigadoImg(): Promise<string | null> {
  if (OBRIGADO_CACHE !== null) return OBRIGADO_CACHE;
  try {
    const res = await fetch(`${SITE}/assets/obrigado.jpg`);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    buf.forEach(b => bin += String.fromCharCode(b));
    OBRIGADO_CACHE = `data:image/jpeg;base64,${btoa(bin)}`;
    return OBRIGADO_CACHE;
  } catch (_) { return null; }
}

Deno.serve(async () => {
  const { data: orders } = await supabase.from('orders')
    .select('*')
    .in('status', ['paid','preparing','ready','out_for_delivery','delivered'])
    .is('deleted_at', null)
    .eq('feedback_email_sent', false)
    .not('customer_email', 'is', null);

  const now = Date.now();
  let sent = 0;
  const obrigadoImg = await getObrigadoImg();

  for (const o of (orders || [])) {
    if (!o.customer_email) continue;
    const slotDT = new Date(`${o.slot_date}T${(o.slot_window||'00:00')}:00`).getTime();
    if (isNaN(slotDT)) continue;
    if (now < slotDT + 30 * 60 * 1000) continue;

    const label = orderLabel(o);
    const avaliarUrl = `${SITE}/avaliar.html?o=${o.id}`;
    const firstName = (o.customer_name || '').split(' ')[0];
    const imgBlock = obrigadoImg
      ? `<img src="${obrigadoImg}" alt="Obrigado HAWSMASH" width="100%" style="max-width:520px;border-radius:12px;display:block;margin:0 auto 24px"/>`
      : '';

    try {
      await transporter.sendMail({
        from: `"HAWSMASH" <${SMTP_USER}>`,
        to: o.customer_email,
        subject: `${firstName}, como foi o teu smash burger? 🍔 Tens 2 minutos para nos ajudar?`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d0b09;color:#f6f1e6;padding:28px 24px;border-radius:12px">

          ${imgBlock}

          <!-- Abertura emocional -->
          <h1 style="font-size:24px;color:#e5a93c;margin:0 0 16px;line-height:1.3">Olá ${firstName}, como foi? 🙏</h1>
          <p style="font-size:15px;color:#cfc7bb;line-height:1.8;margin:0 0 12px">
            Passaram já uns 30 minutos desde o teu pedido ${label} e esperamos mesmo que tenhas adorado cada mordida do teu smash burger.
          </p>
          <p style="font-size:15px;color:#cfc7bb;line-height:1.8;margin:0 0 20px">
            A <strong style="color:#f6f1e6">Hawsmash começou há pouco tempo</strong> — somos um projeto pequeno, feito com muita paixão, que quer crescer em Maputo. Cada pedido que recebemos é uma conquista. E a tua opinião honesta no Google é uma das coisas mais valiosas que podes fazer por nós neste momento.
          </p>

          <!-- Bloco Google Review — destaque total -->
          <div style="padding:24px 20px;background:linear-gradient(135deg,rgba(66,133,244,.15),rgba(52,168,83,.1));border:1px solid rgba(66,133,244,.4);border-radius:14px;margin-bottom:20px">
            <div style="font-size:28px;text-align:center;margin-bottom:10px">⭐⭐⭐⭐⭐</div>
            <div style="font-size:17px;font-weight:700;color:#f6f1e6;text-align:center;margin-bottom:10px">Avalia a Hawsmash no Google</div>
            <p style="font-size:13px;color:#9b9590;line-height:1.7;text-align:center;margin:0 0 8px">
              Conta como foi a tua experiência — o processo de encomenda, a comida, o burger em si. Se tiraste foto do teu burger, partilha também! 📸 Uma foto vale mil palavras (e ajuda muito quem ainda não nos conhece).
            </p>
            <div style="text-align:center;margin:18px 0">
              <a href="${GOOGLE_REVIEW_URL}" target="_blank" style="display:inline-block;background:#4285F4;color:#fff;padding:15px 34px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px">🌟 Escrever Avaliação no Google</a>
            </div>
            <!-- Recompensa -->
            <div style="padding:12px 16px;background:rgba(46,204,113,.08);border:1px solid rgba(46,204,113,.3);border-radius:10px">
              <div style="font-size:13px;color:#7ee2a1;font-weight:700;margin-bottom:4px">🎁 Vai ser recompensado!</div>
              <div style="font-size:12px;color:#9b9590;line-height:1.6">
                Estamos a preparar uma surpresa para todos os clientes que deixarem avaliação. <strong style="color:#cfc7bb">Guarda o print do teu comentário no Google</strong> — vamos precisar dele para entregar a recompensa em breve. 🤝
              </div>
            </div>
          </div>

          <!-- Avaliação interna: discreta -->
          <div style="padding:14px 16px;background:#1a1208;border:1px solid rgba(229,169,60,.15);border-radius:10px;display:flex;align-items:center;gap:12px;margin-bottom:24px">
            <div style="font-size:22px;flex-shrink:0">📝</div>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:600;color:#f6f1e6;margin-bottom:2px">Também podes responder às nossas perguntas rápidas</div>
              <div style="font-size:12px;color:#9b9590">Leva 30 segundos e ajuda-nos a melhorar internamente</div>
            </div>
            <a href="${avaliarUrl}" target="_blank" style="display:inline-block;background:rgba(229,169,60,.12);color:#e5a93c;border:1px solid rgba(229,169,60,.3);padding:9px 16px;border-radius:8px;text-decoration:none;font-weight:700;font-size:12px;white-space:nowrap;flex-shrink:0">Avaliar</a>
          </div>

          <!-- Instagram -->
          <div style="padding:16px;background:#1a1208;border-radius:10px;text-align:center;margin-bottom:16px">
            <div style="font-size:13px;color:#f6f1e6;margin-bottom:10px">Segue-nos e fica a par das novidades 🔥</div>
            <a href="https://instagram.com/hawsmash" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#f9ce34,#ee2a7b,#6228d7);color:#fff;padding:11px 24px;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px">📸 @hawsmash</a>
          </div>

          <p style="font-size:13px;color:#847e72;text-align:center;margin:0;line-height:1.6">
            Com carinho, a equipa Hawsmash 🍔<br/>
            <em style="font-size:12px">Bons burgers, melhores momentos.</em>
          </p>
        </div>`,
      });
      await supabase.from('orders').update({ feedback_email_sent: true }).eq('id', o.id);
      sent++;
    } catch (_) {}
  }

  return new Response(JSON.stringify({ ok: true, sent }), { headers: { 'Content-Type':'application/json' } });
});
