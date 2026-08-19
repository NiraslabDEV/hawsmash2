'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';

import { createClient } from '@/utils/supabase/client';

type StockLevel = 'ok' | 'low' | 'out';
type AdjustReason = 'receive' | 'waste' | 'count' | 'manual';

type Store = { id: string; slug: string; short_name: string };

type StockRow = {
  menu_item_id: string;
  name: string;
  category_id: string;
  category_name: string;
  available: boolean;
  track_stock: boolean;
  stock_qty: number;
  low_stock_qty: number;
  price_cents: number;
  level: StockLevel;
};

type Movement = {
  id: string;
  created_at: string;
  menu_item_id: string;
  item_name: string;
  delta: number;
  qty_after: number;
  reason: 'sale' | 'void' | 'manual' | 'waste' | 'receive' | 'count';
  note: string | null;
  order_id: string | null;
  order_number: string | null;
  actor_name: string | null;
};

type Alert = {
  store_id: string;
  store_name: string;
  menu_item_id: string;
  item_name: string;
  stock_qty: number;
  low_stock_qty: number;
  level: Exclude<StockLevel, 'ok'>;
};

const MOVEMENT_PAGE = 25;

const reasonLabels: Record<Movement['reason'], string> = {
  sale: 'Venda',
  void: 'Anulação',
  manual: 'Ajuste',
  waste: 'Quebra',
  receive: 'Entrada',
  count: 'Contagem',
};

const adjustLabels: Record<AdjustReason, string> = {
  receive: 'Entrada',
  waste: 'Quebra',
  count: 'Contagem',
  manual: 'Ajuste',
};

const levelLabels: Record<StockLevel, string> = {
  ok: 'Em stock',
  low: 'Crítico',
  out: 'Esgotado',
};

const levelClasses: Record<StockLevel, string> = {
  ok: 'bg-white/[0.06] text-[#C9BCAC]',
  low: 'bg-[#e5a93c]/20 text-[#e5a93c]',
  out: 'bg-[#7a2b2b]/40 text-[#ff9b9b]',
};

const mt = (value: number) => formatMT(value as Cents);
const dateTime = (iso: string) =>
  new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Africa/Maputo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));

