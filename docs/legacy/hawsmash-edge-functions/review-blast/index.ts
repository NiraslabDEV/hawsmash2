// NOTA: a versão deployada (v1) tinha fallback hardcoded do BLAST_SECRET — removido aqui
// (sem env var definida, a função recusa tudo). Definir BLAST_SECRET nos Secrets e redeploy.
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.13';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SMTP_USER    = 'haw@hawsmash.com';
const SMTP_PASS    = Deno.env.get('SMTP_PASS') ?? '';
const BLAST_SECRET = Deno.env.get('BLAST_SECRET') ?? '';
const SITE         = 'https://hawsmash-production.up.railway.app';
const GOOGLE_REVIEW_URL = 'https://g.page/r/CQI_-WS6UUKyEBM/review';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const transporter = nodemailer.createTransport({
  host: 'smtp.hostinger.com', port: 465, secure: true,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

/* Carrega a imagem obrigado.jpg como base64 para embed no email */
let OBRIGADO_CACHE: string | null = null;
async function getObrigadoImg(): Promise<string | null> {
  if (OBRIGADO_CACHE !== null) return OBRIGADO_CACHE;
  try {
    const res = await fetch(`${SITE}/assets/obrigado.jpg`);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = ''; buf.forEach(b => bin += String.fromCharCode(b));
    OBRIGADO_CACHE = `data:image/jpeg;base64,${btoa(bin)}`;
    return OBRIGADO_CACHE;
  } catch (_) { return null; }
}

Deno.serve(async (req) => {
  /* Segurança: requer ?secret=... ou header x-blast-secret */
  const url    = new URL(req.url);
  const secret = url.searchParams.get('secret') ?? req.headers.get('x-blast-secret') ?? '';
  if (!BLAST_SECRET || secret !== BLAST_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  /* dry_run=true apenas lista os emails sem enviar */
  const dryRun = url.searchParams.get('dry_run') === 'true';

  /* Busca todos os pedidos com email, agrupa por email (1 por pessoa) */
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, customer_name, customer_email, created_at')
    .not('customer_email', 'is', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  /* Deduplica: 1 registo por email (o mais recente, que já vem primeiro) */
  const seen = new Set<string>();
  const targets: { name: string; email: string }[] = [];
  for (const o of (orders || [])) {
    const email = (o.customer_email || '').toLowerCase().trim();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    targets.push({ name: o.customer_name || 'Cliente', email });
  }

  if (dryRun) {
    return new Response(JSON.stringify({ dry_run: true, total: targets.length, emails: targets.map(t => t.email) }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const obrigadoImg = await getObrigadoImg();
  let sent = 0;
  const failed: string[] = [];

  for (const { name, email } of targets) {
    const firstName = name.split(' ')[0];
    const imgBlock  = obrigadoImg
      ? `<img src="${obrigadoImg}" alt="Hawsmash" width="100%" style="max-width:520px;border-radius:14px;display:block;margin:0 auto 28px"/>`
      : '';

    try {
      await transporter.sendMail({
        from: `"HAWSMASH" <${SMTP_USER}>`,
        to: email,
        subject: `${firstName}, tens 2 minutos? Precisamos muito de ti 🙏`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0d0b09;color:#f6f1e6;padding:32px 24px;border-radius:14px">

          ${imgBlock}

          <!-- Abertura pessoal -->
          <p style="font-size:13px;color:#9b9590;letter-spacing:.12em;text-transform:uppercase;margin:0 0 8px">Uma mensagem pessoal</p>
          <h1 style="font-size:26px;color:#e5a93c;margin:0 0 20px;line-height:1.3">
            ${firstName}, a tua voz pode mudar tudo para nós. 🙏
          </h1>

          <p style="font-size:15px;color:#cfc7bb;line-height:1.85;margin:0 0 14px">
            A <strong style="color:#f6f1e6">Hawsmash começou há muito pouco tempo.</strong> Somos uma hamburgueria artesanal a crescer em Maputo, feita com paixão e muito trabalho — e tu já fizeste parte desta história ao confiar em nós.
          </p>
          <p style="font-size:15px;color:#cfc7bb;line-height:1.85;margin:0 0 20px">
            Hoje pedimos-te um favor enorme: <strong style="color:#f6f1e6">deixa uma avaliação da Hawsmash no Google.</strong> Uma estrela, uma frase, uma memória — o que quiseres partilhar. Cada comentário ajuda outras pessoas a descobrir-nos e ajuda-nos a continuar a crescer.
          </p>

          <!-- Separador visual -->
          <div style="border-top:1px solid rgba(255,255,255,.08);margin:24px 0"></div>

          <!-- Bloco Google Review — hero total -->
          <div style="padding:28px 22px;background:linear-gradient(135deg,rgba(66,133,244,.18),rgba(52,168,83,.12),rgba(251,188,5,.08));border:1px solid rgba(66,133,244,.45);border-radius:16px;text-align:center;margin-bottom:20px">
            <div style="font-size:32px;margin-bottom:12px">⭐⭐⭐⭐⭐</div>
            <div style="font-size:19px;font-weight:700;color:#f6f1e6;margin-bottom:10px">Avalia a Hawsmash no Google</div>
            <p style="font-size:14px;color:#9b9590;line-height:1.75;margin:0 0 10px">
              Conta como foi a tua experiência — o pedido, a comida, o smash burger.
              <br/>Se tens <strong style="color:#cfc7bb">foto do teu burger</strong>, adiciona também! 📸
              <br/><span style="font-size:12px">Uma foto ajuda muito quem ainda não nos conhece.</span>
            </p>
            <div style="margin:20px 0">
              <a href="${GOOGLE_REVIEW_URL}" target="_blank"
                style="display:inline-block;background:#4285F4;color:#fff;padding:16px 36px;border-radius:12px;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:.01em">
                🌟 Deixar Avaliação no Google
              </a>
            </div>
            <div style="font-size:12px;color:#6b6560">Abre o Google Maps · Leva menos de 2 minutos</div>
          </div>

          <!-- Recompensa -->
          <div style="padding:18px 20px;background:rgba(46,204,113,.07);border:1px solid rgba(46,204,113,.3);border-radius:12px;margin-bottom:24px">
            <div style="font-size:15px;font-weight:700;color:#7ee2a1;margin-bottom:8px">🎁 Vão ser recompensados!</div>
            <p style="font-size:13px;color:#9b9590;line-height:1.7;margin:0">
              Estamos a preparar uma recompensa especial para todos os clientes que deixarem avaliação no Google.
              <strong style="color:#cfc7bb"> Guarda o print (screenshot) da tua avaliação</strong> assim que publicares — vamos precisar dele para te entregar a surpresa. Em breve temos novidades! 🤝
            </p>
          </div>

          <!-- Separador -->
          <div style="border-top:1px solid rgba(255,255,255,.06);margin:20px 0"></div>

          <!-- Instagram -->
          <div style="text-align:center;margin-bottom:20px">
            <div style="font-size:13px;color:#9b9590;margin-bottom:10px">E se ainda não nos segues no Instagram...</div>
            <a href="https://instagram.com/hawsmash" target="_blank"
              style="display:inline-block;background:linear-gradient(135deg,#f9ce34,#ee2a7b,#6228d7);color:#fff;padding:11px 26px;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px">
              📸 @hawsmash
            </a>
            <div style="font-size:11px;color:#6b6560;margin-top:8px">Novidades, eventos e promoções primeiro por lá</div>
          </div>

          <!-- Assinatura -->
          <p style="font-size:13px;color:#847e72;text-align:center;margin:0;line-height:1.8">
            Com muito carinho e gratidão,<br/>
            <strong style="color:#cfc7bb">A equipa Hawsmash</strong> 🍔<br/>
            <em style="font-size:12px">Bons burgers, melhores momentos.</em>
          </p>

        </div>`,
      });
      sent++;
    } catch (e) {
      failed.push(email);
      console.error(`failed ${email}:`, e);
    }

    /* Pausa entre emails para não sobrecarregar o SMTP */
    await new Promise(r => setTimeout(r, 400));
  }

  return new Response(JSON.stringify({ ok: true, total: targets.length, sent, failed }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
