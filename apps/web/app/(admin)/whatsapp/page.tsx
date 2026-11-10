'use client';

import { useEffect, useState } from 'react';

import { InsightIcon } from '@/components/admin/insights-ui';

import { WhatsAppConversas } from './conversas';
import { WhatsAppDados } from './dados';
import { WhatsAppLigacao } from './ligacao';
import { useStoreWhatsApp } from './use-store-whatsapp';

type Tab = 'conversas' | 'dados' | 'ligacao';
type Loja = { id: string; short_name: string };

const SUBTITLE: Record<Tab, string> = {
  conversas: 'Cada conversa muda de coluna sozinha, conforme o passo em que o cliente está.',
  dados: 'O que saiu e entrou este mês, e o que a Meta vai cobrar.',
  ligacao: 'O número de cada loja, os avisos e a conversa de pedido. Liga e desliga sem deploy.',
};

/**
 * O módulo do WhatsApp (ADR 0011/0012), à parte das Lojas: conversas, dados e
 * ligação de cada número. Só o dono, por agora: a RLS das conversas e o
 * `get_store_whatsapp` (1124/1126) só o deixam a ele.
 */
export default function WhatsAppPage() {
  const [tab, setTab] = useState<Tab>('conversas');
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [lojaId, setLojaId] = useState<string | null>(null);
  const { load, save, supabase } = useStoreWhatsApp(lojaId);

  useEffect(() => {
    void supabase
      .from('stores')
      .select('id,short_name')
      .order('sort')
      .then(({ data }) => {
        const lista = (data ?? []) as Loja[];
        setLojas(lista);
        setLojaId((actual) => actual ?? lista[0]?.id ?? null);
      });
  }, [supabase]);

  return (
    <div className="insights">
      <header className="insight-header">
        <div>
          <p className="insight-eyebrow">Canal</p>
          <h1>WhatsApp</h1>
          <p className="insight-subtitle">{SUBTITLE[tab]}</p>
        </div>
        {lojas.length > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Loja">
            {lojas.map((loja) => (
              <button
                key={loja.id}
                type="button"
                aria-pressed={loja.id === lojaId}
                onClick={() => setLojaId(loja.id)}
                className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                  loja.id === lojaId ? 'border-[#e5a93c] bg-[#e5a93c]/15 text-[#e5a93c]' : 'border-white/10 text-[#C9BCAC] hover:bg-white/[0.04]'
                }`}
              >
                {loja.short_name}
              </button>
            ))}
          </div>
        )}
      </header>

      <nav className="insight-tabs" aria-label="Vistas do WhatsApp">
        <button aria-pressed={tab === 'conversas'} onClick={() => setTab('conversas')}>
          <InsightIcon name="orders" />
          Conversas
        </button>
        <button aria-pressed={tab === 'dados'} onClick={() => setTab('dados')}>
          <InsightIcon name="chart" />
          Dados
        </button>
        <button aria-pressed={tab === 'ligacao'} onClick={() => setTab('ligacao')}>
          <InsightIcon name="globe" />
          Ligação
        </button>
      </nav>

      <div className="mt-6 space-y-6">
        {!lojaId ? (
          <p className="text-sm text-[#8b8378]">A carregar as lojas…</p>
        ) : tab === 'conversas' && load.status !== 'forbidden' ? (
          // As conversas vêm da 1124 (já no LIVE), não do get_store_whatsapp da 1126.
          <WhatsAppConversas key={lojaId} storeId={lojaId} supabase={supabase} />
        ) : load.status === 'loading' ? (
          <p className="text-sm text-[#8b8378]">A carregar o WhatsApp…</p>
        ) : load.status === 'forbidden' ? (
          <p className="text-sm text-[#8b8378]">Só o dono vê o WhatsApp da loja.</p>
        ) : load.status === 'migration' ? (
          <p className="rounded-2xl border border-white/[0.08] p-5 text-sm text-[#8b8378]">
            O WhatsApp fica disponível depois de aplicada a actualização 1126 da base de dados.
          </p>
        ) : load.status === 'error' ? (
          <p className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">{load.text}</p>
        ) : tab === 'dados' ? (
          <WhatsAppDados key={lojaId} whats={load.whats} storeId={lojaId} supabase={supabase} />
        ) : (
          <WhatsAppLigacao key={lojaId} whats={load.whats} save={save} />
        )}
      </div>
    </div>
  );
}
