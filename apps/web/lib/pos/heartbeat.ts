/**
 * O sinal de vida do POS.
 *
 * Até 07/10 o `devices.last_seen_at` do POS só mexia quando havia venda, mesa
 * ou PIN. O painel lia isso como "dispositivo calado" e punha um crítico em
 * cada hora morta e em cada noite — em Maputo o terminal estava ligado e a
 * vender, com um alerta vermelho em cima. Quem convive com quatro alertas
 * falsos deixa de olhar para o painel, e é por isso que isto se corrige.
 *
 * O batimento é best-effort (CLAUDE §17): nunca trava nem atrasa uma venda, e
 * falhar só significa que o ponto do painel apaga daqui a 15 minutos — o
 * limiar do POS em `private.device_silent_after`, quinze batidas falhadas.
 * Sem rede não se tenta: o POS está a vender offline, e isso é por desenho.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { CURRENT_BUILD } from './app-update';

/**
 * De 60 em 60 segundos. Com o limiar de 15 minutos do lado da base, dá quinze
 * tentativas antes de alguém ser incomodado — chega para um wifi fraco ao
 * balcão sem chegar para esconder um terminal desligado durante o serviço.
 */
export const HEARTBEAT_MS = 60_000;

/**
 * Bate uma vez. Devolve se o servidor registou, para quem quiser mostrar
 * estado; nunca lança.
 */
export async function sendPosHeartbeat(
  supabase: Pick<SupabaseClient, 'rpc'>,
  deviceId: string,
  online: boolean = typeof navigator === 'undefined' ? true : navigator.onLine,
): Promise<boolean> {
  if (!online) return false;
  try {
    const { error } = await supabase.rpc('pos_heartbeat', {
      p_device_id: deviceId,
      p_app_version: CURRENT_BUILD,
    });
    return !error;
  } catch {
    return false;
  }
}
