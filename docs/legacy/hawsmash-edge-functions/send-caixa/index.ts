import nodemailer from 'npm:nodemailer@6.9.13';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SMTP_USER = 'haw@hawsmash.com';
const SMTP_PASS = Deno.env.get('SMTP_PASS') ?? '';

const transporter = nodemailer.createTransport({
  host: 'smtp.hostinger.com', port: 465, secure: true,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const { data, total_mt, total_pedidos, total_entregues, itens, notas } = await req.json();

    const d = new Date(data + 'T12:00:00');
    const dias = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
    const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const dataFmt = `${dias[d.getDay()]}, ${d.getDate()} ${meses[d.getMonth()]} ${d.getFullYear()}`;

    const totalUnid = (itens||[]).reduce((a:any,i:any)=>a+i.qty,0);
    const rows = (itens||[]).map((i:any) =>
      `<tr><td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06)"><span style="color:#c8860a;font-weight:700">${i.qty}×</span> <span style="color:#e6ddd0">${i.product_name}</span></td><td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06);text-align:right;color:#9b9590">${(i.total_mt||0).toLocaleString('pt-PT')} MT</td></tr>`
    ).join('');

    await transporter.sendMail({
      from: `"HAWSMASH" <${SMTP_USER}>`,
      to: SMTP_USER,
      subject: `📋 Fechamento de Caixa — ${dias[d.getDay()]} ${d.getDate()}/${String(d.getMonth()+1).padStart(2,'0')} · ${(total_mt||0).toLocaleString('pt-PT')} MT`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d0b09;color:#f6f1e6;padding:32px;border-radius:12px">
          <h1 style="font-size:26px;color:#e5a93c;margin:0 0 2px">📋 Fechamento de Caixa</h1>
          <p style="color:#9b9590;font-size:14px;margin:0 0 24px;letter-spacing:.04em">${dataFmt}</p>
          <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap">
            <div style="flex:1;min-width:120px;background:rgba(46,204,113,.1);border:1px solid rgba(46,204,113,.3);border-radius:10px;padding:14px;text-align:center">
              <div style="font-size:24px;font-weight:700;color:#2ecc71">${(total_mt||0).toLocaleString('pt-PT')} MT</div>
              <div style="font-size:10px;color:#9b9590;letter-spacing:.1em;text-transform:uppercase;margin-top:4px">Faturado</div>
            </div>
            <div style="flex:1;min-width:90px;background:#1a1208;border-radius:10px;padding:14px;text-align:center">
              <div style="font-size:24px;font-weight:700;color:#e5a93c">${total_pedidos||0}</div>
              <div style="font-size:10px;color:#9b9590;letter-spacing:.1em;text-transform:uppercase;margin-top:4px">Pedidos</div>
            </div>
            <div style="flex:1;min-width:90px;background:#1a1208;border-radius:10px;padding:14px;text-align:center">
              <div style="font-size:24px;font-weight:700;color:#2ecc71">${total_entregues||0}</div>
              <div style="font-size:10px;color:#9b9590;letter-spacing:.1em;text-transform:uppercase;margin-top:4px">Entregues</div>
            </div>
          </div>
          <div style="padding:18px 20px;background:#1a1208;border-radius:10px">
            <div style="display:flex;justify-content:space-between;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#9b9590;margin-bottom:12px"><span>Vendido</span><span>${totalUnid} unidades</span></div>
            <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}
              <tr><td style="padding:14px 0 0;font-weight:700;font-size:16px;color:#f6f1e6">TOTAL</td><td style="padding:14px 0 0;text-align:right;font-weight:700;font-size:20px;color:#c8860a">${(total_mt||0).toLocaleString('pt-PT')} MT</td></tr>
            </table>
          </div>
          ${notas ? `<div style="margin-top:16px;padding:12px 16px;background:rgba(229,169,60,.08);border-radius:8px;font-size:13px;color:#cfc7bb">📝 ${notas}</div>` : ''}
          <div style="margin-top:24px;padding-top:18px;border-top:1px solid rgba(255,255,255,.08);text-align:center;font-size:11px;color:#6b6560">Fechamento automático · Desenvolvido por <strong style="color:#c8860a">Niraslab</strong></div>
        </div>`,
    });

    return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, 'Content-Type':'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...CORS, 'Content-Type':'application/json' } });
  }
});
