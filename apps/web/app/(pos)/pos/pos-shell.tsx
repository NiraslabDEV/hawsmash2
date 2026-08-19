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
import {
  enqueueOfflineSale,
  listOfflineSales,
  loadMenuWithFallback,
  MENU_REFRESH_MS,
  removeOfflineSale,
  updateOfflineSale,
  posItemAvailability,
  type OfflineSale,
  type PosMenuCategory as Category,
  type PosMenuItem as MenuItem,
} from '@/lib/pos/offline-store';
import {
  DEFAULT_LOCAL_BRIDGE_URL,
  printOfflineSale,
  readLocalBridgeConfig,
  saveLocalBridgeConfig,
} from '@/lib/pos/offline-sales';
import { syncOfflineSales } from '@/lib/pos/offline-sync';
import { connectionStatus } from '@/lib/pos/connection-status';
import { isPosPin, POS_IDLE_TIMEOUT_MS } from '@/lib/pos/session';

type PosContext = {
  deviceId: string;
  deviceLabel: string;
  storeSlug: string;
  storeName: string;
};

type AvailableStore = {
  id: string;
  slug: string;
  short_name: string;
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

async function fetchMenu(
  supabase: ReturnType<typeof createClient>,
  storeSlug: string,
): Promise<unknown> {
  // O POS pede o cardápio completo da sua loja: o esgotado aparece a cinzento
  // em vez de desaparecer do ecrã a meio do turno.
  const { data, error } = await supabase.rpc('get_menu', {
    p_store_slug: storeSlug,
    p_include_unavailable: true,
  });
  if (error || !data) throw new Error('Não foi possível carregar o cardápio.');
  return (data as { categories: unknown }).categories;
}

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
  if (message.includes('device_locked')) {
    return 'O POS está bloqueado. Introduz o PIN para continuar.';
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
  const [availableStores, setAvailableStores] = useState<AvailableStore[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('POS balcão');
  const [bridgeUrl, setBridgeUrl] = useState(DEFAULT_LOCAL_BRIDGE_URL);
  const [bridgeToken, setBridgeToken] = useState('');
  const [binding, setBinding] = useState(false);
  const [pinConfigured, setPinConfigured] = useState(false);
  const [locked, setLocked] = useState(false);
  const [pin, setPin] = useState('');
  const [pinConfirmation, setPinConfirmation] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
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
    offline?: boolean;
  } | null>(null);
  const [lastSale, setLastSale] = useState<{ orderId: string; dailyNumber: number } | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [reprintPending, setReprintPending] = useState(false);
  const [reprintFeedback, setReprintFeedback] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [pendingSales, setPendingSales] = useState(0);
  const [recentlySynced, setRecentlySynced] = useState(0);

  const reprintLastReceipt = useCallback(async () => {
    if (!lastSale || reprintPending || locked) return;
    setReprintPending(true);
    setError(null);
    const { data, error: reprintError } = await supabase.rpc('reprint', {
      p_order_id: lastSale.orderId,
      p_kind: 'receipt',
      p_request_id: crypto.randomUUID(),
    });
    setReprintPending(false);
    if (reprintError) {
      setError(errorMessage(reprintError.message));
      return;
    }
    setReprintFeedback(`Talão em fila · via ${data.reprint_seq}`);
    window.setTimeout(() => setReprintFeedback(null), 3000);
  }, [lastSale, locked, reprintPending, supabase]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (event.key !== 'F2' || !lastSale || locked) return;
      event.preventDefault();
      void reprintLastReceipt();
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [lastSale, locked, reprintLastReceipt]);

  const loadPos = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAvailableStores([]);

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
    const device = devices?.find((candidate) => candidate.id === savedId) ?? null;
    if (!device) {
      if (savedId) window.localStorage.removeItem(DEVICE_STORAGE_KEY);
      const { data: stores, error: storesError } = await supabase
        .from('stores')
        .select('id,slug,short_name')
        .eq('active', true)
        .order('short_name');
      if (storesError || !stores?.length) {
        setError('Não foi possível listar as lojas disponíveis para vinculação.');
      } else {
        setAvailableStores(stores);
        setSelectedStoreId((current) => current || stores[0].id);
      }
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

    let nextCategories: Category[];
    try {
      const menu = await loadMenuWithFallback(store.slug, () => fetchMenu(supabase, store.slug));
      nextCategories = menu.categories;
    } catch (menuError) {
      setError(errorMessage(menuError instanceof Error ? menuError.message : undefined));
      setLoading(false);
      return;
    }
    setCategories(nextCategories);
    setActiveCategory((current) => current ?? nextCategories[0]?.id ?? null);
    const { data: pinStatus, error: pinStatusError } = await supabase.rpc('pos_pin_status', {
      p_device_id: device.id,
    });
    if (pinStatusError || !pinStatus) {
      setError('Não foi possível confirmar o bloqueio deste POS.');
      setLoading(false);
      return;
    }
    setContext({
      deviceId: device.id,
      deviceLabel: device.label,
      storeSlug: store.slug,
      storeName: store.short_name,
    });
    setPinConfigured(Boolean(pinStatus.configured));
    setLocked(Boolean(pinStatus.locked));
    setLoading(false);
  }, [router, supabase]);

  useEffect(() => {
    void loadPos();
  }, [loadPos]);

  useEffect(() => {
    let active = true;
    const updateConnection = () => {
      if (!active) return;
      setOnline(navigator.onLine);
      void listOfflineSales().then((sales) => {
        if (active) setPendingSales(sales.length);
      });
    };
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    updateConnection();
    return () => {
      active = false;
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, []);

  useEffect(() => {
    if (!context) return;
    const refresh = async () => {
      try {
        const menu = await loadMenuWithFallback(context.storeSlug, () =>
          fetchMenu(supabase, context.storeSlug),
        );
        setCategories(menu.categories);
        setActiveCategory((current) =>
          menu.categories.some((category) => category.id === current)
            ? current
            : (menu.categories[0]?.id ?? null),
        );
      } catch {
        // A última cache válida continua visível; a venda não pára por uma atualização falhada.
      }
    };
    const timer = window.setInterval(() => void refresh(), MENU_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [context]);

  useEffect(() => {
    if (!context) return;
    let running = false;
    let active = true;
    let confirmationTimer: number | undefined;
    const sync = async () => {
      if (!navigator.onLine || running) return;
      running = true;
      try {
        const result = await syncOfflineSales(async (sale) => {
          const { data, error: syncError } = await supabase.rpc('sync_counter_sale', {
            p_payload: {
              clientSaleId: sale.clientSaleId,
              deviceId: sale.deviceId,
              items: sale.items.map((item) => ({ menuItemId: item.menuItemId, qty: item.qty })),
              payments: sale.payments,
              offlineTotalCents: sale.totalCents,
              ...(sale.cashReceivedCents == null
                ? {}
                : { cashReceivedCents: sale.cashReceivedCents }),
            },
            p_local_print: sale.localPrint,
          });
          if (syncError) throw new Error(syncError.message);
          return data;
        });
        const remaining = await listOfflineSales();
        if (active) setPendingSales(remaining.length);
        if (active && result.synced > 0) {
          setRecentlySynced(result.synced);
          window.clearTimeout(confirmationTimer);
          confirmationTimer = window.setTimeout(() => setRecentlySynced(0), 4000);
        }
      } finally {
        running = false;
      }
    };
    const onOnline = () => void sync();
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(() => void sync(), 5000);
    void sync();
    return () => {
      active = false;
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
      window.clearTimeout(confirmationTimer);
    };
  }, [context, supabase]);

  const lockDevice = useCallback(async () => {
    if (!context || locked) return;
    const { error: lockError } = await supabase.rpc('lock_pos_device', {
      p_device_id: context.deviceId,
    });
    if (lockError) {
      setError(errorMessage(lockError.message));
      return;
    }
    setPin('');
    setPinError(null);
    setLocked(true);
  }, [context, locked, supabase]);

  useEffect(() => {
    if (!context || locked || !pinConfigured) return;

    let timer = window.setTimeout(() => void lockDevice(), POS_IDLE_TIMEOUT_MS);
    const registerActivity = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void lockDevice(), POS_IDLE_TIMEOUT_MS);
    };
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart'];
    events.forEach((event) => window.addEventListener(event, registerActivity, { passive: true }));

    return () => {
      window.clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, registerActivity));
    };
  }, [context, lockDevice, locked, pinConfigured]);

  async function bindDevice() {
    if (!selectedStoreId || deviceLabel.trim().length < 3 || bridgeToken.trim().length < 32) return;
    try {
      saveLocalBridgeConfig(window.localStorage, { baseUrl: bridgeUrl, token: bridgeToken });
    } catch {
      setError('Confirma o endereço e o token local do bridge.');
      return;
    }
    setBinding(true);
    setError(null);
    const { data, error: bindError } = await supabase.rpc('bind_pos_device', {
      p_store_id: selectedStoreId,
      p_label: deviceLabel.trim(),
    });
    setBinding(false);
    if (bindError || !data?.device_id) {
      setError(
        bindError?.message.includes('device_binding_access_denied')
          ? 'A vinculação deste PC exige um gerente ou o dono.'
          : errorMessage(bindError?.message),
      );
      return;
    }
    window.localStorage.setItem(DEVICE_STORAGE_KEY, data.device_id);
    await loadPos();
  }

  async function configurePin() {
    if (!context || !isPosPin(pin) || pin !== pinConfirmation) {
      setPinError('Usa 4 a 6 algarismos e confirma o mesmo PIN.');
      return;
    }
    setSubmitting(true);
    setPinError(null);
    const { error: pinSetupError } = await supabase.rpc('set_own_pos_pin', {
      p_device_id: context.deviceId,
      p_pin: pin,
    });
    setSubmitting(false);
    if (pinSetupError) {
      setPinError(errorMessage(pinSetupError.message));
      return;
    }
    setPin('');
    setPinConfirmation('');
    setPinConfigured(true);
    setLocked(false);
  }

  async function unlockDevice() {
    if (!context || !isPosPin(pin)) {
      setPinError('Introduz o teu PIN de 4 a 6 algarismos.');
      return;
    }
    setSubmitting(true);
    setPinError(null);
    const { error: unlockError } = await supabase.rpc('unlock_pos_device', {
      p_device_id: context.deviceId,
      p_pin: pin,
    });
    setSubmitting(false);
    if (unlockError) {
      setPinError(
        unlockError.message.includes('invalid_pin')
          ? 'PIN incorrecto.'
          : errorMessage(unlockError.message),
      );
      return;
    }
    setPin('');
    setLocked(false);
  }

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
    const createdAt = new Date().toISOString();
    let queuedSale: OfflineSale;
    try {
      queuedSale = await enqueueOfflineSale({
        clientSaleId: saleId,
        deviceId: context.deviceId,
        storeSlug: context.storeSlug,
        storeName: context.storeName,
        createdAt,
        items: lines.map((line) => ({
          menuItemId: line.id,
          name: line.name,
          qty: line.qty,
          unitPriceCents: line.price_cents,
          station: line.station,
        })),
        payments: paymentPlan.payments,
        ...(cashPaymentCents > 0 ? { cashReceivedCents } : {}),
        totalCents,
      });
    } catch {
      setSubmitting(false);
      setError('Não foi possível guardar a venda neste PC. Não feches nem recarregues o POS.');
      return;
    }

    const completeOfflineSale = () => {
      setSubmitting(false);
      setConfirmation({
        orderId: '',
        dailyNumber: queuedSale.localNumber,
        totalCents: queuedSale.totalCents,
        offline: true,
      });
      setCart({});
      setSaleId(crypto.randomUUID());
      setAllocations({});
      setCashReceivedCents(0);
      setPendingSales((current) => current + 1);
      window.setTimeout(() => setConfirmation(null), 3000);
      const bridge = readLocalBridgeConfig(window.localStorage);
      if (bridge) {
        void printOfflineSale(queuedSale, bridge)
          .then((localPrint) => updateOfflineSale({ ...queuedSale, localPrint }))
          .catch(() => undefined);
      }
    };

    if (!navigator.onLine) {
      completeOfflineSale();
      return;
    }

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
      const retryable = /fetch|network|connection|offline/i.test(saleError.message);
      if (retryable) {
        completeOfflineSale();
        return;
      }
      await removeOfflineSale(saleId);
      setError(errorMessage(saleError.message));
      return;
    }

    await removeOfflineSale(saleId);

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

  const networkStatus = connectionStatus(online, pendingSales, recentlySynced);

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#0a0807] text-[#e5a93c]">
        <p className="text-xl font-bold">A preparar o POS…</p>
      </main>
    );
  }

  if (!context) {
    if (availableStores.length > 0) {
      return (
        <main className="grid min-h-screen place-items-center bg-[#0a0807] p-6 text-white">
          <section className="w-full max-w-xl rounded-3xl border border-[#e5a93c]/30 bg-[#151310] p-8 shadow-2xl">
            <p className="text-sm font-black tracking-[0.2em] text-[#e5a93c]">CONFIGURAÇÃO INICIAL</p>
            <h1 className="mt-2 text-3xl font-black">Vincular este PC</h1>
            <p className="mt-2 text-sm text-[#a89f91]">
              Esta acção é feita uma vez por um gerente ou pelo dono e fica auditada.
            </p>
            <label className="mt-6 block text-sm font-bold text-[#c8bfb0]" htmlFor="pos-store">
              Loja
            </label>
            <select
              id="pos-store"
              value={selectedStoreId}
              onChange={(event) => setSelectedStoreId(event.target.value)}
              className="mt-2 min-h-16 w-full rounded-2xl border border-white/10 bg-black/30 px-4 font-bold"
            >
              {availableStores.map((store) => (
                <option key={store.id} value={store.id}>{store.short_name}</option>
              ))}
            </select>
            <label className="mt-4 block text-sm font-bold text-[#c8bfb0]" htmlFor="pos-label">
              Nome do terminal
            </label>
            <input
              id="pos-label"
              value={deviceLabel}
              onChange={(event) => setDeviceLabel(event.target.value)}
              maxLength={80}
              className="mt-2 min-h-16 w-full rounded-2xl border border-white/10 bg-black/30 px-4 font-bold outline-none focus:border-[#e5a93c]"
            />
            <label className="mt-4 block text-sm font-bold text-[#c8bfb0]" htmlFor="bridge-url">
              Endereço local do bridge
            </label>
            <input
              id="bridge-url"
              value={bridgeUrl}
              onChange={(event) => setBridgeUrl(event.target.value)}
              className="mt-2 min-h-16 w-full rounded-2xl border border-white/10 bg-black/30 px-4 font-mono text-sm outline-none focus:border-[#e5a93c]"
            />
            <label className="mt-4 block text-sm font-bold text-[#c8bfb0]" htmlFor="bridge-token">
              Token local do bridge
            </label>
            <input
              id="bridge-token"
              type="password"
              value={bridgeToken}
              onChange={(event) => setBridgeToken(event.target.value)}
              autoComplete="off"
              className="mt-2 min-h-16 w-full rounded-2xl border border-white/10 bg-black/30 px-4 font-mono outline-none focus:border-[#e5a93c]"
            />
            {error && <p role="alert" className="mt-4 rounded-xl bg-red-950/60 p-3 text-red-200">{error}</p>}
            <button
              type="button"
              disabled={binding || deviceLabel.trim().length < 3 || bridgeToken.trim().length < 32}
              onClick={() => void bindDevice()}
              className="mt-6 min-h-16 w-full rounded-2xl bg-[#e5a93c] px-6 font-black text-black disabled:opacity-40"
            >
              {binding ? 'A vincular…' : 'Vincular POS'}
            </button>
          </section>
        </main>
      );
    }

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
          <>
            <button
              type="button"
              disabled={reprintPending}
              onClick={() => void reprintLastReceipt()}
              className="min-h-16 rounded-xl border border-[#e5a93c]/40 px-4 text-sm font-bold text-[#e5a93c] active:bg-[#e5a93c]/10 disabled:opacity-40"
            >
              {reprintPending ? 'A reimprimir…' : `Reimprimir talão #${lastSale.dailyNumber}`}
            </button>
            <button
              type="button"
              onClick={() => setVoidOpen(true)}
              className="min-h-16 rounded-xl border border-red-500/40 px-4 text-sm font-bold text-red-300 active:bg-red-950"
            >
              Anular #{lastSale.dailyNumber}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => void lockDevice()}
          className="min-h-16 rounded-xl bg-white/[0.07] px-4 text-sm font-bold active:bg-white/15"
        >
          Bloquear
        </button>
        <div
          role="status"
          className={`rounded-full px-3 py-2 text-sm font-bold ${
            networkStatus.tone === 'offline'
              ? 'bg-amber-500/15 text-amber-300'
              : 'bg-emerald-500/15 text-emerald-300'
          }`}
        >
          {reprintFeedback ?? networkStatus.label}
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
            {visibleItems.map((item) => {
              const availability = posItemAvailability(item);
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!availability.sellable}
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
                    {availability.badge && (
                      <span
                        className={`rounded-full px-2 py-1 text-[11px] font-black uppercase ${
                          availability.sellable
                            ? 'bg-white/10 text-[#d8d2c6]'
                            : 'bg-[#7a2b2b] text-white'
                        }`}
                      >
                        {availability.badge}
                      </span>
                    )}
                    {cart[item.id] && (
                      <span className="grid h-9 min-w-9 place-items-center rounded-full bg-[#e5a93c] px-2 font-black text-black">
                        {cart[item.id].qty}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
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
            <p className="text-lg font-black text-emerald-300">
              {confirmation.offline ? 'VENDA GUARDADA OFFLINE' : 'VENDA REGISTADA'}
            </p>
            <p className="my-6 text-8xl font-black text-white">{confirmation.dailyNumber}</p>
            <p className="text-3xl font-black text-[#e5a93c]">{mt(confirmation.totalCents)}</p>
            <p className="mt-4 text-sm text-[#847e72]">
              {confirmation.offline ? 'Será sincronizada quando a ligação voltar.' : 'A preparar a próxima venda…'}
            </p>
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

      {(!pinConfigured || locked) && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/95 p-4">
          <section className="w-full max-w-md rounded-3xl border border-[#e5a93c]/30 bg-[#151310] p-7 text-center shadow-2xl">
            <p className="text-sm font-black tracking-[0.2em] text-[#e5a93c]">
              {pinConfigured ? 'POS BLOQUEADO' : 'CRIAR PIN'}
            </p>
            <h2 className="mt-3 text-3xl font-black">
              {pinConfigured ? context.deviceLabel : 'Protege este turno'}
            </h2>
            <p className="mt-2 text-sm text-[#a89f91]">
              {pinConfigured
                ? 'Introduz o teu PIN pessoal para continuar.'
                : 'Escolhe 4 a 6 algarismos. O PIN é guardado apenas como hash.'}
            </p>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              autoFocus
              aria-label="PIN"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void (pinConfigured ? unlockDevice() : configurePin());
                }
              }}
              className="mt-6 min-h-16 w-full rounded-2xl border border-white/15 bg-black/40 px-4 text-center text-3xl font-black tracking-[0.5em] outline-none focus:border-[#e5a93c]"
            />
            {!pinConfigured && (
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                aria-label="Confirmar PIN"
                placeholder="Confirmar PIN"
                value={pinConfirmation}
                onChange={(event) => setPinConfirmation(event.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void configurePin();
                }}
                className="mt-3 min-h-16 w-full rounded-2xl border border-white/15 bg-black/40 px-4 text-center text-xl font-black tracking-[0.35em] outline-none focus:border-[#e5a93c]"
              />
            )}
            {pinError && (
              <p role="alert" className="mt-4 rounded-xl bg-red-950/60 p-3 font-bold text-red-200">
                {pinError}
              </p>
            )}
            <button
              type="button"
              disabled={submitting || !isPosPin(pin) || (!pinConfigured && pin !== pinConfirmation)}
              onClick={() => void (pinConfigured ? unlockDevice() : configurePin())}
              className="mt-5 min-h-16 w-full rounded-2xl bg-[#e5a93c] px-5 text-lg font-black text-black disabled:opacity-40"
            >
              {submitting ? 'A confirmar…' : pinConfigured ? 'Desbloquear' : 'Guardar PIN'}
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
