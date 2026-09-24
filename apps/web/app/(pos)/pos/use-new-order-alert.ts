'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { aoMudarEstadoDoSom, prepararSom, somBloqueado, tocarAlarme } from '@/lib/pos/chime';
import {
  ARRIVAL_STATUSES,
  alertState,
  arrivals,
  type AlertOrder,
  type AlertState,
} from '@/lib/pos/new-orders';

/** Polling é a base; o realtime só adianta o refetch (CLAUDE §11.3). */
const POLL_MS = 10_000;
/** Enquanto houver um pedido por aprovar e o quadro fechado, volta a tocar. */
const LEMBRETE_MS = 60_000;

/**
 * Vigia os pedidos online da loja deste terminal a partir do ecrã de vender:
 * toca quando chega um, e diz ao botão "Pedidos" se deve piscar.
 *
 * O que já estava na fila quando o POS abriu não toca — senão cada arranque
 * seria um alarme falso. Mas um pedido por aprovar continua a fazer piscar,
 * porque continua à espera de alguém.
 *
 * `sound` vem das definições do POS da loja (aba POS do painel). Desligado, o
 * botão continua a piscar — só não toca.
 */
export function useNewOrderAlert(
  storeId: string | null,
  boardOpen: boolean,
  sound = true,
): AlertState & { somBloqueado: boolean } {
  const [supabase] = useState(() => createClient());
  const [orders, setOrders] = useState<AlertOrder[]>([]);
  const [naoVistos, setNaoVistos] = useState<Set<string>>(new Set());
  /** `null` até à primeira leitura: é ela que define o que "já lá estava". */
  const conhecidos = useRef<Set<string> | null>(null);
  const quadroAberto = useRef(boardOpen);
  quadroAberto.current = boardOpen;
  const somLigado = useRef(sound);
  somLigado.current = sound;

  const load = useCallback(async () => {
    if (!storeId) return;
    const { data, error } = await supabase
      .from('orders')
      .select('id,status,channel')
      .eq('store_id', storeId)
      .neq('channel', 'counter')
      .in('status', [...ARRIVAL_STATUSES])
      .order('created_at', { ascending: false })
      .limit(50);
    if (error || !data) return;

    const lista = data as AlertOrder[];
    setOrders(lista);

    if (conhecidos.current === null) {
      conhecidos.current = new Set(lista.map((o) => o.id));
      return;
    }
    const novos = arrivals(lista, conhecidos.current);
    if (novos.length === 0) return;

    for (const o of novos) conhecidos.current.add(o.id);
    // Com o quadro aberto, o pedido já está à frente de quem trabalha: toca,
    // mas não fica marcado como por ver.
    if (!quadroAberto.current) {
      setNaoVistos((atual) => {
        const seguinte = new Set(atual);
        for (const o of novos) seguinte.add(o.id);
        return seguinte;
      });
    }
    if (somLigado.current) tocarAlarme();
  }, [storeId, supabase]);

  useEffect(() => {
    if (!storeId) return;
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, storeId]);

  useEffect(() => {
    if (!storeId) return;
    const canal = supabase
      .channel(`pos-alerta-${storeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `store_id=eq.${storeId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [load, storeId, supabase]);

  // Abrir o quadro é ter visto.
  useEffect(() => {
    if (boardOpen) setNaoVistos(new Set());
  }, [boardOpen]);

  const estado = alertState(orders, naoVistos);

  useEffect(() => {
    if (boardOpen || estado.porAprovar === 0) return;
    const timer = window.setInterval(() => {
      if (somLigado.current) tocarAlarme();
    }, LEMBRETE_MS);
    return () => window.clearInterval(timer);
  }, [boardOpen, estado.porAprovar]);

  // O browser só deixa tocar depois de um toque no ecrã; no balcão há sempre um.
  useEffect(() => {
    const desbloquear = () => prepararSom();
    window.addEventListener('pointerdown', desbloquear);
    return () => window.removeEventListener('pointerdown', desbloquear);
  }, []);

  // Som suspenso = o POS vê o pedido e fica calado. Aconteceu na loja: o Edge
  // abriu sem `--autoplay-policy` e ninguém tinha tocado no ecrã. O ecrã passa
  // a dizê-lo, em vez de falhar em silêncio.
  const [bloqueado, setBloqueado] = useState(false);
  useEffect(() => {
    const actualizar = () => setBloqueado(somBloqueado());
    actualizar();
    return aoMudarEstadoDoSom(actualizar);
  }, []);

  return { ...estado, somBloqueado: bloqueado };
}
