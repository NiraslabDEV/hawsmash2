'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import {
  availabilityState,
  canMarkAvailability,
  toggleTarget,
  type AvailabilityRow,
  type AvailabilityState,
} from '@/lib/pos/availability';

type MenuCategory = { id: string; name: string; items: Array<{ id: string; name: string }> };

const ESTILO: Record<AvailabilityState, { tile: string; badge: string; texto: string }> = {
  disponivel: {
    tile: 'border-white/10 bg-white/[0.05] active:bg-white/10',
    badge: 'bg-emerald-500/15 text-emerald-200',
    texto: 'À VENDA',
  },
  esgotado: {
    tile: 'border-red-500/50 bg-red-500/[0.12] active:bg-red-500/20',
    badge: 'bg-red-500/25 text-red-100',
    texto: 'ESGOTADO',
  },
  sem_stock: {
    tile: 'border-white/5 bg-white/[0.02] opacity-60',
    badge: 'bg-white/10 text-[#c8bfb0]',
    texto: 'SEM STOCK',
  },
};

/**
 * "Acabou o Double" — do balcão, num toque.
 *
 * Mexe só na disponibilidade da loja deste terminal (`set_item_availability`,
 * 1061). O que o caixa não faz daqui, de propósito: mudar quantidades,
 * contagens ou quebras — isso é o painel de Estoque, do gerente.
 */
export function AvailabilityPanel({
  storeId,
  storeSlug,
  onClose,
}: {
  storeId: string;
  storeSlug: string;
  onClose: () => void;
}) {
  const [supabase] = useState(() => createClient());
  const [role, setRole] = useState<string | null | undefined>(undefined);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [rows, setRows] = useState<Map<string, AvailabilityRow>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Produtos com um toque em curso: não se alterna duas vezes o mesmo. */
  const [pending, setPending] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    const [perfil, menu, stock] = await Promise.all([
      uid
        ? supabase.from('staff_profiles').select('role').eq('user_id', uid).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.rpc('get_menu', { p_store_slug: storeSlug, p_include_unavailable: true }),
      supabase
        .from('store_items')
        .select('menu_item_id,available,track_stock,stock_qty')
        .eq('store_id', storeId),
    ]);

    setRole((perfil.data as { role?: string } | null)?.role ?? null);

    if (menu.error || stock.error) {
      setError('Não consegui carregar o cardápio. Fecha e abre outra vez.');
      setLoading(false);
      return;
    }
    setError(null);
    setCategories(((menu.data as { categories?: MenuCategory[] }).categories ?? []) as MenuCategory[]);
    setRows(
      new Map(
        (stock.data ?? []).map((r) => [
          r.menu_item_id as string,
          {
            available: r.available as boolean,
            track_stock: r.track_stock as boolean,
            stock_qty: r.stock_qty as number,
          },
        ]),
      ),
    );
    setLoading(false);
  }, [storeId, storeSlug, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function alternar(itemId: string, alvo: boolean) {
    if (pending.has(itemId)) return;
    setPending((atual) => new Set(atual).add(itemId));

    const { error: rpcError } = await supabase.rpc('set_item_availability', {
      p_store_id: storeId,
      p_menu_item_id: itemId,
      p_available: alvo,
    });

    setPending((atual) => {
      const seguinte = new Set(atual);
      seguinte.delete(itemId);
      return seguinte;
    });

    if (rpcError) {
      // Recarregar diz a verdade: pode ter sido outro terminal a mexer primeiro.
      setError('Não foi possível mudar esse produto. Actualizei a lista.');
      void load();
      return;
    }
    setError(null);
    setRows((atual) => {
      const seguinte = new Map(atual);
      const linha = seguinte.get(itemId);
      if (linha) seguinte.set(itemId, { ...linha, available: alvo });
      return seguinte;
    });
  }

  const podeMarcar = canMarkAvailability(role);
  const esgotados = categories
    .flatMap((c) => c.items)
    .filter((i) => {
      const linha = rows.get(i.id);
      return linha && availabilityState(linha) !== 'disponivel';
    });

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#0a0807] text-[#f6f1e6]">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
        <div>
          <p className="text-xs font-black tracking-[0.25em] text-[#847e72]">DISPONIBILIDADE</p>
          <h2 className="text-3xl font-black">
            {esgotados.length === 0
              ? 'Tudo à venda'
              : `${esgotados.length} fora do cardápio`}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-16 shrink-0 rounded-2xl bg-white/10 px-6 text-lg font-black active:bg-white/20"
        >
          ← Voltar a vender
        </button>
      </header>

      {error && (
        <p role="alert" className="shrink-0 bg-amber-500/10 px-6 py-3 text-base font-bold text-amber-200">
          {error}
        </p>
      )}

      {role !== undefined && !podeMarcar && !loading && (
        <p className="shrink-0 bg-white/[0.04] px-6 py-4 text-lg font-bold text-[#c8bfb0]">
          Este perfil não marca produtos como esgotados. Pede ao balcão ou ao gerente.
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        {loading && <p className="py-8 text-center text-lg font-bold text-[#847e72]">A carregar…</p>}

        {categories.map((categoria) => (
          <section key={categoria.id}>
            <h3 className="mb-2 text-sm font-black tracking-[0.2em] text-[#847e72]">
              {categoria.name.toUpperCase()}
            </h3>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {categoria.items.map((item) => {
                const linha = rows.get(item.id);
                if (!linha) return null;
                const estado = availabilityState(linha);
                const alvo = toggleTarget(estado);
                const aMexer = pending.has(item.id);
                const desactivado = !podeMarcar || alvo === null || aMexer;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={desactivado}
                    onClick={() => alvo !== null && void alternar(item.id, alvo)}
                    aria-label={`${item.name} — ${ESTILO[estado].texto}${
                      alvo === null ? '' : alvo ? ', tocar para voltar a vender' : ', tocar para marcar esgotado'
                    }`}
                    className={`flex min-h-24 flex-col justify-between rounded-2xl border p-4 text-left ${ESTILO[estado].tile} disabled:cursor-default`}
                  >
                    <span className="text-lg font-black leading-tight">{item.name}</span>
                    <span className="mt-2 flex items-center justify-between gap-2">
                      <span
                        className={`rounded-lg px-2 py-1 text-xs font-black tracking-[0.15em] ${ESTILO[estado].badge}`}
                      >
                        {aMexer ? '…' : ESTILO[estado].texto}
                      </span>
                      {estado === 'sem_stock' && (
                        <span className="text-right text-[11px] font-bold text-[#847e72]">
                          repor no Estoque
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
