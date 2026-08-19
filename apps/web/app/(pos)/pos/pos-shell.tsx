'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMT, type Cents } from '@delivery/core';
import { createClient } from '@/utils/supabase/client';
import {
  buildPaymentPlan,
  calculateChange,
  type CounterPaymentMethod,
} from '@/lib/pos/payment';

type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  available?: boolean;
};

type Category = {
  id: string;
  name: string;
  items: MenuItem[];
};

type PosContext = {
  deviceId: string;
  deviceLabel: string;
  storeSlug: string;
  storeName: string;
};

type CartLine = MenuItem & { qty: number };
type AllocationMap = Partial<Record<CounterPaymentMethod, number>>;

const DEVICE_STORAGE_KEY = 'hs_pos_device_id';
const METHODS: Array<{ id: CounterPaymentMethod; label: string }> = [
  { id: 'cash', label: 'Dinheiro' },
  { id: 'mpesa', label: 'M-Pesa' },
  { id: 'emola', label: 'e-Mola' },
  { id: 'credit_card', label: 'Cartão' },
];

const mt = (value: number) => formatMT(value as Cents);

function errorMessage(message?: string): string {
  if (!message) return 'Não foi possível concluir a venda.';
  if (message.includes('out_of_stock') || message.includes('item_unavailable')) {
    return 'Um dos produtos esgotou. Actualiza o cardápio e confirma o carrinho.';
  }
  if (message.includes('payment_total_mismatch')) {
    return 'As formas de pagamento não fecham o total.';
  }
  if (message.includes('invalid_or_unauthorised_device')) {
    return 'Este dispositivo perdeu o acesso à loja.';
  }
  if (message.includes('void_access_denied')) {
    return 'A anulação exige um gerente ou o dono.';
  }
  return message;
}

