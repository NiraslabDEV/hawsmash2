'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { createClient } from '@/utils/supabase/client';
import {
  COLUMN_HINT,
  COLUMN_LABEL,
  groupByColumn,
  KANBAN_COLUMNS,
  outboundText,
  since,
  type ConversationRow,
  type KanbanCard,
  type KanbanColumn,
} from '@/lib/whatsapp/kanban';
import { eventLabel, maskPhone, statusLabel } from '@/lib/whatsapp/painel';

import { hora } from './dados';

/**
 * Kanban das conversas do WhatsApp da loja. As colunas mudam sozinhas com o
 * passo do bot (`lib/whatsapp/kanban.ts`); daqui só se lê. Assumir a conversa
 * e responder pelo painel é a fase seguinte (migration própria).
 *
 * Actualiza de 20 em 20 s com o separador visível: o realtime, quando entrar,
 * só pede para voltar a ler (CLAUDE §17).
 */

type Supabase = ReturnType<typeof createClient>;
type Mensagem = { id: string; at: string; dir: 'in' | 'out'; text: string; status?: string };

const REFRESH_MS = 20_000;

const COLUMN_TONE: Record<KanbanColumn, string> = {
  novas: 'border-sky-400/30',
  a_pedir: 'border-[#e5a93c]/40',
  comprovativo: 'border-amber-300/40',
  humano: 'border-red-400/50',
  fechadas: 'border-white/10',
};

