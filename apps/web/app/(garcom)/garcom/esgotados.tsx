'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { enviarAcao, lerCardapio, SemSessao } from '@/lib/garcom/client';

/**
 * O garçom é quem ouve primeiro "acabou o brisket". Marcar aqui tira-o logo do
 * POS, do site e dos outros telemóveis, na loja dele; fica no registo quem foi.
 */
export function Esgotados({
  aviso,
  onSemSessao,
}: {
  aviso: (a: { tipo: 'ok' | 'erro'; texto: string }) => void;
  onSemSessao: () => void;
}) {
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
  const itens = useMemo(
    () => (cardapio.data?.categories ?? []).flatMap((c) => c.items),
    [cardapio.data],
  );
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
    <main className="mx-auto max-w-md space-y-4 px-4 pb-24 pt-4">
      <h1 className="font-[family-name:var(--font-display)] text-3xl tracking-wide text-[var(--gold)]">Esgotados</h1>

      {cardapio.isLoading && <p className="py-8 text-center text-[var(--ink-dim)]">A carregar…</p>}
      {cardapio.error && !(cardapio.error instanceof SemSessao) && (
        <p className="py-6 text-center text-[var(--ink-dim)]">{(cardapio.error as Error).message}</p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-dim)]">Acabou alguma coisa?</h2>
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Procura o artigo"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-[var(--gold)]"
        />
        <ul className="space-y-2">
          {aVenda.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <span className="min-w-0 truncate font-semibold">{item.name}</span>
              <button
                disabled={aMudar === item.id}
                onClick={() => void mudar(item.id, item.name, false)}
                className="shrink-0 rounded-xl bg-red-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                Esgotou
              </button>
            </li>
          ))}
        </ul>
        {termo && aVenda.length === 0 && cardapio.data && (
          <p className="text-center text-sm text-[var(--ink-dim)]">Nada à venda com esse nome.</p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-dim)]">
          Marcados como esgotados {esgotados.length > 0 && <span className="text-[var(--gold)]">({esgotados.length})</span>}
        </h2>
        {esgotados.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center text-sm text-[var(--ink-dim)]">
            Nada marcado como esgotado.
          </p>
        ) : (
          <ul className="space-y-2">
            {esgotados.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <span className="min-w-0 truncate">{item.name}</span>
                <button
                  disabled={aMudar === item.id}
                  onClick={() => void mudar(item.id, item.name, true)}
                  className="shrink-0 rounded-xl border border-emerald-400/50 px-4 py-2 text-sm font-bold text-emerald-300 disabled:opacity-60"
                >
                  Voltou
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
