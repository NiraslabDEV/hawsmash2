'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  WEEKDAY_SHORT,
  buildPromotionRow,
  describeWeekdays,
  maputoDateInput,
  type PromotionDraft,
  type PromotionKind,
} from '@/lib/admin/promotions';
import { createClient } from '@/utils/supabase/client';

type SavedPromotion = {
  id: string;
  kind: PromotionKind;
  active: boolean;
  label: string;
  weekdays: number[];
  same_item_only: boolean;
  include_counter: boolean;
  min_subtotal_cents: number | null;
  starts_at: string | null;
  ends_at: string | null;
};

type Item = { id: string; name: string; bogo_eligible: boolean; category: string };

const DEFAULTS: Record<PromotionKind, PromotionDraft> = {
  bogo: { active: false, label: 'Compre 1 e leve o 2.º grátis', weekdays: [], sameItemOnly: true, minMT: '', startsOn: '', endsOn: '' },
  free_delivery: { active: false, label: 'Entrega grátis', weekdays: [0, 1, 2, 3, 4, 5, 6], sameItemOnly: true, minMT: '', startsOn: '', endsOn: '' },
};

function toDraft(kind: PromotionKind, p: SavedPromotion | undefined): PromotionDraft {
  if (!p) return DEFAULTS[kind];
  return {
    active: p.active,
    label: p.label,
    weekdays: p.weekdays ?? [],
    sameItemOnly: p.same_item_only,
    includeCounter: p.include_counter,
    minMT: p.min_subtotal_cents ? String(p.min_subtotal_cents / 100) : '',
    startsOn: maputoDateInput(p.starts_at),
    endsOn: maputoDateInput(p.ends_at, true),
  };
}

const input = 'mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white placeholder:text-[#6f6a62]';
const lbl = 'block text-xs font-bold uppercase tracking-wide text-[#8b8378]';