export function WhatsAppConversas({ storeId, supabase }: { storeId: string; supabase: Supabase }) {
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<KanbanCard | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    // A RLS (1124) deixa o dono ler as conversas das suas lojas.
    const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data, error } = await supabase
      .from('whatsapp_conversations')
      .select('id,phone,profile_name,last_inbound_at,updated_at,state')
      .eq('store_id', storeId)
      .gte('updated_at', since7d)
      .order('updated_at', { ascending: false })
      .limit(200);
    if (error) {
      setErro(`Não foi possível ler as conversas: ${error.message}`);
      return;
    }
    setErro(null);
    setRows((data ?? []) as ConversationRow[]);
    setNow(Date.now());
  }, [supabase, storeId]);

  useEffect(() => {
    setRows(null);
    setAberta(null);
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const grupos = useMemo(() => (rows ? groupByColumn(rows, now) : null), [rows, now]);

  if (erro) return <p className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">{erro}</p>;
  if (!grupos) return <p className="text-sm text-[#8b8378]">A carregar as conversas…</p>;

  const total = rows?.length ?? 0;

  return (
    <div className="space-y-4">
      <p className="text-xs text-[#8b8378]">
        {total === 0
          ? 'Ainda não há conversas nos últimos 7 dias. Aparecem aqui assim que alguém escrever para o número desta loja.'
          : `${total} ${total === 1 ? 'conversa' : 'conversas'} nos últimos 7 dias · actualiza sozinho.`}
      </p>

      {/* Em telemóvel as colunas deslizam na horizontal, dentro do quadro: a página não. */}
      <div className="-mx-1 overflow-x-auto pb-2">
        <div className="flex min-w-max gap-3 px-1 lg:grid lg:min-w-0 lg:grid-cols-5">
          {KANBAN_COLUMNS.map((col) => (
            <section key={col} aria-label={COLUMN_LABEL[col]} className="w-64 shrink-0 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3 lg:w-auto">
              <header className="mb-3">
                <h3 className="flex items-center justify-between text-sm font-bold text-white">
                  <span>{COLUMN_LABEL[col]}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${col === 'humano' && grupos[col].length ? 'bg-red-500/20 text-red-300' : 'bg-white/[0.06] text-[#C9BCAC]'}`}>
                    {grupos[col].length}
                  </span>
                </h3>
                <p className="mt-1 text-[11px] leading-snug text-[#6b6357]">{COLUMN_HINT[col]}</p>
              </header>
              <ul className="space-y-2">
                {grupos[col].map((card) => (
                  <li key={card.id}>
                    <button
                      type="button"
                      onClick={() => setAberta(card)}
                      className={`w-full rounded-xl border bg-[#0f0e0c] p-3 text-left transition hover:bg-white/[0.04] ${COLUMN_TONE[col]} ${aberta?.id === card.id ? 'ring-1 ring-[#e5a93c]' : ''}`}
                    >
                      <span className="block truncate text-sm font-bold text-white">{card.name || maskPhone(card.phone)}</span>
                      {card.name && <span className="block text-[11px] text-[#6b6357]">{maskPhone(card.phone)}</span>}
                      <span className="mt-1.5 block text-xs text-[#C9BCAC]">{card.stepLabel}</span>
                      <span className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                        {card.cartItems > 0 && <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[#C9BCAC]">{card.cartItems} no carrinho</span>}
                        {card.orderNumber && <span className="rounded bg-[#e5a93c]/15 px-1.5 py-0.5 text-[#e5a93c]">{card.orderNumber}</span>}
                        {!card.windowOpen && <span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[#8b8378]">janela fechada</span>}
                      </span>
                      <span className="mt-1.5 block text-[11px] text-[#6b6357]">{since(card.lastInboundAt, now)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      {aberta && <Conversa card={aberta} storeId={storeId} supabase={supabase} onClose={() => setAberta(null)} />}
    </div>
  );
}

function Conversa({ card, storeId, supabase, onClose }: { card: KanbanCard; storeId: string; supabase: Supabase; onClose: () => void }) {
  const [mensagens, setMensagens] = useState<Mensagem[] | null>(null);

  useEffect(() => {
    let vivo = true;
    setMensagens(null);
    void Promise.all([
      supabase.from('whatsapp_inbound').select('id,received_at,content_type,body').eq('store_id', storeId).eq('from_phone', card.phone).order('received_at', { ascending: false }).limit(60),
      supabase.from('whatsapp_outbox').select('id,created_at,event,status,payload').eq('store_id', storeId).eq('recipient', card.phone).order('created_at', { ascending: false }).limit(60),
    ]).then(([entradas, saidas]) => {
      if (!vivo) return;
      const lista: Mensagem[] = [
        ...((entradas.data ?? []) as Array<{ id: string; received_at: string; content_type: string; body: string | null }>).map((m) => ({
          id: m.id,
          at: m.received_at,
          dir: 'in' as const,
          text: m.body?.trim() || (m.content_type === 'image' || m.content_type === 'document' ? '📎 Comprovativo / ficheiro' : `(${m.content_type})`),
        })),
        ...((saidas.data ?? []) as Array<{ id: string; created_at: string; event: string; status: string; payload: unknown }>).map((m) => ({
          id: m.id,
          at: m.created_at,
          dir: 'out' as const,
          text: outboundText(m.payload) ?? `Aviso: ${eventLabel(m.event)}`,
          status: m.status,
        })),
      ];
      lista.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      setMensagens(lista);
    });
    return () => {
      vivo = false;
    };
  }, [supabase, storeId, card.phone]);

  return (
    <section aria-label="Conversa" className="rounded-2xl border border-white/[0.08] p-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-black text-white">{card.name || maskPhone(card.phone)}</h3>
          <p className="text-xs text-[#8b8378]">
            {COLUMN_LABEL[card.column]} · {card.stepLabel}
            {card.orderNumber ? ` · ${card.orderNumber}` : ''}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-[#C9BCAC] hover:bg-white/[0.04]">
          Fechar
        </button>
      </header>

      {!mensagens && <p className="mt-4 text-sm text-[#8b8378]">A carregar a conversa…</p>}
      {mensagens && mensagens.length === 0 && <p className="mt-4 text-sm text-[#8b8378]">Sem mensagens guardadas.</p>}
      {mensagens && mensagens.length > 0 && (
        <ol className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {mensagens.map((m) => (
            <li key={`${m.dir}-${m.id}`} className={`flex ${m.dir === 'in' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.dir === 'in' ? 'rounded-bl-sm bg-white/[0.06] text-white' : 'rounded-br-sm bg-[#e5a93c]/15 text-[#f6e8c3]'}`}>
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                <p className="mt-1 text-[10px] text-[#8b8378]">
                  {hora(m.at)}
                  {m.status ? ` · ${statusLabel(m.status)}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-4 rounded-xl border border-white/[0.06] px-3 py-2 text-[11px] text-[#6b6357]">
        {card.windowOpen
          ? 'Responder daqui chega na fase seguinte. Por agora, o botão "Falar com a loja" do bot leva o cliente ao número de atendimento.'
          : 'Passaram mais de 24 h desde a última mensagem do cliente: a Meta só deixa enviar avisos aprovados (templates).'}
      </p>
    </section>
  );
}
