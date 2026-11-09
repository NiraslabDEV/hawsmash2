'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { PosIcon } from '@/app/(pos)/pos/pos-icons';
import { enviarAcao, lerCardapio, SemSessao } from '@/lib/garcom/client';

import { CAMPO, Secao, Topo, Vazio, type Aviso } from './ui';

/**
 * O garçom é quem ouve primeiro "acabou o brisket". Marcar aqui tira-o logo do
 * POS, do site e dos outros telemóveis, na loja dele; fica no registo quem foi.
 */
export function Esgotados({ aviso, onSemSessao }: { aviso: (a: Aviso) => void; onSemSessao: () => void }) {
  const [busca, setBusca] = useState('');
  const [aMudar, setAMudar] = useState<string | null>(null);
  const cardapio = useQuery({
    queryKey: ['garcom-cardapio'],
    queryFn: lerCardapio,
    retry: (n, err) => !(err instanceof SemSessao) && n < 2,
  });
  useEffect(() => {
    if (cardapio.error instanceof SemSessao) onSemSessao();
  }, [cardapio.error, onSemSessao]);

  const termo = busca.trim().toLowerCase();
  const itens = useMemo(() => (cardapio.data?.categories ?? []).flatMap((c) => c.items), [cardapio.data]);
  const aVenda = termo ? itens.filter((i) => i.name.toLowerCase().includes(termo)) : [];

  const mudar = async (id: string, nome: string, available: boolean) => {
    setAMudar(id);
    const r = await enviarAcao({ action: 'availability', menuItemId: id, available });
    setAMudar(null);
    if (r.status === 401) return onSemSessao();
    if (!r.ok) return aviso({ tipo: 'erro', texto: r.error ?? 'Não foi possível.' });
    aviso({ tipo: 'ok', texto: available ? `${nome} voltou ao cardápio` : `${nome} marcado como esgotado` });
    setBusca('');
    void cardapio.refetch();
  };

  const esgotados = cardapio.data?.unavailable ?? [];

  return (
    <main className="mx-auto max-w-md pb-28">
      <Topo sobre="Cardápio" titulo="Esgotados" detalhe="Vale logo no POS, no site e nos outros telemóveis.">
        <label className="relative mt-3 block">
          <PosIcon name="search" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-mute" />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Acabou alguma coisa? Procura o artigo"
            aria-label="Procurar o artigo"
            className={`${CAMPO} !py-3 !pl-11`}
          />
        </label>
      </Topo>

      <div className="space-y-5 px-4 pt-4">
        {cardapio.isLoading && <p className="py-8 text-center text-ink-mute">A carregar…</p>}
        {cardapio.error && !(cardapio.error instanceof SemSessao) && (
          <p className="py-6 text-center text-ink-mute">{(cardapio.error as Error).message}</p>
        )}

        {termo && (
          <section className="space-y-2">
            <Secao titulo="À venda" conta={aVenda.length} />
            {aVenda.length === 0 && cardapio.data ? (
              <Vazio>Nada à venda com esse nome.</Vazio>
            ) : (
              <ul className="pos-card divide-y divide-white/[0.06] overflow-hidden">
                {aVenda.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0 truncate font-semibold">{item.name}</span>
                    <button
                      disabled={aMudar === item.id}
                      onClick={() => void mudar(item.id, item.name, false)}
                      className="pos-btn pos-btn--danger !min-h-10 shrink-0 !rounded-xl !px-3.5 text-sm"
                    >
                      <PosIcon name="ban" size={16} />
                      Esgotou
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="space-y-2">
          <Secao titulo="Marcados como esgotados" conta={esgotados.length} />
          {esgotados.length === 0 ? (
            <Vazio>Tudo à venda. Quando acabar alguma coisa, procura-a em cima e toca em &quot;Esgotou&quot;.</Vazio>
          ) : (
            <ul className="pos-card divide-y divide-white/[0.06] overflow-hidden">
              {esgotados.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-red-400" aria-hidden />
                    <span className="truncate text-ink-dim line-through decoration-white/20">{item.name}</span>
                  </span>
                  <button
                    disabled={aMudar === item.id}
                    onClick={() => void mudar(item.id, item.name, true)}
                    className="pos-btn !min-h-10 shrink-0 !rounded-xl !bg-emerald-400/10 !px-3.5 text-sm !text-emerald-300 !shadow-[inset_0_0_0_1px_rgba(52,211,153,0.4)]"
                  >
                    <PosIcon name="check" size={16} strokeWidth={2.6} />
                    Voltou
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
