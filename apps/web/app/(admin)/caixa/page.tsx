'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { parseMTInput } from '@/lib/cash/input';
import { addCashMovement, movementRequestKeeper } from '@/lib/cash/movement';
import { createClient } from '@/utils/supabase/client';
import { staffFetch } from '@/lib/admin/staff-fetch';

import { CashHistory } from './history';
import { Card, CardTitle, DifferenceBadge, DrawerMath, PaymentSplit, Stat, dateTime, duration, mt, time } from './ui';

type MovementType = 'sangria' | 'reforco' | 'despesa' | 'troco_inicial';
type CashMovement = {
  id: string;
  type: MovementType;
  amount_cents: number;
  reason: string;
  created_at: string;
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

const movementLabels: Record<MovementType, string> = {
  sangria: 'Sangria',
  reforco: 'Reforço',
  despesa: 'Despesa',
  troco_inicial: 'Troco inicial adicional',
};
const movementHints: Record<MovementType, string> = {
  sangria: 'Dinheiro que sai da gaveta para o cofre.',
  reforco: 'Dinheiro que entra na gaveta.',
  despesa: 'Pagamento feito com dinheiro da gaveta.',
  troco_inicial: 'Mais troco depois da abertura.',
};
const movementOut = (type: MovementType) => type === 'sangria' || type === 'despesa';

/** O separador "Todas as lojas" — só para quem consolida e tem mais de uma loja. */
const OVERVIEW = 'all';
const STORE_KEY = 'caixa:store';

const paymentsOf = (row: { cash_sales_cents: number; mpesa_cents: number; emola_cents: number; credit_card_cents: number }) => ({
  cash: row.cash_sales_cents,
  mpesa: row.mpesa_cents,
  emola: row.emola_cents,
  credit_card: row.credit_card_cents,
});
const ticket = (faturado: number, pedidos: number) => (pedidos > 0 ? mt(Math.round(faturado / pedidos)) : '—');

export default function CaixaPage() {
  const supabase = useMemo(() => createClient(), []);
  const movementKey = useRef(movementRequestKeeper());
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'open' | 'movement' | 'close' | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [reason, setReason] = useState('');
  const [movementType, setMovementType] = useState<MovementType>('sangria');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_cash_dashboard', { p_store: null });
    if (error || !data) {
      setMessage({ tone: 'error', text: `Não foi possível carregar o caixa: ${error?.message ?? 'erro desconhecido'}` });
    } else {
      const next = data as Dashboard;
      setDashboard(next);
      // Cada loja no seu separador: abre na última escolhida, ou na primeira.
      setSelectedStoreId((current) => {
        const valid = (id: string | null) =>
          !!id && (next.stores.some((store) => store.store_id === id)
            || (id === OVERVIEW && next.can_consolidate && next.stores.length > 1));
        if (valid(current)) return current;
        let remembered: string | null = null;
        try { remembered = window.localStorage.getItem(STORE_KEY); } catch { /* sem armazenamento */ }
        return valid(remembered) ? remembered : next.stores[0]?.store_id ?? null;
      });
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  function selectStore(id: string) {
    setSelectedStoreId(id);
    setMessage(null);
    try { window.localStorage.setItem(STORE_KEY, id); } catch { /* sem armazenamento */ }
  }

  const selectedStore = dashboard?.stores.find((store) => store.store_id === selectedStoreId) ?? null;
  const closeDifference = selectedStore
    ? (parseMTInput(amountInput) ?? 0) - selectedStore.expected_cash_cents
    : 0;

  function resetDialog() {
    movementKey.current.done();
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
    const { error } = await addCashMovement(supabase, {
      store: selectedStore.store_id,
      type: movementType,
      amountCents: amount,
      reason,
      // A mesma sangria, repetida depois de uma resposta perdida, conta uma vez.
      requestId: movementKey.current.idFor(movementType, amount, reason),
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
    void staffFetch('/api/emails/send-cash-close-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).catch(() => undefined);
    resetDialog();
    setMessage({ tone: 'ok', text: `Caixa de ${selectedStore.store_name} fechado. Talão em fila e relatório disponível.` });
    setHistoryKey((value) => value + 1);
    await refresh();
  }

  if (loading) return <p className="py-20 text-center font-bold text-[#F5A623]">A carregar caixa…</p>;
  if (!dashboard || dashboard.stores.length === 0) return <p className="py-20 text-center text-red-300">Caixa indisponível.</p>;

  const showOverviewTab = dashboard.can_consolidate && dashboard.stores.length > 1;
  const storeNames = Object.fromEntries(dashboard.stores.map((store) => [store.store_id, store.store_name]));

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#F5A623]">Operação por turno</p>
          <h1 className="mt-1 text-3xl font-black text-white">Caixa</h1>
          <p className="mt-1 text-sm text-[#A99C8C]">O turno de cada loja ao vivo e tudo o que já fechou, com o que se vendeu.</p>
        </div>
        <button type="button" onClick={() => void refresh()} className="min-h-11 self-start rounded-xl border border-white/10 px-4 text-sm font-bold text-[#E8DDCF] hover:bg-white/[0.04] lg:self-auto">
          Actualizar
        </button>
      </header>

      {dashboard.stores.length > 1 && (
        <nav aria-label="Lojas" className="flex gap-2 overflow-x-auto pb-1">
          {dashboard.stores.map((store) => (
            <StoreTab key={store.store_id} active={store.store_id === selectedStoreId} onClick={() => selectStore(store.store_id)}>
              <span className={`h-2 w-2 rounded-full ${store.has_open_session ? 'bg-emerald-400' : 'bg-white/25'}`} />
              {store.store_name}
            </StoreTab>
          ))}
          {showOverviewTab && (
            <StoreTab active={selectedStoreId === OVERVIEW} onClick={() => selectStore(OVERVIEW)}>
              Todas as lojas
            </StoreTab>
          )}
        </nav>
      )}

      {message && (
        <div role="status" className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-bold ${message.tone === 'ok' ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border-red-400/30 bg-red-500/10 text-red-200'}`}>
          <span>{message.text}</span>
          <button type="button" aria-label="Fechar aviso" onClick={() => setMessage(null)} className="opacity-70 hover:opacity-100">×</button>
        </div>
      )}

      {selectedStore ? (
        <>
          <CurrentShift
            store={selectedStore}
            onOpen={() => setDialog('open')}
            onMovement={() => setDialog('movement')}
            onClose={() => setDialog('close')}
          />
          <CashHistory storeId={selectedStore.store_id} storeNames={storeNames} refreshKey={historyKey} />
        </>
      ) : (
        <>
          <Overview dashboard={dashboard} onPick={selectStore} />
          <CashHistory storeId={null} storeNames={storeNames} refreshKey={historyKey} />
        </>
      )}

      {dialog && selectedStore && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4">
          <section role="dialog" aria-modal="true" className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#17120E] p-6 shadow-2xl">
            <p className="text-xs font-black uppercase tracking-wider text-[#F5A623]">{selectedStore.store_name}</p>
            <h2 className="mt-1 text-2xl font-black text-white">{dialog === 'open' ? 'Abrir caixa' : dialog === 'movement' ? 'Registar movimento' : 'Fechar caixa'}</h2>

            {dialog === 'movement' && (
              <div className="mt-5">
                <div role="radiogroup" aria-label="Tipo de movimento" className="grid grid-cols-2 gap-2">
                  {(Object.keys(movementLabels) as MovementType[]).map((type) => (
                    <button
                      key={type}
                      type="button"
                      role="radio"
                      aria-checked={movementType === type}
                      onClick={() => setMovementType(type)}
                      className={`min-h-12 rounded-xl border px-3 text-sm font-bold transition ${movementType === type ? 'border-[#F5A623] bg-[#F5A623]/15 text-[#F5A623]' : 'border-white/10 text-[#C9BCAC] hover:bg-white/[0.04]'}`}
                    >
                      {movementOut(type) ? '− ' : '+ '}{movementLabels[type]}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-[#8F8376]">{movementHints[movementType]}</p>
              </div>
            )}
            {dialog === 'close' && (
              <div className="mt-5 flex items-center justify-between rounded-xl bg-black/25 p-4">
                <span className="text-sm text-[#C9BCAC]">Esperado na gaveta</span>
                <strong className="text-xl font-black text-white">{mt(selectedStore.expected_cash_cents)}</strong>
              </div>
            )}
            <label className="mt-5 block text-sm font-bold text-[#C9BCAC]" htmlFor="cash-amount">{dialog === 'open' ? 'Fundo inicial (MT)' : dialog === 'close' ? 'Valor contado na gaveta (MT)' : 'Valor (MT)'}</label>
            <input id="cash-amount" autoFocus inputMode="decimal" value={amountInput} onChange={(event) => setAmountInput(event.target.value)} placeholder="0,00" className="mt-2 min-h-14 w-full rounded-xl border border-white/10 bg-black/30 px-4 text-xl font-black text-white outline-none focus:border-[#F5A623]" />
            {dialog === 'close' && amountInput && (
              <p className="mt-3 flex items-center gap-2 text-sm text-[#C9BCAC]">Diferença: <DifferenceBadge cents={closeDifference} /></p>
            )}
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

function StoreTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={`flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-5 text-sm font-black transition ${active ? 'border-[#F5A623] bg-[#F5A623] text-[#24150D]' : 'border-white/10 bg-white/[0.03] text-[#C9BCAC] hover:border-[#F5A623]/40 hover:text-white'}`}
    >
      {children}
    </button>
  );
}

/** O turno de agora: estado, vendas, meios de pagamento, movimentos e a conta da gaveta. */
function CurrentShift({ store, onOpen, onMovement, onClose }: {
  store: StoreCash;
  onOpen: () => void;
  onMovement: () => void;
  onClose: () => void;
}) {
  const session = store.open_session;
  return (
    <Card className={session ? 'border-emerald-400/20' : ''}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <span className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${session ? 'bg-emerald-500/15' : 'bg-white/[0.06]'}`}>
            <span className={`h-3 w-3 rounded-full ${session ? 'bg-emerald-400' : 'bg-white/30'}`} />
            {session && <span className="absolute h-3 w-3 animate-ping rounded-full bg-emerald-400/60 motion-reduce:hidden" />}
          </span>
          <div>
            <h2 className="text-2xl font-black text-white">{store.store_name}</h2>
            {session ? (
              <p className="text-sm text-emerald-300">
                Turno aberto às {time(session.opened_at)} · há {duration(session.opened_at, new Date().toISOString())}
                <span className="text-[#8F8376]"> · {session.shift_label}</span>
              </p>
            ) : (
              <p className="text-sm text-[#A99C8C]">Sem turno aberto · valores desde o último fecho ({dateTime(store.period_start)})</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!store.has_open_session ? (
            <button type="button" onClick={onOpen} className="min-h-12 rounded-xl bg-[#F5A623] px-6 font-black text-[#24150D]">Abrir caixa</button>
          ) : (
            <>
              <button type="button" onClick={onMovement} className="min-h-12 rounded-xl border border-[#F5A623]/40 px-5 font-bold text-[#F5A623] hover:bg-[#F5A623]/10">Sangria / movimento</button>
              <button type="button" onClick={onClose} className="min-h-12 rounded-xl bg-[#F5A623] px-6 font-black text-[#24150D]">Fechar caixa</button>
            </>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <div className="grid grid-cols-3 gap-4 rounded-xl border border-white/10 p-4">
            <Stat label="Facturado" value={mt(store.total_faturado_cents)} accent />
            <Stat label="Pedidos" value={store.total_pedidos} />
            <Stat label="Ticket médio" value={ticket(store.total_faturado_cents, store.total_pedidos)} />
          </div>
          <div>
            <p className="mb-3 text-xs font-black uppercase tracking-wider text-[#8F8376]">Como pagaram</p>
            <PaymentSplit payments={paymentsOf(store)} />
          </div>
          <div>
            <p className="mb-2 text-xs font-black uppercase tracking-wider text-[#8F8376]">Movimentos do turno</p>
            {store.movements.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 py-5 text-center text-sm text-[#8F8376]">Sem sangrias, reforços ou despesas.</p>
            ) : (
              <ul className="divide-y divide-white/5 rounded-xl border border-white/10">
                {store.movements.map((movement) => (
                  <li key={movement.id} className="flex items-center gap-3 px-4 py-3">
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-black ${movementOut(movement.type) ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                      {movementOut(movement.type) ? '−' : '+'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-white">{movementLabels[movement.type]}</p>
                      <p className="truncate text-xs text-[#938779]">{movement.reason} · {time(movement.created_at)}</p>
                    </div>
                    <strong className="text-[#E8DDCF]">{mt(movement.amount_cents)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="lg:col-span-2">
          <p className="mb-3 text-xs font-black uppercase tracking-wider text-[#8F8376]">Gaveta agora</p>
          <DrawerMath
            totalLabel="Esperado na gaveta"
            total={store.expected_cash_cents}
            rows={[
              { label: 'Fundo inicial', value: session?.opening_float_cents ?? 0, sign: '+' },
              { label: 'Vendas em dinheiro', value: store.cash_sales_cents, sign: '+' },
              { label: 'Reforços', value: store.reforco_cents, sign: '+' },
              { label: 'Sangrias', value: store.sangria_cents, sign: '−' },
              { label: 'Despesas', value: store.despesa_cents, sign: '−' },
            ]}
          />
          <p className="mt-3 text-xs leading-relaxed text-[#8F8376]">
            É o que deve estar na gaveta. Ao fechar, conta-se o dinheiro e o sistema mostra se falta ou sobra.
            Os artigos vendidos ficam no turno assim que ele fecha.
          </p>
        </div>
      </div>
    </Card>
  );
}

/** Todas as lojas lado a lado; tocar numa abre o separador dela. */
function Overview({ dashboard, onPick }: { dashboard: Dashboard; onPick: (id: string) => void }) {
  const total = dashboard.consolidated;
  return (
    <>
      <Card>
        <CardTitle aside={<span className="text-xs text-[#8F8376]">Desde o último fecho de cada loja</span>}>Todas as lojas</CardTitle>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Facturado" value={mt(total.total_faturado_cents)} accent />
          <Stat label="Pedidos" value={total.total_pedidos} />
          <Stat label="Ticket médio" value={ticket(total.total_faturado_cents, total.total_pedidos)} />
          <Stat label="Esperado nas gavetas" value={mt(total.expected_cash_cents)} />
        </div>
        <div className="mt-5"><PaymentSplit payments={paymentsOf(total)} /></div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        {dashboard.stores.map((store) => (
          <button key={store.store_id} type="button" onClick={() => onPick(store.store_id)} className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-left transition hover:border-[#F5A623]/40">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-black text-white">{store.store_name}</h2>
              <span className={`rounded-full px-2.5 py-1 text-xs font-black ${store.open_session ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-[#A99C8C]'}`}>
                {store.open_session ? `Aberto desde ${time(store.open_session.opened_at)}` : 'Fechado'}
              </span>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-4">
              <Stat label="Facturado" value={mt(store.total_faturado_cents)} accent />
              <Stat label="Pedidos" value={store.total_pedidos} />
              <Stat label="Na gaveta" value={mt(store.expected_cash_cents)} />
            </div>
            <div className="mt-5"><PaymentSplit payments={paymentsOf(store)} /></div>
            <p className="mt-4 text-xs font-bold text-[#F5A623]">Abrir o caixa desta loja ›</p>
          </button>
        ))}
      </div>
    </>
  );
}
