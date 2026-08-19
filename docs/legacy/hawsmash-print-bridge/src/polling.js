// Poll dos pedidos aprovados por imprimir → impressão → marca printed_at.
//
// Regra de ouro: a impressão é REDUNDÂNCIA. Se a impressora falhar, o pedido
// fica com printed_at = NULL e é re-tentado no ciclo seguinte (auto-recupera
// quando a impressora voltar). NUNCA bloqueia nem esconde o pedido no painel.
import { createClient } from '@supabase/supabase-js';
import { sendToPrinter, sendBytes } from './printer-client.js';
import { buildTestReceipt, buildCaixaReceipt } from './escpos.js';
import { config } from './config.js';
import { sendAlert } from './alerts.js';

// Service role → ignora RLS (precisa ler e marcar printed_at).
// Lazy: só cria o cliente quando o poll arranca, para o index.js poder validar
// a config e mostrar um erro amigável antes (em vez de rebentar no import).
//
// FETCH_TIMEOUT_MS: sem isto, um pedido de rede que fica "pendurado" (wifi
// instável, router a reiniciar) nunca dá erro nem timeout — o loop fica preso
// num único await para sempre, sem imprimir NADA e sem mostrar nenhum erro na
// consola. Com o timeout, esse cenário vira um erro visível e o ciclo seguinte
// tenta outra vez (auto-recupera, como já acontece quando a impressora falha).
const FETCH_TIMEOUT_MS = 15000;
let _supabase;
function db() {
  if (!_supabase) {
    _supabase = createClient(config.supabaseUrl, config.serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: (url, opts) => fetch(url, { ...opts, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
      },
    });
  }
  return _supabase;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Backlog visível: se houver pedidos por imprimir há muito tempo, ou se o
// serviço passar muito tempo sem novidade nenhuma, isso tem de aparecer nas
// linhas da consola — para quem olha para o programinha perceber de imediato
// que algo está diferente, em vez de um erro isolado que passa despercebido.
const BACKLOG_WARN_MS = 2 * 60 * 1000; // pedido por imprimir há +2min → alerta
const HEARTBEAT_EVERY_CYCLES = 20; // ~60s (pollInterval=3s) sem pendentes → sinal de vida
let cyclesSinceLog = 0;

// Email ao dono quando a impressão parar (ver alerts.js) — só no início do
// problema e depois de X em X min enquanto continuar, nunca a cada ciclo.
const ALERT_RECHECK_MS = 15 * 60 * 1000;
let printerAlertActive = false;
let lastAlertSentAt = 0;

function ref(o) {
  return o.order_number != null ? `HS-${String(o.order_number).padStart(4, '0')}` : o.id;
}

// Config da impressora vem do admin (store_settings key='printer'); .env é fallback.
let lastTestHandled = null;
let lastCaixaHandled = null;
let lastReprintHandled = null;
async function getPrinterSettings() {
  const { data, error } = await db().from('store_settings').select('value').eq('key', 'printer').maybeSingle();
  if (error) { console.error('[Poll] erro ao ler config da impressora:', error.message); return null; }
  return data?.value || null;
}

export async function pollOnce() {
  const ps = await getPrinterSettings();

  // Em modo simulador, ignora o IP do admin e usa sempre o localhost.
  const ip = config.useSimulator ? config.printerIp : (ps?.ip || config.printerIp);
  const port = config.useSimulator ? config.printerPort : (ps?.port || config.printerPort);
  const enabled = ps ? ps.enabled !== false : true;

  if (!ip) {
    console.warn('[Poll] sem IP de impressora (configura no admin → Definições, ou PRINTER_IP no .env)');
    return;
  }

  // Pedidos avulsos do admin (teste / fecho de caixa). Limpa os flags numa só
  // escrita no fim, para um não re-activar o outro.
  const cleared = { ...ps };
  let needsClear = false;

  if (ps?.test_requested && ps.test_requested !== lastTestHandled) {
    lastTestHandled = ps.test_requested;
    console.log('[Poll] 🖨️ pedido de teste de impressão');
    await sendBytes(ip, port, buildTestReceipt(), { attempts: 2, timeoutMs: 4000 });
    cleared.test_requested = null; needsClear = true;
  }

  if (ps?.caixa?.requested && ps.caixa.requested !== lastCaixaHandled) {
    lastCaixaHandled = ps.caixa.requested;
    console.log('[Poll] 🖨️ fecho de caixa');
    await sendBytes(ip, port, buildCaixaReceipt(ps.caixa), { attempts: 2, timeoutMs: 4000 });
    cleared.caixa = null; needsClear = true;
  }

  // Botão "Reimprimir" do admin (funciona para qualquer pedido, qualquer estado).
  if (ps?.reprint?.requested && ps.reprint.requested !== lastReprintHandled) {
    lastReprintHandled = ps.reprint.requested;
    const oid = ps.reprint.order_id;
    console.log(`[Poll] 🖨️ reimpressão do pedido ${oid}`);
    const { data: ord } = await db().from('orders').select('*, order_items(*)').eq('id', oid).maybeSingle();
    if (ord) await sendToPrinter(ip, port, ord, { attempts: 2, timeoutMs: 4000 });
    else console.error('[Poll] reimpressão: pedido não encontrado', oid);
    cleared.reprint = null; needsClear = true;
  }

  if (needsClear) {
    await db().from('store_settings').upsert({
      key: 'printer',
      value: cleared,
      updated_at: new Date().toISOString(),
    });
  }

  if (!enabled) return; // impressão automática em pausa

  // Nº de cópias por pedido (cozinha + reserva). Configurável no admin; default 2.
  const copies = Math.max(1, Math.min(5, Number(ps?.copies) || 2));

  const { data: orders, error } = await db()
    .from('orders')
    .select('*, order_items(*)')
    .eq('status', 'paid')
    .is('printed_at', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(10);

  if (error) {
    console.error('[Poll] erro ao buscar pedidos:', error.message);
    return;
  }

  const hasOrders = orders && orders.length > 0;
  const oldest = hasOrders ? orders[0] : null; // já vem ordenado por created_at ascendente
  const oldestAgeMs = oldest ? Date.now() - new Date(oldest.created_at).getTime() : 0;
  const hasBacklog = hasOrders && oldestAgeMs > BACKLOG_WARN_MS;

  if (hasBacklog) {
    console.error(
      `[Poll] ⚠️⚠️ ${orders.length} pedido(s) por imprimir — o mais antigo (${ref(oldest)}) está à espera há ${Math.round(oldestAgeMs / 60000)} min. Verifica a impressora/rede!`
    );
    const sinceLastAlert = Date.now() - lastAlertSentAt;
    if (!printerAlertActive || sinceLastAlert > ALERT_RECHECK_MS) {
      printerAlertActive = true;
      lastAlertSentAt = Date.now();
      sendAlert(
        '🚨 Impressora HAWSMASH não está a imprimir',
        `${orders.length} pedido(s) por imprimir. O mais antigo (${ref(oldest)}) está à espera há ${Math.round(oldestAgeMs / 60000)} min.\n\n` +
        `IP configurado: ${ip}:${port}\n\n` +
        `Verifica: impressora ligada e com papel? Cabo de rede ligado? O IP ainda é o mesmo (self-test da impressora)? Vale a pena reiniciar o programinha.\n\n` +
        `Os pedidos continuam a chegar normalmente — só a impressão física está parada.`
      );
    }
  } else if (printerAlertActive) {
    printerAlertActive = false;
    console.log('[Poll] ✅ impressão recuperou — a enviar aviso de recuperação');
    sendAlert('✅ Impressora HAWSMASH voltou ao normal', 'Voltou a imprimir sem atrasos. Podes ignorar este email.');
  }

  if (!hasOrders) {
    cyclesSinceLog++;
    if (cyclesSinceLog >= HEARTBEAT_EVERY_CYCLES) {
      cyclesSinceLog = 0;
      console.log(`[Poll] ${new Date().toLocaleTimeString('pt-PT')} — a vigiar, sem pedidos pendentes`);
    }
    return;
  }
  cyclesSinceLog = 0;

  if (!hasBacklog) console.log(`[Poll] ${orders.length} pedido(s) por imprimir`);
  for (const order of orders) {
    // Imprime `copies` vias (1ª = cozinha, 2ª = reserva). A 1ª determina o sucesso;
    // se a reserva falhar, não bloqueia (papel = redundância).
    let ok = false;
    for (let i = 0; i < copies; i++) {
      const r = await sendToPrinter(ip, port, order, { attempts: 2, timeoutMs: 4000 });
      if (i === 0) ok = r;
    }

    if (ok) {
      const { error: upErr } = await db()
        .from('orders')
        .update({ printed_at: new Date().toISOString() })
        .eq('id', order.id);
      if (upErr) {
        // Não conseguiu marcar → não re-imprime já: marca em memória para evitar
        // duplicado no ciclo seguinte (best-effort; o pior caso é 1 cópia extra).
        console.error(`[Poll] impresso mas falhou marcar printed_at (${ref(order)}):`, upErr.message);
      } else {
        console.log(`[Poll] ✅ ${ref(order)} impresso`);
      }
    } else {
      console.error(`[Poll] ⚠️  ${ref(order)} não imprimiu — retenta no próximo ciclo`);
    }
  }
}

export async function startPolling() {
  console.log(`[Poll] a vigiar pedidos aprovados (cada ${config.pollInterval / 1000}s)…`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await pollOnce();
    } catch (e) {
      console.error('[Poll] erro no ciclo:', e?.message || e);
    }
    await sleep(config.pollInterval);
  }
}
