'use client';

/**
 * Estoque → Custos (CMV).
 *
 * Receita, custo da matéria-prima e margem, por produto e por variante, no
 * período escolhido. O custo lido é o que foi GRAVADO na venda — mudar o custo
 * da carne hoje não reescreve a margem de ontem (CLAUDE §10.1).
 *
 * Linha sem ficha técnica entra a custo zero. Em vez de a esconder, o ecrã
 * mostra-a: uma margem de 100% é sempre uma ficha por preencher, não um lucro.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';

import { createClient } from '@/utils/supabase/client';

type Linha = {
  menu_item_id: string | null;
  item_name: string;
  variant_name: string | null;
  qty: number;
  revenue_cents: number;
  cost_cents: number;
  margin_cents: number;
  lines_without_cost: number;
};

type Relatorio = {
  revenue_cents: number;
  cost_cents: number;
  margin_cents: number;
  items: Linha[];
};

type Periodo = 'hoje' | '7' | '30';

const mt = (value: number) => formatMT(value as Cents);

/** Início do dia em Maputo (UTC+2), devolvido em UTC — §11.8. */
function inicioDoDiaEmMaputo(diasAtras: number): Date {
  const agora = new Date();
  const maputo = new Date(agora.getTime() + 2 * 60 * 60 * 1000);
  maputo.setUTCHours(0, 0, 0, 0);
  maputo.setUTCDate(maputo.getUTCDate() - diasAtras);
  return new Date(maputo.getTime() - 2 * 60 * 60 * 1000);
}

export default function CmvSection({ storeId }: { storeId: string | null }) {
  const supabase = useMemo(() => createClient(), []);

  const [periodo, setPeriodo] = useState<Periodo>('hoje');
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    const dias = periodo === 'hoje' ? 0 : Number.parseInt(periodo, 10);
    const desde = inicioDoDiaEmMaputo(dias);
    const ate = new Date();

    const { data, error } = await supabase.rpc('report_cmv', {
      p_store_id: storeId,
      p_from: desde.toISOString(),
      p_to: ate.toISOString(),
    });

    if (error) {
      setErro(`Não foi possível calcular o CMV: ${error.message}`);
      setRelatorio(null);
    } else {
      setErro(null);
      setRelatorio(data as Relatorio);
    }
    setLoading(false);
  }, [periodo, storeId, supabase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const semCusto = relatorio?.items.filter((linha) => linha.cost_cents === 0) ?? [];
  const margemPercent =
    relatorio && relatorio.revenue_cents > 0
      ? Math.round((relatorio.margin_cents / relatorio.revenue_cents) * 100)
      : null;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap gap-2">
        {(
          [
            ['hoje', 'Hoje'],
            ['7', 'Últimos 7 dias'],
            ['30', 'Últimos 30 dias'],
          ] as [Periodo, string][]
        ).map(([valor, label]) => (
          <button
            key={valor}
            type="button"
            onClick={() => setPeriodo(valor)}
            className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
              periodo === valor
                ? 'border-[#e5a93c] bg-[#e5a93c]/15 text-[#e5a93c]'
                : 'border-white/10 text-[#C9BCAC] hover:bg-white/[0.04]'
            }`}
          >
            {label}
          </button>
        ))}
      </section>

      {erro && (
        <p className="rounded-xl border border-[#7a2b2b] bg-[#2a1616] px-4 py-3 text-sm text-[#ffb0b0]">
          {erro}
        </p>
      )}

      {loading && <p className="text-sm text-[#8b8378]">A calcular…</p>}

      {relatorio && (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/[0.08] p-4">
              <span className="text-xs uppercase tracking-wide text-[#8b8378]">Vendas</span>
              <p className="mt-1 text-xl font-black text-white">{mt(relatorio.revenue_cents)}</p>
            </div>
            <div className="rounded-2xl border border-white/[0.08] p-4">
              <span className="text-xs uppercase tracking-wide text-[#8b8378]">
                Custo da matéria-prima
              </span>
              <p className="mt-1 text-xl font-black text-[#ff9b9b]">{mt(relatorio.cost_cents)}</p>
            </div>
            <div className="rounded-2xl border border-white/[0.08] p-4">
              <span className="text-xs uppercase tracking-wide text-[#8b8378]">Margem bruta</span>
              <p className="mt-1 text-xl font-black text-[#a8e0b6]">
                {mt(relatorio.margin_cents)}
                {margemPercent !== null && (
                  <span className="ml-2 text-sm font-bold text-[#8b8378]">{margemPercent}%</span>
                )}
              </p>
            </div>
          </section>

          {semCusto.length > 0 && (
            <p className="rounded-xl border border-[#e5a93c]/40 bg-[#e5a93c]/[0.07] px-4 py-3 text-sm text-[#C9BCAC]">
              <strong className="text-[#e5a93c]">Atenção:</strong> {semCusto.length}{' '}
              {semCusto.length === 1 ? 'produto entrou' : 'produtos entraram'} com custo zero — sem
              ficha técnica ou com ingredientes por custear. A margem acima está mais alta do que a
              real.
            </p>
          )}

          <section className="overflow-x-auto rounded-2xl border border-white/[0.08]">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-[#8b8378]">
                <tr>
                  <th className="px-4 py-3">Produto</th>
                  <th className="px-4 py-3 text-right">Qtd</th>
                  <th className="px-4 py-3 text-right">Vendas</th>
                  <th className="px-4 py-3 text-right">Custo</th>
                  <th className="px-4 py-3 text-right">Margem</th>
                  <th className="px-4 py-3 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {relatorio.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-[#8b8378]">
                      Nenhuma venda neste período.
                    </td>
                  </tr>
                )}
                {relatorio.items.map((linha) => {
                  const percent =
                    linha.revenue_cents > 0
                      ? Math.round((linha.margin_cents / linha.revenue_cents) * 100)
                      : 0;
                  return (
                    <tr
                      key={`${linha.menu_item_id}-${linha.variant_name ?? 'base'}`}
                      className="border-t border-white/[0.06]"
                    >
                      <td className="px-4 py-3">
                        <span className="block font-bold text-white">{linha.item_name}</span>
                        {linha.variant_name && (
                          <span className="text-xs text-[#e5a93c]">{linha.variant_name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-[#C9BCAC]">{linha.qty}</td>
                      <td className="px-4 py-3 text-right text-[#C9BCAC]">
                        {mt(linha.revenue_cents)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {linha.cost_cents === 0 ? (
                          <span className="text-xs font-bold text-[#e5a93c]">sem custo</span>
                        ) : (
                          <span className="text-[#ff9b9b]">{mt(linha.cost_cents)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-black text-[#a8e0b6]">
                        {mt(linha.margin_cents)}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-[#8b8378]">{percent}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
