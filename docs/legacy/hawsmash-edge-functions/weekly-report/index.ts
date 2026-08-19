// NOTA: a versão deployada (v2) tinha SMTP_PASS hardcoded — substituída aqui por env var.
// Fazer redeploy desta versão para remover o segredo do código em produção.
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.13';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SMTP_USER = 'haw@hawsmash.com';
const SMTP_PASS = Deno.env.get('SMTP_PASS') ?? '';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const transporter = nodemailer.createTransport({
  host: 'smtp.hostinger.com', port: 465, secure: true,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

const PAID = ['paid','preparing','ready','out_for_delivery','delivered'];

function isoDate(d: Date) { return d.toISOString().split('T')[0]; }

async function rangeStats(start: string, end: string) {
  const { data: orders } = await supabase.from('orders').select('*')
    .in('status', PAID).is('deleted_at', null)
    .gte('slot_date', start).lte('slot_date', end);
  const list = orders || [];
  const total = list.reduce((a:any,o:any)=>a+(o.total_mt||0),0);
  const num = list.length;
  const ticket = num ? Math.round(total/num) : 0;

  // produtos + horas
  const ids = list.map((o:any)=>o.id);
  let prods: Record<string,number> = {};
  if (ids.length) {
    for (let i=0;i<ids.length;i+=100){
      const { data: its } = await supabase.from('order_items').select('*').in('order_id', ids.slice(i,i+100));
      (its||[]).forEach((it:any)=>{ prods[it.product_name]=(prods[it.product_name]||0)+it.qty; });
    }
  }
  const topProd = Object.entries(prods).sort((a,b)=>b[1]-a[1])[0];

  const byHour: Record<string,number> = {};
  list.forEach((o:any)=>{ const h=(o.slot_window||'').split(':')[0]; if(h) byHour[h]=(byHour[h]||0)+1; });
  const peak = Object.entries(byHour).sort((a,b)=>b[1]-a[1])[0];

  const clients: Record<string,{name:string,total:number}> = {};
  list.forEach((o:any)=>{ const k=(o.customer_phone||'').replace(/\D/g,'')||o.customer_name; if(!clients[k])clients[k]={name:o.customer_name,total:0}; clients[k].total+=(o.total_mt||0); });
  const topClient = Object.values(clients).sort((a,b)=>b.total-a.total)[0];

  return { total, num, ticket, topProd, peak, topClient };
}

Deno.serve(async (_req) => {
  const now = new Date();
  // Semana passada: segunda a domingo
  const day = now.getDay(); // 0 dom
  const lastSunday = new Date(now); lastSunday.setDate(now.getDate() - (day === 0 ? 7 : day));
  const lastMonday = new Date(lastSunday); lastMonday.setDate(lastSunday.getDate() - 6);
  const prevSunday = new Date(lastMonday); prevSunday.setDate(lastMonday.getDate() - 1);
  const prevMonday = new Date(prevSunday); prevMonday.setDate(prevSunday.getDate() - 6);

  const cur = await rangeStats(isoDate(lastMonday), isoDate(lastSunday));
  const prev = await rangeStats(isoDate(prevMonday), isoDate(prevSunday));

  if (cur.num === 0) {
    return new Response(JSON.stringify({ ok: true, skipped: 'sem vendas' }), { headers: { 'Content-Type':'application/json' } });
  }

  const growth = prev.total > 0 ? Math.round(((cur.total - prev.total) / prev.total) * 100) : null;
  const growthHtml = growth === null ? ''
    : `<span style="font-size:13px;color:${growth>=0?'#2ecc71':'#ff8868'}"> ${growth>=0?'↑':'↓'}${Math.abs(growth)}%</span>`;
  const meses = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const fmt = (d:Date)=>`${d.getDate()} ${meses[d.getMonth()]}`;
  const periodo = `${fmt(lastMonday)} – ${fmt(lastSunday)}`;

  const row = (label:string, val:string, extra='') =>
    `<div style="display:flex;justify-content:space-between;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:15px;color:#e6ddd0"><span>${label}</span><span style="font-weight:700;color:#f6f1e6">${val}${extra}</span></div>`;

  await transporter.sendMail({
    from: `"HAWSMASH" <${SMTP_USER}>`,
    to: SMTP_USER,
    subject: `📊 A tua semana na HAWSMASH — ${cur.total.toLocaleString('pt-PT')} MT`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d0b09;color:#f6f1e6;padding:32px;border-radius:12px">
        <h1 style="font-size:26px;color:#e5a93c;margin:0 0 2px">📊 A Tua Semana</h1>
        <p style="color:#9b9590;font-size:13px;margin:0 0 24px;letter-spacing:.04em">${periodo} · 2026</p>
        <div style="padding:18px 20px;background:#1a1208;border-radius:10px">
          ${row('💰 Faturação', cur.total.toLocaleString('pt-PT')+' MT', growthHtml)}
          ${row('📦 Pedidos', String(cur.num))}
          ${row('🎯 Ticket médio', cur.ticket.toLocaleString('pt-PT')+' MT')}
          ${row('🏆 Mais vendido', cur.topProd ? `${cur.topProd[0].split(' (')[0]} (${cur.topProd[1]}×)` : '—')}
          ${row('👑 Melhor cliente', cur.topClient ? `${cur.topClient.name}` : '—')}
          ${row('🕐 Hora de pico', cur.peak ? `${cur.peak[0]}h00` : '—')}
        </div>
        ${growth !== null ? `<div style="text-align:center;margin-top:18px;font-size:16px;font-weight:700;color:${growth>=0?'#2ecc71':'#ff8868'}">${growth>=0?'🔥 Cresceste '+growth+'% esta semana!':'📉 Caíste '+Math.abs(growth)+'% vs semana passada'}</div>` : ''}
        <div style="margin-top:24px;text-align:center"><a href="https://hawsmash-production.up.railway.app/admin" style="background:#e5a93c;color:#1a1208;padding:13px 26px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Ver Dashboard Completo →</a></div>
        <div style="margin-top:24px;padding-top:18px;border-top:1px solid rgba(255,255,255,.08);text-align:center;font-size:11px;color:#6b6560">Relatório automático · Desenvolvido por <strong style="color:#c8860a">Niraslab</strong></div>
      </div>`,
  });

  return new Response(JSON.stringify({ ok: true, total: cur.total, growth }), { headers: { 'Content-Type':'application/json' } });
});
