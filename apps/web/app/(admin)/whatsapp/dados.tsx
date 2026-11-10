'use client';

import { useEffect, useState } from 'react';

import type { createClient } from '@/utils/supabase/client';
import {
  eventLabel,
  FREE_SERVICE_MESSAGES,
  maskPhone,
  statusLabel,
  usageView,
  type StoreWhatsApp,
} from '@/lib/whatsapp/painel';

/**
 * O mês do WhatsApp da loja: o que a Meta cobra é a base do que se factura ao
 * cliente (B-123). E o que passou por aqui, para perceber uma queixa.
 */

type Enviada = { id: string; created_at: string; event: string; status: string; recipient: string; last_error: string | null };
type Recebida = { id: string; received_at: string; from_phone: string; content_type: string; body: string | null };

export const hora = (iso: string) =>
  new Date(iso).toLocaleString('pt-PT', { timeZone: 'Africa/Maputo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function WhatsAppDados({ whats, storeId, supabase }: { whats: StoreWhatsApp; storeId: string; supabase: ReturnType<typeof createClient> }) {
  const [enviadas, setEnviadas] = useState<Enviada[]>([]);
  const [recebidas, setRecebidas] = useState<Recebida[]>([]);

  useEffect(() => {
    let vivo = true;
    // A RLS (1117) já limita ao dono e a esta loja. Falhar aqui não esconde os números do mês.
    void Promise.all([
      supabase.from('whatsapp_outbox').select('id,created_at,event,status,recipient,last_error').eq('store_id', storeId).order('created_at', { ascending: false }).limit(15),
      supabase.from('whatsapp_inbound').select('id,received_at,from_phone,content_type,body').eq('store_id', storeId).order('received_at', { ascending: false }).limit(15),
    ]).then(([saidas, entradas]) => {
      if (!vivo) return;
      setEnviadas((saidas.data ?? []) as Enviada[]);
      setRecebidas((entradas.data ?? []) as Recebida[]);
    });
    return () => {
      vivo = false;
    };
  }, [supabase, storeId, whats]);

  const uso = usageView(whats.month);
  const tiles = [
    { rotulo: 'Mensagens a pagar', valor: uso.chargedTotal, nota: `${uso.chargedTemplates} avisos + ${uso.chargedService} respostas` },
    { rotulo: 'Respostas grátis por usar', valor: uso.freeLeft, nota: `${whats.month.service_delivered} entregues` },
    { rotulo: 'Pedidos pela conversa', valor: whats.month.orders, nota: `${whats.month.inbound} mensagens recebidas` },
    { rotulo: 'Falhadas', valor: whats.month.failed, nota: `${whats.month.waiting} por confirmar entrega` },
  ];

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-2xl border border-white/[0.08] p-5">
        <div>
          <h2 className="font-black text-white">Este mês</h2>
          <p className="mt-1 text-xs text-[#8b8378]">
            A Meta cobra o que foi entregue: os avisos sempre, e as respostas da conversa acima das{' '}
            {FREE_SERVICE_MESSAGES.toLocaleString('pt-PT')} grátis por número.
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.rotulo} className="rounded-xl border border-white/10 p-3">
              <dt className="text-[11px] text-[#8b8378]">{tile.rotulo}</dt>
              <dd className="mt-1 text-xl font-black tabular-nums text-white">{tile.valor.toLocaleString('pt-PT')}</dd>
              <dd className="mt-0.5 text-[11px] text-[#6b6357]">{tile.nota}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="grid gap-5 rounded-2xl border border-white/[0.08] p-5 lg:grid-cols-2">
        <div>
          <h3 className="font-bold text-white">Últimas enviadas</h3>
          {enviadas.length === 0 && <p className="mt-2 text-xs text-[#8b8378]">Ainda nada saiu desta loja.</p>}
          <ul className="mt-2 space-y-2">
            {enviadas.map((m) => (
              <li key={m.id} className="rounded-xl border border-white/[0.06] px-3 py-2 text-xs">
                <span className="flex justify-between gap-2 text-white">
                  <span>{eventLabel(m.event)}</span>
                  <span className={m.status === 'failed' ? 'text-red-300' : 'text-[#C9BCAC]'}>{statusLabel(m.status)}</span>
                </span>
                <span className="mt-0.5 block text-[#6b6357]">
                  {hora(m.created_at)} · {maskPhone(m.recipient)}
                </span>
                {m.status === 'failed' && m.last_error && <span className="mt-1 block text-red-300/80">{m.last_error}</span>}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-bold text-white">Últimas recebidas</h3>
          {recebidas.length === 0 && <p className="mt-2 text-xs text-[#8b8378]">Ainda ninguém escreveu para esta loja.</p>}
          <ul className="mt-2 space-y-2">
            {recebidas.map((m) => (
              <li key={m.id} className="rounded-xl border border-white/[0.06] px-3 py-2 text-xs">
                <span className="block break-words text-white">{m.body?.trim() || `(${m.content_type})`}</span>
                <span className="mt-0.5 block text-[#6b6357]">
                  {hora(m.received_at)} · {maskPhone(m.from_phone)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
