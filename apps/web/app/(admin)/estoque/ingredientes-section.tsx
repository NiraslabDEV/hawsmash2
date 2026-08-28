'use client';

/**
 * Estoque → Ingredientes.
 *
 * O que se conta aqui é o que a cozinha gasta: carne, queijo, bacon, brisket.
 * O separador Produtos continua a valer para o que se compra pronto e se vende
 * como está (bebidas, natas) — os dois convivem (CLAUDE §10.1).
 *
 * Contar, receber e lançar quebra é do gerente. Mexer no CUSTO é do dono: um
 * custo novo muda a margem de tudo o que vier a seguir.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';

import { createClient } from '@/utils/supabase/client';

type Level = 'ok' | 'low' | 'out';
type AdjustReason = 'receive' | 'waste' | 'count' | 'manual';

type IngredientRow = {
  ingredient_id: string;
  name: string;
  unit: 'un' | 'g' | 'ml';
  cost_cents: number;
  active: boolean;
  track: boolean;
  qty: number;
  low_qty: number;
  value_cents: number;
  level: Level;
};

type Movement = {
  id: string;
  created_at: string;
  ingredient_id: string;
  ingredient_name: string;
  delta: number;
  qty_after: number;
  reason: 'sale' | 'void' | 'manual' | 'waste' | 'receive' | 'count';
  note: string | null;
  order_number: string | null;
  created_by: string | null;
};

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

const levelClasses: Record<Level, string> = {
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

export default function IngredientesSection({ storeId }: { storeId: string | null }) {
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<IngredientRow[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [movementFor, setMovementFor] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const [dialog, setDialog] = useState<{ row: IngredientRow; reason: AdjustReason } | null>(null);
  const [qtyInput, setQtyInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [lowInput, setLowInput] = useState('');

  const [costDialog, setCostDialog] = useState<IngredientRow | null>(null);
  const [costInput, setCostInput] = useState('');

  const [newName, setNewName] = useState('');
  const [newCost, setNewCost] = useState('');

  useEffect(() => {
    void (async () => {
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) return;
      const { data } = await supabase
        .from('staff_profiles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();
      setIsOwner(data?.role === 'owner');
    })();
  }, [supabase]);

  const refresh = useCallback(async () => {
    if (!storeId) return;
    const [list, history] = await Promise.all([
      supabase.rpc('list_store_ingredients', { p_store_id: storeId }),
      supabase.rpc('list_ingredient_movements', {
        p_store_id: storeId,
        p_ingredient_id: movementFor,
        p_limit: 40,
      }),
    ]);

    if (list.error) {
      setMessage({ tone: 'error', text: `Não foi possível carregar os ingredientes: ${list.error.message}` });
    } else {
      setRows((list.data ?? []) as IngredientRow[]);
    }
    if (!history.error) setMovements((history.data ?? []) as Movement[]);
    setLoading(false);
  }, [movementFor, storeId, supabase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const semCusto = rows.filter((row) => row.cost_cents === 0);
  const valorEmCasa = rows.reduce((total, row) => total + (row.track ? row.value_cents : 0), 0);

  function openDialog(row: IngredientRow, reason: AdjustReason) {
    setDialog({ row, reason });
    setQtyInput('');
    setNoteInput('');
    setLowInput(String(row.low_qty));
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
    const low = Number.parseInt(lowInput, 10);
    if (Number.isInteger(low) && low !== dialog.row.low_qty) {
      await supabase.rpc('set_ingredient_tracking', {
        p_store_id: storeId,
        p_ingredient_id: dialog.row.ingredient_id,
        p_track: dialog.row.track,
        p_low_qty: low,
      });
    }

    const { error } = await supabase.rpc('adjust_store_ingredient', {
      p_store_id: storeId,
      p_ingredient_id: dialog.row.ingredient_id,
      p_reason: dialog.reason,
      p_delta: dialog.reason === 'count' ? null : dialog.reason === 'waste' ? -qty : qty,
      p_new_qty: dialog.reason === 'count' ? qty : null,
      p_note: noteInput.trim(),
    });
    setBusy(false);

    if (error) {
      setMessage({
        tone: 'error',
        text: error.message.includes('ingredient_not_tracked')
          ? 'Liga primeiro a contagem deste ingrediente nesta loja.'
          : error.message.includes('insufficient_stock')
            ? 'A quebra é maior do que a quantidade existente.'
            : `Ajuste recusado: ${error.message}`,
      });
      return;
    }

    setDialog(null);
    setMessage({ tone: 'ok', text: `${adjustLabels[dialog.reason]} registada em ${dialog.row.name}.` });
    await refresh();
  }

  async function toggleTracking(row: IngredientRow) {
    if (!storeId) return;
    setBusy(true);
    const { error } = await supabase.rpc('set_ingredient_tracking', {
      p_store_id: storeId,
      p_ingredient_id: row.ingredient_id,
      p_track: !row.track,
      p_low_qty: null,
    });
    setBusy(false);
    if (error) {
      setMessage({ tone: 'error', text: `Não foi possível actualizar a contagem: ${error.message}` });
      return;
    }
    await refresh();
  }

  async function saveCost() {
    if (!costDialog) return;
    const valor = Number.parseFloat(costInput.replace(',', '.'));
    if (!Number.isFinite(valor) || valor < 0) {
      setMessage({ tone: 'error', text: 'Escreve o custo em meticais (ex.: 75 ou 12,50).' });
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('save_ingredient', {
      p_id: costDialog.ingredient_id,
      p_name: costDialog.name,
      p_cost_cents: Math.round(valor * 100),
      p_unit: costDialog.unit,
      p_active: costDialog.active,
      p_sort: null,
    });
    setBusy(false);
    if (error) {
      setMessage({
        tone: 'error',
        text: error.message.includes('recipe_access_denied')
          ? 'Só o dono pode mexer no custo — é ele que muda a margem.'
          : `Custo recusado: ${error.message}`,
      });
      return;
    }
    setCostDialog(null);
    setMessage({ tone: 'ok', text: `Custo de ${costDialog.name} actualizado.` });
    await refresh();
  }

  async function createIngredient() {
    const valor = Number.parseFloat(newCost.replace(',', '.'));
    if (newName.trim().length < 2) {
      setMessage({ tone: 'error', text: 'Escreve o nome do ingrediente.' });
      return;
    }
    if (!Number.isFinite(valor) || valor < 0) {
      setMessage({ tone: 'error', text: 'Escreve o custo em meticais (ex.: 75).' });
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('save_ingredient', {
      p_name: newName.trim(),
      p_cost_cents: Math.round(valor * 100),
    });
    setBusy(false);
    if (error) {
      setMessage({ tone: 'error', text: `Não foi possível criar: ${error.message}` });
      return;
    }
    setNewName('');
    setNewCost('');
    setMessage({ tone: 'ok', text: 'Ingrediente criado nas duas lojas. Falta contá-lo.' });
    await refresh();
  }

  return (
    <div className="space-y-6">
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

      {semCusto.length > 0 && (
        <section className="rounded-2xl border border-[#e5a93c]/40 bg-[#e5a93c]/[0.07] p-4">
          <h2 className="text-sm font-black uppercase tracking-wide text-[#e5a93c]">
            Custo por preencher · {semCusto.length}
          </h2>
          <p className="mt-1 text-sm text-[#C9BCAC]">
            {semCusto.map((row) => row.name).join(' · ')} — enquanto o custo for 0, estes entram no CMV
            a zero e a margem aparece maior do que é.
          </p>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/[0.08] p-4">
          <span className="text-xs uppercase tracking-wide text-[#8b8378]">Valor em casa</span>
          <p className="mt-1 text-xl font-black text-white">{mt(valorEmCasa)}</p>
          <span className="text-xs text-[#8b8378]">só o que está a ser contado</span>
        </div>
        <div className="rounded-2xl border border-white/[0.08] p-4">
          <span className="text-xs uppercase tracking-wide text-[#8b8378]">A contar</span>
          <p className="mt-1 text-xl font-black text-white">
            {rows.filter((row) => row.track).length} de {rows.length}
          </p>
          <span className="text-xs text-[#8b8378]">o resto não trava a venda</span>
        </div>
        <div className="rounded-2xl border border-white/[0.08] p-4">
          <span className="text-xs uppercase tracking-wide text-[#8b8378]">Em rotura</span>
          <p className="mt-1 text-xl font-black text-white">
            {rows.filter((row) => row.track && row.level !== 'ok').length}
          </p>
          <span className="text-xs text-[#8b8378]">esgotado ou crítico</span>
        </div>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-white/[0.08]">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-[#8b8378]">
            <tr>
              <th className="px-4 py-3">Ingrediente</th>
              <th className="px-4 py-3">Custo</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Quantidade</th>
              <th className="px-4 py-3">Mínimo</th>
              <th className="px-4 py-3">Acções</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[#8b8378]">
                  A carregar os ingredientes…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[#8b8378]">
                  Ainda não há ingredientes. Cria o primeiro em baixo.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.ingredient_id} className="border-t border-white/[0.06]">
                <td className="px-4 py-3">
                  <span className="block font-bold text-white">{row.name}</span>
                  <span className="text-xs text-[#8b8378]">por {row.unit}</span>
                </td>
                <td className="px-4 py-3">
                  {row.cost_cents === 0 ? (
                    <span className="text-xs font-bold text-[#e5a93c]">por preencher</span>
                  ) : (
                    <span className="text-[#C9BCAC]">{mt(row.cost_cents)}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${levelClasses[row.level]}`}>
                    {row.track
                      ? row.level === 'out'
                        ? 'Esgotado'
                        : row.level === 'low'
                          ? 'Crítico'
                          : 'Em stock'
                      : 'Sem contagem'}
                  </span>
                </td>
                <td className="px-4 py-3 font-black text-white">{row.track ? row.qty : '—'}</td>
                <td className="px-4 py-3 text-[#C9BCAC]">{row.track ? row.low_qty : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void toggleTracking(row)}
                      className="rounded-lg border border-white/10 px-3 py-1 text-xs font-bold text-[#C9BCAC] hover:bg-white/[0.05] disabled:opacity-50"
                    >
                      {row.track ? 'Parar contagem' : 'Contar'}
                    </button>
                    {row.track && (
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
                    {isOwner && (
                      <button
                        type="button"
                        onClick={() => {
                          setCostDialog(row);
                          setCostInput(row.cost_cents ? String(row.cost_cents / 100) : '');
                        }}
                        className="rounded-lg border border-white/10 px-3 py-1 text-xs font-bold text-[#C9BCAC] hover:bg-white/[0.05]"
                      >
                        Custo
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setMovementFor(row.ingredient_id)}
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

      {isOwner && (
        <section className="rounded-2xl border border-white/[0.08] p-4">
          <h2 className="font-black text-white">Novo ingrediente</h2>
          <p className="mt-1 text-sm text-[#8b8378]">
            Nasce nas duas lojas, sem contagem ligada. Depois conta-se e liga-se.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Ex.: Pão brioche"
              className="min-w-52 flex-1 rounded-xl border border-white/10 bg-[#141210] px-4 py-2 text-sm text-white placeholder:text-[#6f6a62]"
            />
            <input
              value={newCost}
              onChange={(event) => setNewCost(event.target.value.replace(/[^0-9.,]/g, ''))}
              placeholder="Custo em MT"
              inputMode="decimal"
              className="w-40 rounded-xl border border-white/10 bg-[#141210] px-4 py-2 text-sm text-white placeholder:text-[#6f6a62]"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void createIngredient()}
              className="rounded-xl bg-[#e5a93c] px-4 py-2 text-sm font-black text-black disabled:opacity-50"
            >
              Criar
            </button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-white/[0.08]">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
          <h2 className="font-black text-white">
            Movimentos
            {movementFor && (
              <span className="text-sm font-normal text-[#8b8378]">
                {' '}
                · {rows.find((row) => row.ingredient_id === movementFor)?.name ?? 'ingrediente'}
              </span>
            )}
          </h2>
          {movementFor && (
            <button
              type="button"
              onClick={() => setMovementFor(null)}
              className="rounded-lg border border-white/10 px-3 py-1 text-xs font-bold text-[#C9BCAC] hover:bg-white/[0.05]"
            >
              Ver todos
            </button>
          )}
        </header>
        <ul className="divide-y divide-white/[0.06]">
          {movements.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-[#8b8378]">
              Ainda não há movimentos de matéria-prima nesta loja.
            </li>
          )}
          {movements.map((movement) => (
            <li key={movement.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="w-28 text-xs text-[#8b8378]">{dateTime(movement.created_at)}</span>
              <span className="flex-1 font-bold text-white">{movement.ingredient_name}</span>
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
                {movement.created_by ? ` · ${movement.created_by}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {dialog && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#151311] p-5">
            <h2 className="text-lg font-black text-white">
              {adjustLabels[dialog.reason]} · {dialog.row.name}
            </h2>
            <p className="mt-1 text-sm text-[#8b8378]">
              {dialog.reason === 'count'
                ? `Tem ${dialog.row.qty}. Escreve a quantidade contada.`
                : dialog.reason === 'waste'
                  ? `Tem ${dialog.row.qty}. Escreve quantas unidades se perderam.`
                  : `Tem ${dialog.row.qty}. Escreve quantas unidades entraram.`}
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
              Avisar abaixo de
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
                onClick={() => void submitAdjustment()}
                className="rounded-xl bg-[#e5a93c] px-4 py-2 text-sm font-black text-black disabled:opacity-50"
              >
                Registar
              </button>
            </div>
          </div>
        </div>
      )}

      {costDialog && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#151311] p-5">
            <h2 className="text-lg font-black text-white">Custo · {costDialog.name}</h2>
            <p className="mt-1 text-sm text-[#8b8378]">
              Quanto custa <strong>uma</strong> unidade, ao HAWSMASH. Vale para as duas lojas e só
              conta para as vendas de agora em diante — a margem do que já foi vendido não muda.
            </p>
            <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-[#8b8378]">
              Custo em MT
              <input
                value={costInput}
                onChange={(event) => setCostInput(event.target.value.replace(/[^0-9.,]/g, ''))}
                inputMode="decimal"
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-lg font-black text-white"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCostDialog(null)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-[#C9BCAC]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveCost()}
                className="rounded-xl bg-[#e5a93c] px-4 py-2 text-sm font-black text-black disabled:opacity-50"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