export default function EstoquePage() {
  const supabase = useMemo(() => createClient(), []);

  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [movementTotal, setMovementTotal] = useState(0);
  const [movementItem, setMovementItem] = useState<string | null>(null);
  const [movementLimit, setMovementLimit] = useState(MOVEMENT_PAGE);
  const [search, setSearch] = useState('');
  const [onlyTracked, setOnlyTracked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [dialog, setDialog] = useState<{ row: StockRow; reason: AdjustReason } | null>(null);
  const [qtyInput, setQtyInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [lowInput, setLowInput] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error } = await supabase
        .from('stores')
        .select('id,slug,short_name')
        .eq('active', true)
        .order('sort');
      if (!active) return;
      if (error || !data?.length) {
        setMessage({ tone: 'error', text: 'Não foi possível listar as lojas a que tens acesso.' });
        setLoading(false);
        return;
      }
      setStores(data as Store[]);
      setStoreId((current) => current ?? (data[0] as Store).id);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  const refresh = useCallback(async () => {
    if (!storeId) return;
    const [stock, alertList, movementList] = await Promise.all([
      supabase.rpc('list_store_stock', {
        p_store_id: storeId,
        p_only_tracked: onlyTracked,
        p_limit: 500,
        p_offset: 0,
      }),
      supabase.rpc('list_stock_alerts', { p_store_id: storeId }),
      supabase.rpc('list_stock_movements', {
        p_store_id: storeId,
        p_menu_item_id: movementItem,
        p_limit: movementLimit,
        p_offset: 0,
      }),
    ]);

    if (stock.error || !stock.data) {
      setMessage({ tone: 'error', text: `Não foi possível carregar o estoque: ${stock.error?.message ?? 'erro desconhecido'}` });
    } else {
      setRows((stock.data as { items: StockRow[] }).items);
    }
    if (!alertList.error && alertList.data) setAlerts(alertList.data as Alert[]);
    if (!movementList.error && movementList.data) {
      const payload = movementList.data as { movements: Movement[]; total: number };
      setMovements(payload.movements);
      setMovementTotal(payload.total);
    }
    setLoading(false);
  }, [movementItem, movementLimit, onlyTracked, storeId, supabase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (row) =>
        row.name.toLowerCase().includes(term) || row.category_name.toLowerCase().includes(term),
    );
  }, [rows, search]);

  const trackedCount = rows.filter((row) => row.track_stock).length;
  const selectedStore = stores.find((store) => store.id === storeId) ?? null;

  function openDialog(row: StockRow, reason: AdjustReason) {
    setDialog({ row, reason });
    setQtyInput('');
    setNoteInput('');
    setLowInput(String(row.low_stock_qty));
  }

  async function submitAdjustment() {
    if (!dialog || !storeId) return;
    const qty = Number.parseInt(qtyInput, 10);
    if (!Number.isInteger(qty) || qty < 0) {
      setMessage({ tone: 'error', text: 'Indica uma quantidade inteira e não negativa.' });
      return;
    }
    if (noteInput.trim().length < 3) {
      setMessage({ tone: 'error', text: 'Escreve um motivo com pelo menos 3 caracteres.' });
      return;
    }

    setBusy(true);
    const { error } = await supabase.rpc('adjust_store_stock', {
      p_store_id: storeId,
      p_menu_item_id: dialog.row.menu_item_id,
      p_reason: dialog.reason,
      p_delta: dialog.reason === 'count' ? null : dialog.reason === 'waste' ? -qty : qty,
      p_new_qty: dialog.reason === 'count' ? qty : null,
      p_note: noteInput.trim(),
    });
    setBusy(false);

    if (error) {
      setMessage({
        tone: 'error',
        text: error.message.includes('stock_not_tracked')
          ? 'Liga primeiro o controlo de stock deste item nesta loja.'
          : error.message.includes('insufficient_stock')
            ? 'A quebra é maior do que o stock existente.'
            : `Ajuste recusado: ${error.message}`,
      });
      return;
    }

    setDialog(null);
    setMessage({
      tone: 'ok',
      text: `${adjustLabels[dialog.reason]} registada em ${dialog.row.name}.`,
    });
    await refresh();
  }

  async function toggleTracking(row: StockRow, nextLow?: number) {
    if (!storeId) return;
    setBusy(true);
    const { error } = await supabase.rpc('set_stock_tracking', {
      p_store_id: storeId,
      p_menu_item_id: row.menu_item_id,
      p_track_stock: nextLow === undefined ? !row.track_stock : row.track_stock,
      p_low_stock_qty: nextLow ?? null,
    });
    setBusy(false);
    if (error) {
      setMessage({ tone: 'error', text: `Não foi possível actualizar o controlo: ${error.message}` });
      return;
    }
    await refresh();
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">Estoque</h1>
          <p className="text-sm text-[#8b8378]">
            {selectedStore ? `Loja ${selectedStore.short_name}` : 'A carregar…'} ·{' '}
            {trackedCount} {trackedCount === 1 ? 'item controlado' : 'itens controlados'}
          </p>
        </div>
        {stores.length > 1 && (
          <div className="flex gap-2">
            {stores.map((store) => (
              <button
                key={store.id}
                type="button"
                onClick={() => {
                  setStoreId(store.id);
                  setMovementItem(null);
                  setMovementLimit(MOVEMENT_PAGE);
                }}
                className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                  store.id === storeId
                    ? 'border-[#e5a93c] bg-[#e5a93c]/15 text-[#e5a93c]'
                    : 'border-white/10 text-[#C9BCAC] hover:bg-white/[0.04]'
                }`}
              >
                {store.short_name}
              </button>
            ))}
          </div>
        )}
      </header>

      {message && (
        <p
          className={`rounded-xl border px-4 py-3 text-sm ${
            message.tone === 'ok'
              ? 'border-[#2f6b3f] bg-[#16281c] text-[#a8e0b6]'
              : 'border-[#7a2b2b] bg-[#2a1616] text-[#ffb0b0]'
          }`}
        >
          {message.text}
        </p>
      )}

      {alerts.length > 0 && (
        <section className="rounded-2xl border border-[#e5a93c]/40 bg-[#e5a93c]/[0.07] p-4">
          <h2 className="text-sm font-black uppercase tracking-wide text-[#e5a93c]">
            Rotura · {alerts.length} {alerts.length === 1 ? 'item' : 'itens'}
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {alerts.map((alert) => (
              <li
                key={`${alert.store_id}-${alert.menu_item_id}`}
                className={`rounded-full px-3 py-1 text-xs font-bold ${levelClasses[alert.level]}`}
              >
                {alert.item_name} · {alert.stock_qty} un.
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Procurar item ou categoria"
          className="min-w-56 flex-1 rounded-xl border border-white/10 bg-[#141210] px-4 py-2 text-sm text-white placeholder:text-[#6f6a62]"
        />
        <label className="flex items-center gap-2 text-sm text-[#C9BCAC]">
          <input
            type="checkbox"
            checked={onlyTracked}
            onChange={(event) => setOnlyTracked(event.target.checked)}
            className="h-4 w-4 accent-[#e5a93c]"
          />
          Só itens com stock controlado
        </label>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-white/[0.08]">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-[#8b8378]">
            <tr>
              <th className="px-4 py-3">Item</th>
              <th className="px-4 py-3">Preço</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Stock</th>
              <th className="px-4 py-3">Mínimo</th>
              <th className="px-4 py-3">Acções</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[#8b8378]">
                  A carregar o estoque…
                </td>
              </tr>
            )}
            {!loading && visibleRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[#8b8378]">
                  Nenhum item corresponde a esta procura.
                </td>
              </tr>
            )}
            {visibleRows.map((row) => (
              <tr key={row.menu_item_id} className="border-t border-white/[0.06]">
                <td className="px-4 py-3">
                  <span className="block font-bold text-white">{row.name}</span>
                  <span className="text-xs text-[#8b8378]">{row.category_name}</span>
                </td>
                <td className="px-4 py-3 text-[#C9BCAC]">{mt(row.price_cents)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${levelClasses[row.level]}`}>
                    {row.track_stock ? levelLabels[row.level] : 'Sem controlo'}
                  </span>
                </td>
                <td className="px-4 py-3 font-black text-white">
                  {row.track_stock ? row.stock_qty : '—'}
                </td>
                <td className="px-4 py-3 text-[#C9BCAC]">{row.track_stock ? row.low_stock_qty : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void toggleTracking(row)}
                      className="rounded-lg border border-white/10 px-3 py-1 text-xs font-bold text-[#C9BCAC] hover:bg-white/[0.05] disabled:opacity-50"
                    >
                      {row.track_stock ? 'Desligar controlo' : 'Controlar stock'}
                    </button>
                    {row.track_stock && (
                      <>
                        <button
                          type="button"
                          onClick={() => openDialog(row, 'receive')}
                          className="rounded-lg border border-white/10 px-3 py-1 text-xs font-bold text-[#C9BCAC] hover:bg-white/[0.05]"
                        >
                          Entrada
                        </button>
                        <button
                          type="button"
                          onClick={() => openDialog(row, 'waste')}
                          className="rounded-lg border border-white/10 px-3 py-1 text-xs font-bold text-[#C9BCAC] hover:bg-white/[0.05]"
                        >
                          Quebra
                        </button>
                        <button
                          type="button"
                          onClick={() => openDialog(row, 'count')}
                          className="rounded-lg border border-white/10 px-3 py-1 text-xs font-bold text-[#C9BCAC] hover:bg-white/[0.05]"
                        >
                          Contagem
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setMovementItem(row.menu_item_id);
                        setMovementLimit(MOVEMENT_PAGE);
                      }}
                      className="rounded-lg border border-white/10 px-3 py-1 text-xs font-bold text-[#C9BCAC] hover:bg-white/[0.05]"
                    >
                      Histórico
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-2xl border border-white/[0.08]">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
          <h2 className="font-black text-white">
            Movimentos{' '}
            {movementItem && (
              <span className="text-sm font-normal text-[#8b8378]">
                · {rows.find((row) => row.menu_item_id === movementItem)?.name ?? 'item'}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-3 text-xs text-[#8b8378]">
            <span>
              {movements.length} de {movementTotal}
            </span>
            {movementItem && (
              <button
                type="button"
                onClick={() => {
                  setMovementItem(null);
                  setMovementLimit(MOVEMENT_PAGE);
                }}
                className="rounded-lg border border-white/10 px-3 py-1 font-bold text-[#C9BCAC] hover:bg-white/[0.05]"
              >
                Ver todos
              </button>
            )}
          </div>
        </header>
        <ul className="divide-y divide-white/[0.06]">
          {movements.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-[#8b8378]">
              Ainda não há movimentos registados nesta loja.
            </li>
          )}
          {movements.map((movement) => (
            <li key={movement.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="w-28 text-xs text-[#8b8378]">{dateTime(movement.created_at)}</span>
              <span className="flex-1 font-bold text-white">{movement.item_name}</span>
              <span className="rounded-full bg-white/[0.06] px-2 py-1 text-xs font-bold text-[#C9BCAC]">
                {reasonLabels[movement.reason]}
              </span>
              <span
                className={`w-16 text-right font-black ${
                  movement.delta < 0 ? 'text-[#ff9b9b]' : 'text-[#a8e0b6]'
                }`}
              >
                {movement.delta > 0 ? `+${movement.delta}` : movement.delta}
              </span>
              <span className="w-16 text-right text-xs text-[#8b8378]">→ {movement.qty_after}</span>
              <span className="w-full text-xs text-[#8b8378] sm:w-auto sm:flex-1">
                {movement.order_number ? `Pedido ${movement.order_number}` : movement.note}
                {movement.actor_name ? ` · ${movement.actor_name}` : ''}
              </span>
            </li>
          ))}
        </ul>
        {movements.length < movementTotal && (
          <footer className="border-t border-white/[0.06] px-4 py-3">
            <button
              type="button"
              onClick={() => setMovementLimit((current) => current + MOVEMENT_PAGE)}
              className="rounded-lg border border-white/10 px-3 py-1 text-xs font-bold text-[#C9BCAC] hover:bg-white/[0.05]"
            >
              Ver mais
            </button>
          </footer>
        )}
      </section>

      {dialog && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#151311] p-5">
            <h2 className="text-lg font-black text-white">
              {adjustLabels[dialog.reason]} · {dialog.row.name}
            </h2>
            <p className="mt-1 text-sm text-[#8b8378]">
              {dialog.reason === 'count'
                ? `Stock actual: ${dialog.row.stock_qty}. Escreve a quantidade contada.`
                : dialog.reason === 'waste'
                  ? `Stock actual: ${dialog.row.stock_qty}. Escreve quantas unidades se perderam.`
                  : `Stock actual: ${dialog.row.stock_qty}. Escreve quantas unidades entraram.`}
            </p>

            <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-[#8b8378]">
              Quantidade
              <input
                value={qtyInput}
                onChange={(event) => setQtyInput(event.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-lg font-black text-white"
              />
            </label>

            <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[#8b8378]">
              Motivo
              <input
                value={noteInput}
                onChange={(event) => setNoteInput(event.target.value)}
                placeholder="Ex.: entrega do fornecedor"
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white placeholder:text-[#6f6a62]"
              />
            </label>

            <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[#8b8378]">
              Alerta abaixo de
              <input
                value={lowInput}
                onChange={(event) => setLowInput(event.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white"
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog(null)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-[#C9BCAC]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const low = Number.parseInt(lowInput, 10);
                  if (Number.isInteger(low) && low !== dialog.row.low_stock_qty) {
                    await toggleTracking(dialog.row, low);
                  }
                  await submitAdjustment();
                }}
                className="rounded-xl bg-[#e5a93c] px-4 py-2 text-sm font-black text-black disabled:opacity-50"
              >
                Registar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
