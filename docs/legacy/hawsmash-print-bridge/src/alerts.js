// Alertas por email para o dono quando algo parar de funcionar (ex.: impressora
// sem imprimir). Reaproveita a Edge Function `send-email` (type: 'system_alert'),
// o mesmo SMTP já usado para os emails de pedido — nada de credenciais novas.
//
// Nunca lança: um alerta falhado (sem internet, por ex.) não pode derrubar o
// poll — mesma regra de ouro da impressão (redundância, nunca bloqueia).
import { config } from './config.js';

const ALERT_FETCH_TIMEOUT_MS = 10000;

export async function sendAlert(subject, message) {
  try {
    const res = await fetch(`${config.supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.supabaseAnonKey },
      body: JSON.stringify({ type: 'system_alert', subject, message }),
      signal: AbortSignal.timeout(ALERT_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) console.error(`[Alert] send-email respondeu ${res.status}`);
    else console.log('[Alert] email enviado:', subject);
  } catch (e) {
    console.error('[Alert] falhou enviar email de alerta:', e?.message || e);
  }
}