export function RulesSection({ storeId, storeName, onSaved }: { storeId: string; storeName: string; onSaved: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [saved, setSaved] = useState<SavedPromotion[]>([]);
  const [drafts, setDrafts] = useState<Record<PromotionKind, PromotionDraft>>(DEFAULTS);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState<PromotionKind | 'items' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    const [promosRes, itemsRes] = await Promise.all([
      supabase
        .from('promotions')
        .select('id,kind,active,label,weekdays,same_item_only,include_counter,min_subtotal_cents,starts_at,ends_at')
        .eq('store_id', storeId),
      supabase
        .from('menu_items')
        .select('id,name,bogo_eligible,is_gift,menu_categories(name,sort),sort')
        .eq('is_gift', false)
        .order('sort'),
    ]);
    if (promosRes.error) {
      setMessage({
        tone: 'error',
        text: promosRes.error.message.includes('promotions')
          ? 'As promoções ainda não estão instaladas nesta base de dados (migration 1113 por aplicar).'
          : `Não foi possível ler as promoções: ${promosRes.error.message}`,
      });
      return;
    }
    const rows = (promosRes.data ?? []) as SavedPromotion[];
    setSaved(rows);
    setDrafts({
      bogo: toDraft('bogo', rows.find((r) => r.kind === 'bogo')),
      free_delivery: toDraft('free_delivery', rows.find((r) => r.kind === 'free_delivery')),
    });
    type Raw = { id: string; name: string; bogo_eligible: boolean; menu_categories: { name: string; sort: number } | null };
    const list = ((itemsRes.data ?? []) as unknown as Raw[])
      .map((r) => ({ id: r.id, name: r.name, bogo_eligible: r.bogo_eligible, category: r.menu_categories?.name ?? 'Outros', catSort: r.menu_categories?.sort ?? 999 }))
      .sort((a, b) => a.catSort - b.catSort);
    setItems(list);
  }, [storeId, supabase]);

  useEffect(() => {
    setMessage(null);
    void load();
  }, [load]);

  function patch(kind: PromotionKind, p: Partial<PromotionDraft>) {
    setDrafts((d) => ({ ...d, [kind]: { ...d[kind], ...p } }));
  }

  async function save(kind: PromotionKind) {
    setMessage(null);
    const built = buildPromotionRow(storeId, kind, drafts[kind]);
    if (!built.ok) {
      setMessage({ tone: 'error', text: built.error });
      return;
    }
    setBusy(kind);
    const { error } = await supabase.from('promotions').upsert(built.value, { onConflict: 'store_id,kind' }).select('id');
    setBusy(null);
    if (error) {
      setMessage({ tone: 'error', text: `Não gravou: ${error.message}` });
      return;
    }
    setMessage({ tone: 'ok', text: `${kind === 'bogo' ? 'Promo 2x1' : 'Entrega grátis'} guardada em ${storeName}.` });
    await load();
    onSaved();
  }

  async function toggleItem(item: Item) {
    setBusy('items');
    const { error } = await supabase.from('menu_items').update({ bogo_eligible: !item.bogo_eligible }).eq('id', item.id).select('id');
    setBusy(null);
    if (error) {
      setMessage({ tone: 'error', text: `Não gravou o produto: ${error.message}` });
      return;
    }
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, bogo_eligible: !i.bogo_eligible } : i)));
  }

  const eligibleCount = items.filter((i) => i.bogo_eligible).length;
  const visible = items.filter((i) => !filter || i.name.toLowerCase().includes(filter.toLowerCase()));
  const byCategory = visible.reduce<Record<string, Item[]>>((acc, i) => {
    (acc[i.category] ??= []).push(i);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {message && (
        <p className={`rounded-xl border px-4 py-3 text-sm ${message.tone === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
          {message.text}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {(['bogo', 'free_delivery'] as PromotionKind[]).map((kind) => {
          const d = drafts[kind];
          const row = saved.find((r) => r.kind === kind);
          return (
            <section key={kind} className="rounded-2xl border border-white/[0.08] p-5 space-y-4">
              <header className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-black text-white">{kind === 'bogo' ? 'Promo 2x1' : 'Entrega grátis'}</h3>
                  <p className="text-xs text-[#8b8378]">
                    {kind === 'bogo'
                      ? 'Compre um, leve o segundo grátis. Uma unidade grátis por pedido; paga-se a mais cara.'
                      : 'A taxa de entrega fica a 0 quando os produtos, já com descontos, chegam ao mínimo.'}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${row?.active ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-[#8b8378]'}`}>
                  {row?.active ? `Ligada · ${describeWeekdays(row.weekdays)}${row.include_counter ? " · site e balcão" : " · só site"}` : 'Desligada'}
                </span>
              </header>

              <label className="flex items-center gap-3 text-sm font-bold text-white">
                <input type="checkbox" checked={d.active} onChange={(e) => patch(kind, { active: e.target.checked })} className="h-5 w-5 accent-[#e5a93c]" />
                Promoção ligada em {storeName}
              </label>

              <div>
                <span className={lbl}>Frase para o cliente</span>
                <input value={d.label} maxLength={120} onChange={(e) => patch(kind, { label: e.target.value })} className={input} />
              </div>

              <div>
                <span className={lbl}>Dias da semana</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {WEEKDAY_SHORT.map((name, dow) => {
                    const on = d.weekdays.includes(dow);
                    return (
                      <button
                        key={dow}
                        type="button"
                        onClick={() => patch(kind, { weekdays: on ? d.weekdays.filter((x) => x !== dow) : [...d.weekdays, dow] })}
                        className={`rounded-xl border px-3 py-2 text-sm font-bold ${on ? 'border-[#e5a93c] bg-[#e5a93c] text-black' : 'border-white/10 text-[#C9BCAC]'}`}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[11px] text-[#6f6a62]">Conta o dia do turno: se a loja fecha depois da meia-noite, a madrugada ainda é o dia anterior.</p>
              </div>

              {kind === 'bogo' ? (
                <label className="flex items-start gap-3 text-sm text-[#C9BCAC]">
                  <input type="checkbox" checked={d.sameItemOnly} onChange={(e) => patch(kind, { sameItemOnly: e.target.checked })} className="mt-0.5 h-5 w-5 accent-[#e5a93c]" />
                  <span>
                    <strong className="text-white">Só dois do mesmo produto</strong> — recomendado: o par sai do mesmo stock.
                    Desmarcado, quaisquer dois produtos elegíveis formam par.
                  </span>
                </label>
              ) : (
                <div>
                  <span className={lbl}>A partir de (MT, depois dos descontos)</span>
                  <input value={d.minMT} inputMode="decimal" placeholder="1500" onChange={(e) => patch(kind, { minMT: e.target.value })} className={input} />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className={lbl}>Começa (opcional)</span>
                  <input type="date" value={d.startsOn} onChange={(e) => patch(kind, { startsOn: e.target.value })} className={input} />
                </div>
                <div>
                  <span className={lbl}>Último dia (opcional)</span>
                  <input type="date" value={d.endsOn} onChange={(e) => patch(kind, { endsOn: e.target.value })} className={input} />
                </div>
              </div>

              <label className="flex items-start gap-3 text-sm text-[#C9BCAC]">
                <input type="checkbox" checked={Boolean(d.includeCounter)} onChange={(e) => patch(kind, { includeCounter: e.target.checked })} className="mt-0.5 h-5 w-5 accent-[#e5a93c]" />
                <span>
                  <strong className="text-white">Também no balcão (POS)</strong> — e nos pedidos QR de mesa.
                  Desmarcado, só no site.
                </span>
              </label>

              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void save(kind)}
                className="w-full rounded-xl bg-[#e5a93c] px-4 py-3 text-sm font-black text-black disabled:opacity-50"
              >
                {busy === kind ? 'A guardar…' : 'Guardar'}
              </button>
            </section>
          );
        })}
      </div>

      <section className="rounded-2xl border border-white/[0.08] p-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-white">Produtos no 2x1</h3>
            <p className="text-xs text-[#8b8378]">
              {eligibleCount} marcado{eligibleCount === 1 ? '' : 's'}. Vale para todas as lojas; a promoção em si liga-se loja a loja, acima.
            </p>
          </div>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Procurar produto…" className="w-full max-w-xs rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-2 text-sm text-white" />
        </header>
        <div className="mt-4 space-y-4">
          {Object.entries(byCategory).map(([category, list]) => (
            <div key={category}>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[#8b8378]">{category}</p>
              <div className="flex flex-wrap gap-2">
                {list.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={busy === 'items'}
                    onClick={() => void toggleItem(item)}
                    aria-pressed={item.bogo_eligible}
                    className={`rounded-xl border px-3 py-2 text-sm ${item.bogo_eligible ? 'border-[#e5a93c] bg-[#e5a93c]/15 font-bold text-[#e5a93c]' : 'border-white/10 text-[#C9BCAC]'}`}
                  >
                    {item.bogo_eligible ? '✓ ' : ''}
                    {item.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {items.length === 0 && <p className="text-sm text-[#8b8378]">Sem produtos no cardápio.</p>}
        </div>
      </section>
    </div>
  );
}
