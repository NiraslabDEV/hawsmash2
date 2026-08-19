'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';

import { parseMTInput } from '@/lib/cash/input';
import { createClient } from '@/utils/supabase/client';

type MovementType = 'sangria' | 'reforco' | 'despesa' | 'troco_inicial';
type CashMovement = {
  id: string;
  type: MovementType;
  amount_cents: number;
  reason: string;
  created_at: string;
};
type CashHistory = {
  id: string;
  shift_label: string;
  opened_at: string;
  closed_at: string;
  expected_cash_cents: number;
  counted_cash_cents: number;
  difference_cents: number;
  difference_reason: string | null;
};
type StoreCash = {
  store_id: string;
  store_slug: string;
  store_name: string;
  period_start: string;
  has_open_session: boolean;
  open_session: {
    id: string;
    shift_label: string;
    opened_at: string;
    opening_float_cents: number;
  } | null;
  total_pedidos: number;
  total_faturado_cents: number;
  cash_sales_cents: number;
  mpesa_cents: number;
  emola_cents: number;
  credit_card_cents: number;
  sangria_cents: number;
  reforco_cents: number;
  despesa_cents: number;
  expected_cash_cents: number;
  movements: CashMovement[];
  history: CashHistory[];
};
type Dashboard = {
  can_consolidate: boolean;
  role: string;
  stores: StoreCash[];
  consolidated: {
    total_pedidos: number;
    total_faturado_cents: number;
    cash_sales_cents: number;
    mpesa_cents: number;
    emola_cents: number;
    credit_card_cents: number;
    expected_cash_cents: number;
  };
};

const mt = (value: number) => {
  const absolute = formatMT(Math.abs(value) as Cents);
  return value < 0 ? `-${absolute}` : absolute;
};
const dateTime = (iso: string) =>
  new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Africa/Maputo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
const movementLabels: Record<MovementType, string> = {
  sangria: 'Sangria',
  reforco: 'Reforço',
  despesa: 'Despesa',
  troco_inicial: 'Troco inicial adicional',
};