export function PosShell() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [context, setContext] = useState<PosContext | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [saleId, setSaleId] = useState(() => crypto.randomUUID());
  const [methods, setMethods] = useState<CounterPaymentMethod[]>(['cash']);
  const [mixed, setMixed] = useState(false);
  const [allocations, setAllocations] = useState<AllocationMap>({});
  const [cashReceivedCents, setCashReceivedCents] = useState(0);
  const [keypadTarget, setKeypadTarget] = useState<CounterPaymentMethod | 'cash_received'>(
    'cash_received',
  );
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    orderId: string;
    dailyNumber: number;
    totalCents: number;
  } | null>(null);
  const [lastSale, setLastSale] = useState<{ orderId: string; dailyNumber: number } | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  const loadPos = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      router.replace('/login?next=/pos');
      return;
    }

    const { data: devices, error: devicesError } = await supabase
      .from('devices')
      .select('id,store_id,label')
      .eq('kind', 'pos')
      .eq('active', true);
    if (devicesError) {
      setError(errorMessage(devicesError.message));
      setLoading(false);
      return;
    }

    const savedId = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    const device = devices?.find((candidate) => candidate.id === savedId) ??
      (devices?.length === 1 ? devices[0] : null);
    if (!device) {
      setError('Este PC ainda não está vinculado a um POS da loja.');
      setLoading(false);
      return;
    }
    window.localStorage.setItem(DEVICE_STORAGE_KEY, device.id);

    const { data: store, error: storeError } = await supabase
      .from('stores')
      .select('slug,short_name')
      .eq('id', device.store_id)
      .single();
    if (storeError || !store) {
      setError('Não foi possível identificar a loja deste POS.');
      setLoading(false);
      return;
    }

    const response = await fetch(`/api/menu?store=${encodeURIComponent(store.slug)}`, {
      cache: 'no-store',
    });
    if (!response.ok) {
      setError('Não foi possível carregar o cardápio.');
      setLoading(false);
      return;
    }
    const menu = await response.json();
    const nextCategories: Category[] = menu.categories ?? [];
    setCategories(nextCategories);
    setActiveCategory((current) => current ?? nextCategories[0]?.id ?? null);
    setContext({
      deviceId: device.id,
      deviceLabel: device.label,
      storeSlug: store.slug,
      storeName: store.short_name,
    });
    setLoading(false);
  }, [router, supabase]);

  useEffect(() => {
    void loadPos();
  }, [loadPos]);

  const lines = useMemo(() => Object.values(cart), [cart]);
  const totalCents = useMemo(
    () => lines.reduce((sum, line) => sum + line.price_cents * line.qty, 0),
    [lines],
  );
  const count = useMemo(() => lines.reduce((sum, line) => sum + line.qty, 0), [lines]);
  const visibleItems =
    categories.find((category) => category.id === activeCategory)?.items ?? [];
  const paymentPlan = useMemo(
    () => buildPaymentPlan({ totalCents, methods, mixed, allocations }),
    [allocations, methods, mixed, totalCents],
  );
  const cashPaymentCents =
    paymentPlan.payments.find((payment) => payment.method === 'cash')?.amountCents ?? 0;
  const changeCents = useMemo(() => {
    if (cashPaymentCents === 0 || cashReceivedCents < cashPaymentCents) return null;
    return calculateChange(cashPaymentCents, cashReceivedCents);
  }, [cashPaymentCents, cashReceivedCents]);

  function changeQty(item: MenuItem, delta: number) {
    setCart((current) => {
      const existing = current[item.id];
      const qty = (existing?.qty ?? 0) + delta;
      if (qty <= 0) {
        const next = { ...current };
        delete next[item.id];
        return next;
      }
      return { ...current, [item.id]: { ...item, qty } };
    });
  }

  function selectMethod(method: CounterPaymentMethod) {
    if (!mixed) {
      setMethods([method]);
      setKeypadTarget(method === 'cash' ? 'cash_received' : method);
      return;
    }
    setMethods((current) => {
      if (current.includes(method)) {
        return current.length === 1 ? current : current.filter((entry) => entry !== method);
      }
      return [...current, method];
    });
    setKeypadTarget(method === 'cash' ? 'cash' : method);
  }

  function setMixedMode(enabled: boolean) {
    setMixed(enabled);
    setAllocations({});
    if (enabled) {
      setMethods(['cash', 'mpesa']);
      setKeypadTarget('cash');
    } else {
      setMethods([methods[0] ?? 'cash']);
      setKeypadTarget(methods[0] === 'cash' ? 'cash_received' : methods[0] ?? 'cash');
    }
  }

  function targetValue(): number {
    return keypadTarget === 'cash_received'
      ? cashReceivedCents
      : (allocations[keypadTarget] ?? 0);
  }

  function setTargetValue(value: number) {
    const safeValue = Math.max(0, Math.min(value, 99_999_900));
    if (keypadTarget === 'cash_received') {
      setCashReceivedCents(safeValue);
    } else {
      setAllocations((current) => ({ ...current, [keypadTarget]: safeValue }));
    }
  }

  function pressKey(key: string) {
    if (key === 'C') return setTargetValue(0);
    if (key === '⌫') return setTargetValue(Math.floor(targetValue() / 1000) * 100);
    const currentMt = Math.floor(targetValue() / 100).toString();
    const nextMt = Number(`${targetValue() === 0 ? '' : currentMt}${key}`);
    setTargetValue(nextMt * 100);
  }

  function fillRemaining() {
    if (keypadTarget === 'cash_received') {
      setCashReceivedCents(cashPaymentCents);
      return;
    }
    const others = methods
      .filter((method) => method !== keypadTarget)
      .reduce((sum, method) => sum + (allocations[method] ?? 0), 0);
    setAllocations((current) => ({
      ...current,
      [keypadTarget]: Math.max(0, totalCents - others),
    }));
  }

  async function finalizeSale() {
    if (!context || lines.length === 0 || !paymentPlan.complete) return;
    if (cashPaymentCents > 0 && changeCents === null) {
      setError('O valor recebido em dinheiro é insuficiente.');
      return;
    }

    setSubmitting(true);
    setError(null);
    const { data, error: saleError } = await supabase.rpc('create_counter_sale', {
      p_payload: {
        clientSaleId: saleId,
        deviceId: context.deviceId,
        items: lines.map((line) => ({ menuItemId: line.id, qty: line.qty })),
        payments: paymentPlan.payments,
        ...(cashPaymentCents > 0 ? { cashReceivedCents } : {}),
      },
    });
    setSubmitting(false);

    if (saleError) {
      setError(errorMessage(saleError.message));
      return;
    }

    const completed = {
      orderId: data.order_id as string,
      dailyNumber: data.daily_number as number,
      totalCents: data.total_cents as number,
    };
    setConfirmation(completed);
    setLastSale(completed);
    setCart({});
    setSaleId(crypto.randomUUID());
    setAllocations({});
    setCashReceivedCents(0);
    window.setTimeout(() => setConfirmation(null), 3000);
  }

  async function voidLastSale() {
    if (!lastSale || voidReason.trim().length < 3) return;
    setSubmitting(true);
    setError(null);
    const { error: voidError } = await supabase.rpc('void_sale', {
      p_order_id: lastSale.orderId,
      p_reason: voidReason.trim(),
    });
    setSubmitting(false);
    if (voidError) {
      setError(errorMessage(voidError.message));
      return;
    }
    setVoidOpen(false);
    setVoidReason('');
    setLastSale(null);
    await loadPos();
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#0a0807] text-[#e5a93c]">
        <p className="text-xl font-bold">A preparar o POS…</p>
      </main>
    );
  }

  if (!context) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#0a0807] p-8 text-white">
        <section className="max-w-lg rounded-3xl border border-red-500/40 bg-red-950/30 p-8 text-center">
          <h1 className="text-2xl font-black">POS indisponível</h1>
          <p className="mt-3 text-red-100">{error}</p>
          <button
            type="button"
            onClick={() => void loadPos()}
            className="mt-6 min-h-16 w-full rounded-2xl bg-[#e5a93c] px-6 font-black text-black active:scale-[0.98]"
          >
            Tentar novamente
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0807] text-[#f6f1e6] lg:h-screen lg:overflow-hidden">
      <header className="flex min-h-16 items-center gap-4 border-b border-white/10 bg-[#111110] px-4">
        <div className="flex-1">
          <p className="text-lg font-black tracking-wide text-[#e5a93c]">HAWSMASH POS</p>
          <p className="text-xs text-[#847e72]">{context.storeName} · {context.deviceLabel}</p>
        </div>
        {lastSale && (
          <button
            type="button"
            onClick={() => setVoidOpen(true)}
            className="min-h-16 rounded-xl border border-red-500/40 px-4 text-sm font-bold text-red-300 active:bg-red-950"
          >
            Anular #{lastSale.dailyNumber}
          </button>
        )}
        <div className="rounded-full bg-emerald-500/15 px-3 py-2 text-sm font-bold text-emerald-300">
          ONLINE
        </div>
      </header>

      <div className="grid lg:h-[calc(100vh-4rem)] lg:grid-cols-[8rem_minmax(0,1fr)_25rem]">
        <nav className="flex gap-2 overflow-x-auto border-b border-white/10 bg-[#111110] p-2 lg:block lg:overflow-y-auto lg:border-b-0 lg:border-r">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setActiveCategory(category.id)}
              className={`min-h-16 min-w-28 rounded-2xl px-3 text-sm font-black active:scale-[0.98] lg:mb-2 lg:w-full lg:min-w-0 ${
                activeCategory === category.id
                  ? 'bg-[#e5a93c] text-black'
                  : 'bg-white/[0.06] text-[#c8bfb0]'
              }`}
            >
              {category.name}
            </button>
          ))}
        </nav>

        <section className="overflow-y-auto p-3 lg:p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {visibleItems.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={item.available === false}
                onClick={() => changeQty(item, 1)}
                className="flex min-h-36 flex-col justify-between rounded-2xl border border-white/10 bg-[#1a1816] p-4 text-left shadow-lg active:scale-[0.98] disabled:opacity-35"
              >
                <span>
                  <span className="block text-lg font-black leading-tight">{item.name}</span>
                  {item.description && (
                    <span className="mt-2 line-clamp-2 block text-xs text-[#847e72]">
                      {item.description}
                    </span>
                  )}
                </span>
                <span className="mt-3 flex items-end justify-between gap-2">
                  <span className="font-black text-[#e5a93c]">{mt(item.price_cents)}</span>
                  {cart[item.id] && (
                    <span className="grid h-9 min-w-9 place-items-center rounded-full bg-[#e5a93c] px-2 font-black text-black">
                      {cart[item.id].qty}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </section>

        <aside className="flex min-h-[36rem] flex-col border-t border-white/10 bg-[#111110] lg:min-h-0 lg:border-l lg:border-t-0">
          <div className="border-b border-white/10 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black">Carrinho</h2>
              <span className="text-sm text-[#847e72]">{count} artigos</span>
            </div>
          </div>

          <div className="max-h-60 flex-1 space-y-2 overflow-y-auto p-3 lg:max-h-none">
            {lines.length === 0 ? (
              <p className="grid h-full min-h-28 place-items-center text-sm text-[#847e72]">
                Toca num produto para começar.
              </p>
            ) : (
              lines.map((line) => (
                <article key={line.id} className="rounded-2xl bg-white/[0.05] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-bold">{line.name}</h3>
                      <p className="text-sm text-[#e5a93c]">{mt(line.price_cents * line.qty)}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => changeQty(line, -1)}
                        className="grid min-h-16 min-w-16 place-items-center rounded-xl bg-white/10 text-xl font-black active:bg-white/20"
                        aria-label={`Retirar ${line.name}`}
                      >
                        −
                      </button>
                      <span className="min-w-9 text-center text-lg font-black">{line.qty}</span>
                      <button
                        type="button"
                        onClick={() => changeQty(line, 1)}
                        className="grid min-h-16 min-w-16 place-items-center rounded-xl bg-white/10 text-xl font-black active:bg-white/20"
                        aria-label={`Adicionar ${line.name}`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>

          <section className="border-t border-white/10 p-3">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-bold text-[#c8bfb0]">TOTAL</span>
              <strong className="text-3xl text-[#e5a93c]">{mt(totalCents)}</strong>
            </div>

            <label className="mb-2 flex min-h-12 items-center justify-between rounded-xl bg-white/[0.05] px-3 text-sm font-bold">
              Pagamento misto
              <input
                type="checkbox"
                checked={mixed}
                onChange={(event) => setMixedMode(event.target.checked)}
                className="h-6 w-6 accent-[#e5a93c]"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              {METHODS.map((method) => {
                const selected = methods.includes(method.id);
                return (
                  <button
                    key={method.id}
                    type="button"
                    onClick={() => selectMethod(method.id)}
                    className={`min-h-16 rounded-xl px-2 text-sm font-black active:scale-[0.98] ${
                      selected ? 'bg-[#e5a93c] text-black' : 'bg-white/[0.07] text-[#c8bfb0]'
                    }`}
                  >
                    {method.label}
                    {mixed && selected && (
                      <span className="mt-1 block text-xs">
                        {mt(allocations[method.id] ?? 0)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {(mixed || methods[0] === 'cash') && (
              <div className="mt-3 rounded-2xl border border-white/10 p-3">
                {mixed && (
                  <div className="mb-2 flex gap-2 overflow-x-auto">
                    {methods.map((method) => (
                      <button
                        key={method}
                        type="button"
                        onClick={() => setKeypadTarget(method)}
                        className={`min-h-16 min-w-24 rounded-xl px-2 text-xs font-bold ${
                          keypadTarget === method ? 'bg-white text-black' : 'bg-white/10'
                        }`}
                      >
                        {METHODS.find((entry) => entry.id === method)?.label}
                      </button>
                    ))}
                  </div>
                )}

                {cashPaymentCents > 0 && (
                  <button
                    type="button"
                    onClick={() => setKeypadTarget('cash_received')}
                    className={`mb-2 min-h-16 w-full rounded-xl px-3 text-left text-sm font-bold ${
                      keypadTarget === 'cash_received' ? 'bg-emerald-400 text-black' : 'bg-white/10'
                    }`}
                  >
                    Recebido: {mt(cashReceivedCents)}
                  </button>
                )}

                <div className="mb-2 flex items-center justify-between rounded-xl bg-black/30 px-3 py-2">
                  <span className="text-xs text-[#847e72]">
                    {keypadTarget === 'cash_received' ? 'Valor recebido' : 'Parcela'}
                  </span>
                  <strong className="text-xl">{mt(targetValue())}</strong>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => pressKey(key)}
                      className="min-h-16 rounded-xl bg-white/[0.08] text-lg font-black active:bg-white/20"
                    >
                      {key}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={fillRemaining}
                  className="mt-2 min-h-16 w-full rounded-xl bg-white/10 text-sm font-bold active:bg-white/20"
                >
                  {keypadTarget === 'cash_received' ? 'Recebido exacto' : 'Preencher restante'}
                </button>
              </div>
            )}

            {mixed && (
              <p className={`mt-2 text-center text-sm font-bold ${paymentPlan.complete ? 'text-emerald-300' : 'text-amber-300'}`}>
                {paymentPlan.complete
                  ? 'Pagamento completo'
                  : paymentPlan.remainingCents > 0
                    ? `Faltam ${mt(paymentPlan.remainingCents)}`
                    : `Excede ${mt(Math.abs(paymentPlan.remainingCents))}`}
              </p>
            )}
            {changeCents !== null && cashPaymentCents > 0 && (
              <p className="mt-2 rounded-xl bg-emerald-500/15 py-2 text-center text-xl font-black text-emerald-300">
                Troco: {mt(changeCents)}
              </p>
            )}
            {error && (
              <p role="alert" className="mt-2 rounded-xl bg-red-950/60 p-3 text-sm font-bold text-red-200">
                {error}
              </p>
            )}
            <button
              type="button"
              disabled={
                submitting ||
                lines.length === 0 ||
                !paymentPlan.complete ||
                (cashPaymentCents > 0 && changeCents === null)
              }
              onClick={() => void finalizeSale()}
              className="mt-3 min-h-16 w-full rounded-2xl bg-[#e5a93c] px-4 text-lg font-black text-black shadow-[0_10px_30px_rgba(229,169,60,.22)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
            >
              {submitting ? 'A registar…' : 'FINALIZAR VENDA'}
            </button>
          </section>
        </aside>
      </div>

      {confirmation && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-6">
          <section className="w-full max-w-md rounded-[2rem] border border-emerald-400/40 bg-[#111110] p-8 text-center shadow-2xl">
            <p className="text-lg font-black text-emerald-300">VENDA REGISTADA</p>
            <p className="my-6 text-8xl font-black text-white">{confirmation.dailyNumber}</p>
            <p className="text-3xl font-black text-[#e5a93c]">{mt(confirmation.totalCents)}</p>
            <p className="mt-4 text-sm text-[#847e72]">A preparar a próxima venda…</p>
          </section>
        </div>
      )}

      {voidOpen && lastSale && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4">
          <section className="w-full max-w-lg rounded-3xl border border-red-500/30 bg-[#1a1816] p-6">
            <h2 className="text-2xl font-black">Anular venda #{lastSale.dailyNumber}</h2>
            <p className="mt-2 text-sm text-[#c8bfb0]">A acção exige gerente e fica registada.</p>
            <textarea
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
              placeholder="Motivo obrigatório"
              className="mt-4 min-h-28 w-full rounded-2xl border border-white/10 bg-black/30 p-4 text-white outline-none focus:border-red-400"
            />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setVoidOpen(false)}
                className="min-h-16 rounded-2xl bg-white/10 font-black active:bg-white/20"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={submitting || voidReason.trim().length < 3}
                onClick={() => void voidLastSale()}
                className="min-h-16 rounded-2xl bg-red-600 font-black text-white active:bg-red-700 disabled:opacity-35"
              >
                Confirmar anulação
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