export default function CaixaPage() {
  const supabase = useMemo(() => createClient(), []);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'open' | 'movement' | 'close' | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [reason, setReason] = useState('');
  const [movementType, setMovementType] = useState<MovementType>('sangria');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_cash_dashboard', { p_store: null });
    if (error || !data) {
      setMessage({ tone: 'error', text: `Não foi possível carregar o caixa: ${error?.message ?? 'erro desconhecido'}` });
    } else {
      const next = data as Dashboard;
      setDashboard(next);
      if (!next.can_consolidate || next.stores.length === 1) {
        setSelectedStoreId(next.stores[0]?.store_id ?? 'all');
      }
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const selectedStore = dashboard?.stores.find((store) => store.store_id === selectedStoreId) ?? null;
  const summary = selectedStore ?? dashboard?.consolidated ?? null;
  const closeDifference = selectedStore
    ? (parseMTInput(amountInput) ?? 0) - selectedStore.expected_cash_cents
    : 0;

  function resetDialog() {
    setDialog(null);
    setAmountInput('');
    setReason('');
    setMovementType('sangria');
  }

  async function openSession() {
    if (!selectedStore) return;
    const openingFloat = parseMTInput(amountInput);
    if (openingFloat === null) {
      setMessage({ tone: 'error', text: 'Indica um fundo inicial válido em MT.' });
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('open_cash_session', {
      p_store: selectedStore.store_id,
      p_float: openingFloat,
    });
    setBusy(false);
    if (error) {
      setMessage({ tone: 'error', text: `Não foi possível abrir o caixa: ${error.message}` });
      return;
    }
    resetDialog();
    setMessage({ tone: 'ok', text: `Caixa de ${selectedStore.store_name} aberto.` });
    await refresh();
  }

  async function addMovement() {
    if (!selectedStore) return;
    const amount = parseMTInput(amountInput);
    if (amount === null || amount === 0 || reason.trim().length < 3) {
      setMessage({ tone: 'error', text: 'Indica um valor positivo e um motivo com pelo menos 3 caracteres.' });
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('add_cash_movement', {
      p_store: selectedStore.store_id,
      p_type: movementType,
      p_amount_cents: amount,
      p_reason: reason.trim(),
    });
    setBusy(false);
    if (error) {
      setMessage({ tone: 'error', text: `Movimento recusado: ${error.message}` });
      return;
    }
    resetDialog();
    setMessage({ tone: 'ok', text: `${movementLabels[movementType]} registado e auditado.` });
    await refresh();
  }

  async function closeSession() {
    if (!selectedStore) return;
    const counted = parseMTInput(amountInput);
    if (counted === null) {
      setMessage({ tone: 'error', text: 'Indica o valor contado na gaveta.' });
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc('close_cash_session', {
      p_store: selectedStore.store_id,
      p_counted: counted,
      p_reason: reason.trim() || null,
    });
    setBusy(false);
    if (error) {
      setMessage({
        tone: 'error',
        text: error.message.includes('difference_reason_required')
          ? 'A diferença ultrapassa a tolerância. Indica o motivo antes de fechar.'
          : `Fecho recusado: ${error.message}`,
      });
      return;
    }
    const sessionId = (data as { session_id: string }).session_id;
    void fetch('/api/emails/send-cash-close-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).catch(() => undefined);
    resetDialog();
    setMessage({ tone: 'ok', text: `Caixa de ${selectedStore.store_name} fechado. Talão em fila e relatório disponível.` });
    await refresh();
  }

  if (loading) return <p className="py-20 text-center font-bold text-[#F5A623]">A carregar caixa…</p>;
  if (!dashboard || !summary) return <p className="py-20 text-center text-red-300">Caixa indisponível.</p>;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#F5A623]">Operação por turno</p>
          <h1 className="mt-1 text-3xl font-black text-white">Caixa</h1>
          <p className="mt-1 text-sm text-[#A99C8C]">Valores em tempo real desde o último fecho de cada loja.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {dashboard.can_consolidate && (
            <select
              aria-label="Loja do caixa"
              value={selectedStoreId}
              onChange={(event) => setSelectedStoreId(event.target.value)}
              className="min-h-12 rounded-xl border border-white/10 bg-[#1A1511] px-4 font-bold text-white"
            >
              <option value="all">Todas as lojas</option>
              {dashboard.stores.map((store) => <option key={store.store_id} value={store.store_id}>{store.store_name}</option>)}
            </select>
          )}
          <button type="button" onClick={() => void refresh()} className="min-h-12 rounded-xl border border-white/10 px-4 font-bold text-[#E8DDCF]">Actualizar</button>
        </div>
      </header>

      {message && (
        <div role="status" className={`rounded-xl border px-4 py-3 text-sm font-bold ${message.tone === 'ok' ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border-red-400/30 bg-red-500/10 text-red-200'}`}>
          {message.text}
        </div>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Facturado" value={mt(summary.total_faturado_cents)} accent />
        <Metric label="Dinheiro vendido" value={mt(summary.cash_sales_cents)} />
        <Metric label="Esperado nas gavetas" value={mt(summary.expected_cash_cents)} />
        <Metric label="Pedidos" value={String(summary.total_pedidos)} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Payment label="M-Pesa" value={summary.mpesa_cents} />
        <Payment label="e-Mola" value={summary.emola_cents} />
        <Payment label="Cartão" value={summary.credit_card_cents} />
        <Payment label="Dinheiro" value={summary.cash_sales_cents} />
      </section>

      {selectedStore ? (
        <>
          <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-black text-white">{selectedStore.store_name}</h2>
                {selectedStore.open_session ? (
                  <p className="mt-1 text-sm text-emerald-300">{selectedStore.open_session.shift_label} · aberto às {dateTime(selectedStore.open_session.opened_at)}</p>
                ) : <p className="mt-1 text-sm text-amber-300">Sem turno aberto</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {!selectedStore.has_open_session ? (
                  <button type="button" onClick={() => setDialog('open')} className="min-h-12 rounded-xl bg-[#F5A623] px-5 font-black text-[#24150D]">Abrir caixa</button>
                ) : (
                  <>
                    <button type="button" onClick={() => setDialog('movement')} className="min-h-12 rounded-xl border border-[#F5A623]/40 px-5 font-bold text-[#F5A623]">Movimento</button>
                    <button type="button" onClick={() => setDialog('close')} className="min-h-12 rounded-xl bg-[#F5A623] px-5 font-black text-[#24150D]">Fechar caixa</button>
                  </>
                )}
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-4">
              <SmallMetric label="Fundo" value={mt(selectedStore.open_session?.opening_float_cents ?? 0)} />
              <SmallMetric label="Sangrias" value={mt(selectedStore.sangria_cents)} />
              <SmallMetric label="Reforços" value={mt(selectedStore.reforco_cents)} />
              <SmallMetric label="Despesas" value={mt(selectedStore.despesa_cents)} />
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            <ListSection title="Movimentos do turno" empty="Sem movimentos neste turno.">
              {selectedStore.movements.map((movement) => (
                <div key={movement.id} className="flex items-center justify-between gap-4 border-b border-white/5 py-3 last:border-0">
                  <div><p className="font-bold text-white">{movementLabels[movement.type]}</p><p className="text-xs text-[#938779]">{movement.reason} · {dateTime(movement.created_at)}</p></div>
                  <strong className="text-[#F5A623]">{mt(movement.amount_cents)}</strong>
                </div>
              ))}
            </ListSection>
            <ListSection title="Histórico de fechos" empty="Ainda não existem fechos.">
              {selectedStore.history.map((item) => (
                <div key={item.id} className="flex items-center gap-3 border-b border-white/5 py-3 last:border-0">
                  <div className="min-w-0 flex-1"><p className="truncate font-bold text-white">{item.shift_label}</p><p className="text-xs text-[#938779]">{dateTime(item.closed_at)}</p></div>
                  <div className="text-right"><p className="font-bold text-white">{mt(item.expected_cash_cents)}</p><p className={item.difference_cents === 0 ? 'text-xs text-[#938779]' : 'text-xs text-amber-300'}>{mt(item.difference_cents)}</p></div>
                  <a href={`/api/cash-sessions/${item.id}/report`} className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-[#F5A623]">PDF</a>
                </div>
              ))}
            </ListSection>
          </section>
        </>
      ) : (
        <section className="grid gap-4 lg:grid-cols-2">
          {dashboard.stores.map((store) => (
            <button key={store.store_id} type="button" onClick={() => setSelectedStoreId(store.store_id)} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-left transition hover:border-[#F5A623]/40">
              <div className="flex items-center justify-between"><h2 className="text-xl font-black text-white">{store.store_name}</h2><span className={store.has_open_session ? 'text-xs font-black text-emerald-300' : 'text-xs font-black text-amber-300'}>{store.has_open_session ? 'ABERTO' : 'FECHADO'}</span></div>
              <div className="mt-5 grid grid-cols-2 gap-3"><SmallMetric label="Facturado" value={mt(store.total_faturado_cents)} /><SmallMetric label="Esperado" value={mt(store.expected_cash_cents)} /></div>
            </button>
          ))}
        </section>
      )}

      {dialog && selectedStore && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4">
          <section role="dialog" aria-modal="true" className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#17120E] p-6 shadow-2xl">
            <h2 className="text-2xl font-black text-white">{dialog === 'open' ? 'Abrir caixa' : dialog === 'movement' ? 'Registar movimento' : 'Fechar caixa'}</h2>
            <p className="mt-1 text-sm text-[#A99C8C]">{selectedStore.store_name}</p>
            {dialog === 'movement' && (
              <select aria-label="Tipo de movimento" value={movementType} onChange={(event) => setMovementType(event.target.value as MovementType)} className="mt-5 min-h-12 w-full rounded-xl border border-white/10 bg-black/30 px-4 text-white">
                {Object.entries(movementLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            )}
            {dialog === 'close' && <p className="mt-5 rounded-xl bg-black/25 p-4 text-sm text-[#C9BCAC]">Esperado na gaveta: <strong className="text-white">{mt(selectedStore.expected_cash_cents)}</strong></p>}
            <label className="mt-5 block text-sm font-bold text-[#C9BCAC]" htmlFor="cash-amount">{dialog === 'open' ? 'Fundo inicial (MT)' : dialog === 'close' ? 'Valor contado (MT)' : 'Valor (MT)'}</label>
            <input id="cash-amount" inputMode="decimal" value={amountInput} onChange={(event) => setAmountInput(event.target.value)} placeholder="0,00" className="mt-2 min-h-14 w-full rounded-xl border border-white/10 bg-black/30 px-4 text-xl font-black text-white outline-none focus:border-[#F5A623]" />
            {dialog === 'close' && amountInput && <p className="mt-3 text-sm text-[#C9BCAC]">Diferença: <strong className={closeDifference === 0 ? 'text-emerald-300' : 'text-amber-300'}>{mt(closeDifference)}</strong></p>}
            {dialog !== 'open' && (
              <><label className="mt-5 block text-sm font-bold text-[#C9BCAC]" htmlFor="cash-reason">Motivo {dialog === 'movement' ? '(obrigatório)' : '(obrigatório acima da tolerância)'}</label><textarea id="cash-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-4 text-white outline-none focus:border-[#F5A623]" /></>
            )}
            <div className="mt-6 flex gap-3"><button type="button" disabled={busy} onClick={resetDialog} className="min-h-12 flex-1 rounded-xl border border-white/10 font-bold text-[#C9BCAC]">Cancelar</button><button type="button" disabled={busy} onClick={() => void (dialog === 'open' ? openSession() : dialog === 'movement' ? addMovement() : closeSession())} className="min-h-12 flex-1 rounded-xl bg-[#F5A623] font-black text-[#24150D] disabled:opacity-50">{busy ? 'A guardar…' : 'Confirmar'}</button></div>
          </section>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><p className="text-xs font-black uppercase tracking-wide text-[#8F8376]">{label}</p><p className={`mt-2 text-2xl font-black ${accent ? 'text-[#F5A623]' : 'text-white'}`}>{value}</p></article>;
}
function Payment({ label, value }: { label: string; value: number }) {
  return <article className="rounded-xl border border-white/5 bg-black/20 px-4 py-3"><p className="text-xs text-[#8F8376]">{label}</p><p className="mt-1 font-black text-[#E8DDCF]">{mt(value)}</p></article>;
}
function SmallMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl bg-black/20 p-3"><p className="text-xs text-[#8F8376]">{label}</p><p className="mt-1 font-black text-white">{value}</p></div>;
}
function ListSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5"><h2 className="text-lg font-black text-white">{title}</h2><div className="mt-3">{hasChildren ? children : <p className="py-8 text-center text-sm text-[#8F8376]">{empty}</p>}</div></section>;
}
