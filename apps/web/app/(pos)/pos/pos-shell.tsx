'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatMT, type Cents } from '@delivery/core';
import { createClient } from '@/utils/supabase/client';
import { useBrand } from '@/lib/brand/context';
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
  clearLocalBridgeConfig,
  printOfflineSale,
  readLocalBridgeConfig,
  saveLocalBridgeConfig,
} from '@/lib/pos/offline-sales';
import { syncOfflineSales } from '@/lib/pos/offline-sync';
import { connectionStatus } from '@/lib/pos/connection-status';
import { trackUpsell } from '@/lib/analytics/track';
import { buildPosUpsellFunnel, type PosUpsellStep } from '@/lib/pos/pos-upsell';
import { isPosPin, POS_IDLE_TIMEOUT_MS } from '@/lib/pos/session';
import { OrdersBoard } from './orders-board';
import { SenhasTab } from './senhas-tab';
import { PosIcon, type PosIconName } from './pos-icons';
import { AvailabilityPanel } from './availability-panel';
import { useNewOrderAlert } from './use-new-order-alert';
import { prepararSom, tocarAlarme } from '@/lib/pos/chime';
import {
  CURRENT_BUILD,
  VERSION_CHECK_MS,
  canReloadNow,
  fetchLatestBuild,
  isNewBuild,
  markReload,
  reloadAllowed,
} from '@/lib/pos/app-update';
import { PosLogin } from './pos-login';
import { loadActiveOnlineOrders } from '@/lib/pos/delivery-orders';
import { OnlineOrdersTab, type OnlineOrder } from './online-orders-tab';
import { buildSaleClosing, type SaleClosing } from '@/lib/pos/sale-confirmation';
import { TouchKeyboard } from './touch-keyboard';
import { buildPickupSlots, formatSlot } from '@/lib/pos/schedule';
import { noteHasChip, toggleNoteChip } from '@/lib/pos/notes';
import {
  enabledPaymentMethods,
  FACTORY_POS_SETTINGS,
  fetchPosSettings,
  readCachedPosSettings,
  writeCachedPosSettings,
  type PosSettings,
} from '@/lib/pos/settings';
import {
  cartCount,
  cartLines,
  cartTotalCents,
  changeQty as applyQty,
  defaultVariant,
  needsVariantChoice,
  qtyOfItem,
  removeOneOfItem,
  resolveSellable,
  salePayloadItems,
  setLineNotes,
  type Cart,
  type CartLine,
  type PosVariant,
} from '@/lib/pos/cart';
import {
  EMPTY_PAYMENT_INFO,
  parsePaymentInfo,
  paymentInstructions,
  readCachedPaymentInfo,
  writeCachedPaymentInfo,
  type PosPaymentInfo,
} from '@/lib/pos/payment-info';
import {
  buildDisplayFrame,
  frameKey,
  sendDisplayFrame,
  type DisplayState,
} from '@/lib/pos/customer-display';

type DeliveryZone = { id: string; name: string; fee_cents: number };

/**
 * O `get_menu` sempre devolveu muito mais do que categorias — zonas de entrega,
 * o interruptor do upsell e os canais activos da loja. O POS deitava tudo fora
 * e ficava a adivinhar. Estes campos vivem só em memória, de propósito: offline
 * o POS vende balcão e não cria pedidos de entrega (CLAUDE §7.5), logo não faz
 * sentido guardá-los na cache como se fossem utilizáveis sem rede.
 */
type StoreChannels = {
  zones: DeliveryZone[];
  /** Horario do dia de hoje, para saber ate quando se pode agendar. */
  closesAt: string | null;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
};

type FulfillmentType = 'counter' | 'pickup' | 'delivery';

const FULFILLMENT_LABELS: Record<FulfillmentType, string> = {
  counter: 'Balcão',
  pickup: 'Levantamento',
  delivery: 'Entrega',
};

const FULFILLMENT_ICONS: Record<FulfillmentType, PosIconName> = {
  counter: 'store',
  pickup: 'bag',
  delivery: 'truck',
};

const METHOD_ICONS: Record<CounterPaymentMethod, PosIconName> = {
  cash: 'cash',
  mpesa: 'phone',
  emola: 'phone',
  credit_card: 'card',
};

type PosContext = {
  deviceId: string;
  storeId: string;
  deviceLabel: string;
  storeSlug: string;
  storeName: string;
};

type AvailableStore = {
  id: string;
  slug: string;
  short_name: string;
};

// O carrinho vive em `lib/pos/cart.ts`: é lá que se decide o preço da variante
// e o que conta como a mesma linha. Aqui só se desenha.
type AllocationMap = Partial<Record<CounterPaymentMethod, number>>;

const DEVICE_STORAGE_KEY = 'hs_pos_device_id';
// Meios de pagamento, notas rápidas, upsell, tipo de pedido por defeito e
// tempo de confirmação vêm das definições do POS da loja
// (`lib/pos/settings.ts`, aba POS do painel) — não deste ficheiro.

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
  return data;
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

const KEYBOARD_LABELS = {
  name: 'Nome do cliente',
  phone: 'Telefone',
  address: 'Morada da entrega',
  orderNote: 'Nota do pedido',
} as const;

/**
 * Uma barra do painel do carrinho: o nome do campo em cima, o que já tem em
 * baixo. Tocar abre o sítio de o preencher. `warn` pinta a âmbar enquanto
 * estiver vazio — é o que falta antes de a entrega sair bem.
 */
function CartField({
  label,
  value,
  placeholder,
  warn = false,
  className = '',
  onClick,
}: {
  label: string;
  value: string;
  placeholder: string;
  warn?: boolean;
  className?: string;
  onClick: () => void;
}) {
  const vazio = !value;
  const alerta = warn && vazio;
  return (
    <button
      type="button"
      onClick={onClick}
      data-warn={alerta}
      className={`pos-field ${className}`}
    >
      <span className="min-w-0 flex-1">
        <span className={`pos-eyebrow !block truncate ${alerta ? '!text-amber-300/80' : ''}`}>
          {label}
        </span>
        <span
          className={`mt-0.5 block truncate text-[0.9375rem] ${
            vazio
              ? alerta
                ? 'font-medium text-amber-100'
                : 'font-medium text-ink-mute'
              : 'font-semibold text-ink'
          }`}
        >
          {value || placeholder}
        </span>
      </span>
      <PosIcon name="chevron" size={18} className="shrink-0 text-ink-mute" />
    </button>
  );
}

export function PosShell() {
  const brand = useBrand();
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
  /** Terminal já vinculado mas sem sessão: é o ecrã dos cartões da equipa. */
  const [cardLoginDeviceId, setCardLoginDeviceId] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [pinConfirmation, setPinConfirmation] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const warmedPhotoUrls = useRef<Set<string>>(new Set());
  // 'delivery' é só consulta — o cashier acompanha o que está a sair pela
  // loja online sem sair do POS nem precisar de acesso ao painel admin.
  const [posView, setPosView] = useState<'menu' | 'delivery' | 'senhas'>('menu');
  const [deliveryResult, setDeliveryResult] = useState<{ storeSlug: string; orders: OnlineOrder[] }>({ storeSlug: '', orders: [] });
  const deliveryOrders = deliveryResult.storeSlug === context?.storeSlug ? deliveryResult.orders : [];
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const deliveryRequest = useRef<AbortController | null>(null);
  const [cart, setCart] = useState<Cart>({});
  /** Item à espera de escolha de variante (HAW/WAGYU, Zero, 6 unidades…). */
  const [variantPick, setVariantPick] = useState<MenuItem | null>(null);
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
    closing: SaleClosing;
  } | null>(null);
  /** Um só temporizador de confirmação: o da venda anterior nunca fecha a seguinte. */
  const confirmationTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(confirmationTimer.current), []);
  const [lastSale, setLastSale] = useState<{ orderId: string; dailyNumber: number } | null>(null);
  const [paying, setPaying] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  /**
   * Definições do POS desta loja (aba POS do painel). Arranca no valor de
   * fábrica e é trocada pela da loja ao carregar — ou pela cache, offline.
   */
  const [posSettings, setPosSettings] = useState<PosSettings>(FACTORY_POS_SETTINGS);
  const payMethods = useMemo(() => enabledPaymentMethods(posSettings), [posSettings]);
  const quickNotes = posSettings.quickNotes;
  const alerta = useNewOrderAlert(
    context?.storeId ?? null,
    boardOpen,
    posSettings.alerts.newOrderChime,
  );
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
      // Terminal já vinculado entra pelos cartões da equipa — ninguém escreve
      // um email num ecrã tátil com fila à frente (§7.1). O email fica para
      // quem ainda não é deste PC: vincular o terminal e criar o primeiro PIN.
      const bound = window.localStorage.getItem(DEVICE_STORAGE_KEY);
      if (bound) {
        setCardLoginDeviceId(bound);
        setLoading(false);
        return;
      }
      router.replace('/login?next=/pos');
      return;
    }
    setCardLoginDeviceId(null);
    setSessionUserId(sessionData.session.user.id);

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
        // NAO pre-seleccionar loja nenhuma. As lojas vem por ordem alfabetica
        // e "Maputo" vem antes de "Matola" — pre-seleccionar a primeira fazia
        // com que quem nao mexesse no selector vinculasse o PC a Maputo sem
        // dar por isso. Aconteceu varias vezes na Matola, e o sintoma so
        // aparece la a frente: as vendas caem na loja errada e nao imprimem,
        // porque o bridge dessa loja nunca ve os trabalhos. Escolher a loja
        // passa a ser um acto deliberado.
        setSelectedStoreId((current) => current);
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
    // Offline o fetcher rebenta e o `loadMenuWithFallback` serve a cache — este
    // payload fica a null e os canais mantêm o que já tinham. É o comportamento
    // certo: sem rede não se criam pedidos de entrega.
    let payload: Record<string, unknown> | null = null;
    try {
      const menu = await loadMenuWithFallback(store.slug, async () => {
        const full = (await fetchMenu(supabase, store.slug)) as Record<string, unknown>;
        payload = full;
        return full.categories;
      });
      nextCategories = menu.categories;
    } catch (menuError) {
      setError(errorMessage(menuError instanceof Error ? menuError.message : undefined));
      setLoading(false);
      return;
    }
    setCategories(nextCategories);
    if (payload) {
      const full = payload as {
        zones?: DeliveryZone[];
        hours?: Array<{ dow: number; opens: string; closes: string; active?: boolean }>;
        store?: { pickup_enabled?: boolean; delivery_enabled?: boolean };
      };
      const hoje = new Date().getDay();
      const horarioDeHoje = (full.hours ?? []).find((h) => h.dow === hoje && h.active !== false);
      setChannels({
        zones: full.zones ?? [],
        closesAt: horarioDeHoje?.closes ?? null,
        pickupEnabled: full.store?.pickup_enabled !== false,
        deliveryEnabled: full.store?.delivery_enabled !== false,
      });
    }
    // Os números do M-Pesa/e-Mola desta loja, ao contrário dos canais, ficam
    // guardados: sem rede o balcão continua a vender e o cliente continua a
    // poder pagar por móvel. Um número que só aparece com internet falha
    // exactamente no dia em que faz falta.
    const numeros = payload
      ? parsePaymentInfo(payload)
      : readCachedPaymentInfo(window.localStorage, store.slug) ?? EMPTY_PAYMENT_INFO;
    setPaymentInfo(numeros);
    if (payload) writeCachedPaymentInfo(window.localStorage, store.slug, numeros);

    // Definições do POS da loja. Mesma regra dos números: ficam em cache, porque
    // offline o balcão continua a precisar dos seus meios de pagamento e das
    // suas notas. Falhar a leitura nunca pára o POS — cai na cache ou na fábrica.
    const cachedSettings = readCachedPosSettings(window.localStorage, store.slug);
    if (cachedSettings) setPosSettings(cachedSettings);
    if (payload) {
      const lidas = await fetchPosSettings(supabase, device.store_id);
      if (lidas) {
        setPosSettings(lidas);
        writeCachedPosSettings(window.localStorage, store.slug, lidas);
      }
    }
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
      storeId: device.store_id,
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

  const refreshMenu = useCallback(async () => {
    if (!context) return;
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
    // O que o dono muda na aba POS chega ao balcão no mesmo ritmo do cardápio,
    // sem reiniciar o terminal. Falhar aqui mantém o que já estava.
    const lidas = await fetchPosSettings(supabase, context.storeId);
    if (lidas) {
      setPosSettings(lidas);
      writeCachedPosSettings(window.localStorage, context.storeSlug, lidas);
    }
  }, [context, supabase]);

  useEffect(() => {
    if (!context) return;
    const timer = window.setInterval(() => void refreshMenu(), MENU_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [context, refreshMenu]);

  // Um "esgotado" marcado no painel ou noutro terminal chega ao balcão em
  // segundos: o POS é um quiosque e ninguém o recarrega à mão. O realtime só
  // dispara o refetch (CLAUDE §11.3) e junta rajadas — uma venda mexe em
  // várias linhas de store_items de uma vez. Se o realtime cair, o polling
  // de 15 s acima assume.
  useEffect(() => {
    if (!context) return;
    let debounce: number | undefined;
    const refetch = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void refreshMenu(), 800);
    };
    const channel = supabase
      .channel(`pos-menu-${context.storeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'store_items',
          filter: `store_id=eq.${context.storeId}`,
        },
        refetch,
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, refetch)
      .subscribe();
    // Ecrã que volta a acender ou rede que volta: lê já, não no próximo ciclo.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetch();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', refetch);
    return () => {
      window.clearTimeout(debounce);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', refetch);
      void supabase.removeChannel(channel);
    };
  }, [context, refreshMenu, supabase]);

  const fetchDeliveryOrders = useCallback(async () => {
    if (!context) return;
    deliveryRequest.current?.abort();
    const controller = new AbortController();
    deliveryRequest.current = controller;
    setDeliveryLoading(true);
    setDeliveryError(null);
    try {
      const orders = await loadActiveOnlineOrders<OnlineOrder>((filters, signal) => {
        const request = supabase.rpc('get_orders', { p_filters: filters });
        return signal ? request.abortSignal(signal) : request;
      }, context.storeSlug, controller.signal);
      if (!controller.signal.aborted) setDeliveryResult({ storeSlug: context.storeSlug, orders });
    } catch {
      if (!controller.signal.aborted) setDeliveryError('Não foi possível actualizar. Os pedidos apresentados são da última consulta.');
    } finally {
      if (!controller.signal.aborted) setDeliveryLoading(false);
    }
  }, [context, supabase]);

  // Só faz polling enquanto a aba Delivery está aberta — o balcão já sofreu
  // com tráfego de fundo desnecessário em wifi fraco (aquecimento de fotos),
  // não vale a pena repetir o erro aqui.
  useEffect(() => {
    if (posView !== 'delivery' || !context) return;
    void fetchDeliveryOrders();
    const timer = window.setInterval(() => void fetchDeliveryOrders(), 20_000);
    return () => { window.clearInterval(timer); deliveryRequest.current?.abort(); };
  }, [posView, context, fetchDeliveryOrders]);

  useEffect(() => { setDeliveryError(null); }, [context?.storeSlug]);

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
              items: sale.items.map((item) => ({
                menuItemId: item.menuItemId,
                qty: item.qty,
                ...(item.upsell ? { upsell: item.upsell } : {}),
                ...(item.variantId ? { variantId: item.variantId } : {}),
                ...(item.notes ? { notes: item.notes } : {}),
              })),
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
      // Dizer só "exige um gerente" deixa quem está à frente do ecrã sem saída:
      // é um caixa a ver um botão que nunca lhe vai funcionar. A instrução tem
      // de vir com a mensagem — vincula-se uma vez, e depois a caixa entra na
      // sua própria conta neste mesmo PC.
      setError(
        bindError?.message.includes('device_binding_access_denied')
          ? 'Esta conta não pode vincular o PC. Sai e entra com a conta do gerente '
            + 'desta loja (ou a do dono), vincula uma vez, e depois volta à tua conta — '
            + 'a vinculação fica guardada neste computador.'
          : bindError?.message.includes('device_binding_store_denied')
            ? 'A tua conta não tem acesso a esta loja. Escolhe a loja certa ou pede '
              + 'ao dono para te dar acesso em Equipa.'
            : errorMessage(bindError?.message),
      );
      return;
    }
    window.localStorage.setItem(DEVICE_STORAGE_KEY, data.device_id);
    await loadPos();
  }

  /**
   * Desvincula este PC do terminal.
   *
   * Limpa so o que e DESTE computador: o id do dispositivo e a configuracao
   * local do bridge. Nao desactiva o dispositivo no servidor nem toca em
   * vendas — quem manda um PC embora nao esta a apagar historico.
   */
  function unbindDevice() {
    window.localStorage.removeItem(DEVICE_STORAGE_KEY);
    try {
      clearLocalBridgeConfig(window.localStorage);
    } catch {
      // Configuracao local ja ausente — seguir na mesma.
    }
    window.location.reload();
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

  /**
   * Desbloqueio de quem já tem a sessão aberta neste PC.
   *
   * Existe a par da entrada por cartão de propósito: quem bloqueou para ir ao
   * WC volta ao mesmo turno sem trocar de sessão, e a fila offline continua a
   * sincronizar em pano de fundo enquanto o ecrã está trancado. Trocar de
   * operador é o outro caminho — esse passa pelo servidor e abre sessão nova.
   */
  const unlockCurrentUser = useCallback(
    async (candidatePin: string): Promise<{ ok: boolean; reason?: string }> => {
      if (!context) return { ok: false, reason: 'invalid_device' };
      if (!isPosPin(candidatePin)) return { ok: false, reason: 'invalid_pin_format' };
      const { error: unlockError } = await supabase.rpc('unlock_pos_device', {
        p_device_id: context.deviceId,
        p_pin: candidatePin,
      });
      if (unlockError) {
        return {
          ok: false,
          reason: unlockError.message.includes('invalid_pin') ? 'invalid_pin' : 'unknown',
        };
      }
      setLocked(false);
      return { ok: true };
    },
    [context, supabase],
  );

  /**
   * Alguem entrou — pelo cartao ou a desbloquear o proprio turno.
   *
   * O carrinho a meio FICA: nao e dinheiro nenhum ate finalizar, e perder um
   * pedido de doze linhas porque o turno rendeu seria pior do que herda-lo.
   * O que nao fica e a ultima venda: reimprimir ou anular a venda de outra
   * pessoa com um toque distraido e exactamente o tipo de acidente que a
   * auditoria do §6 depois tem de explicar.
   */
  const handleAuthenticated = useCallback(
    async (userId: string) => {
      if (sessionUserId && userId !== sessionUserId) {
        setLastSale(null);
        setVoidOpen(false);
      }
      await loadPos();
    },
    [loadPos, sessionUserId],
  );

  const lines = useMemo(() => cartLines(cart), [cart]);
  const subtotalCents = useMemo(() => cartTotalCents(cart), [cart]);
  const count = useMemo(() => cartCount(cart), [cart]);

  // Aquece o cache das fotos do cardápio INTEIRO, não só o da categoria aberta.
  // Sem isto, uma categoria que ninguém abriu com rede aparece sem imagens
  // quando a ligação cai — e a ligação cai sempre no pior momento. O service
  // worker (`/pos-sw.js`) é quem guarda; aqui só se pedem os ficheiros.
  //
  // `warmedPhotoUrls` lembra o que já foi pedido nesta sessão: o menu
  // refresca a cada 15 s (MENU_REFRESH_MS) e cria arrays novos mesmo quando
  // nada mudou, e sem esta memória o efeito pedia TODAS as fotos outra vez a
  // cada ciclo — em wifi fraco isso competia com a venda a decorrer e dava a
  // sensação de o POS estar a travar. Só se pede o que ainda não se pediu.
  useEffect(() => {
    if (categories.length === 0) return;
    const urls = Array.from(
      new Set(
        categories.flatMap((category) =>
          category.items.map((item) => item.photo_url).filter((url): url is string => !!url),
        ),
      ),
    ).filter((url) => !warmedPhotoUrls.current.has(url));
    if (urls.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const url of urls) {
        if (cancelled) return;
        const ok = await fetch(url).then(
          () => true,
          () => false,
        );
        if (ok) warmedPhotoUrls.current.add(url);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [categories]);

  // O ecrã de pagamento vive enquanto houver carrinho. Ao finalizar a venda o
  // carrinho esvazia — e o passo de pagamento fecha-se sozinho, sem ninguém ter
  // de se lembrar de o fechar em cada caminho de saída (venda, anulação, offline).
  useEffect(() => {
    if (lines.length === 0) {
      setPaying(false);
      setFunnel([]);
      setFunnelIndex(0);
      // A venda seguinte é de outro cliente: nome, telefone, zona e nota não
      // podem transitar. Um talão com o nome do cliente anterior é o género de
      // erro que só se descobre com o cliente à frente.
      setFulfillment(defaultFulfillmentRef.current);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerLookup(null);
      setCustomerAddress('');
      setZoneId('');
      setOrderNote('');
      setScheduledFor('');
      setCustomerOpen(false);
    }
  }, [lines.length]);

  const [channels, setChannels] = useState<StoreChannels>({
    zones: [],
    closesAt: null,
    pickupEnabled: true,
    deliveryEnabled: true,
  });
  const [fulfillment, setFulfillment] = useState<FulfillmentType>('counter');

  /**
   * O tipo de pedido com que o POS abre (definições da loja) — mas só se esse
   * canal estiver mesmo disponível agora. Offline, ou com a entrega desligada
   * na loja, volta ao balcão: oferecer o que não se cumpre é pior (§7.5).
   */
  const canalPermitido = useCallback(
    (tipo: FulfillmentType) =>
      tipo === 'counter' ||
      (online && (tipo === 'pickup' ? channels.pickupEnabled : channels.deliveryEnabled)),
    [online, channels.pickupEnabled, channels.deliveryEnabled],
  );
  const defaultFulfillment: FulfillmentType = canalPermitido(posSettings.cart.defaultFulfillment)
    ? posSettings.cart.defaultFulfillment
    : 'counter';
  const defaultFulfillmentRef = useRef(defaultFulfillment);
  defaultFulfillmentRef.current = defaultFulfillment;

  // Carrinho vazio e o padrão da loja mudou (chegaram as definições, ou a rede
  // voltou): o próximo pedido já começa no tipo certo. Com carrinho a meio não
  // se mexe — é a escolha de quem está a atender.
  useEffect(() => {
    if (lines.length === 0) setFulfillment(defaultFulfillment);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultFulfillment]);

  // Um canal que deixou de estar disponível a meio (a rede caiu) não pode
  // continuar escolhido.
  useEffect(() => {
    if (!canalPermitido(fulfillment)) setFulfillment('counter');
  }, [canalPermitido, fulfillment]);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  /**
   * Quem é esta pessoa, assim que o telefone chega a 9 dígitos — no balcão
   * também, não só na entrega. `identify_customer` já existe para a loja
   * online; chamá-lo aqui é o que passa a contar a compra presencial na
   * mesma ficha do cliente, em vez de ficar presa a "Balcão" sem nome.
   */
  const [customerLookup, setCustomerLookup] = useState<{
    name: string | null;
    orders_count: number;
    total_spent_cents: number;
  } | null>(null);

  // Dispara só quando o telefone confirmado no teclado chega a 9 dígitos —
  // o teclado só actualiza customerPhone ao fechar, por isso isto não corre
  // a cada tecla. Offline não identifica (§7.5: o balcão offline só vende).
  useEffect(() => {
    const digits = customerPhone.replace(/\D/g, '');
    if (digits.length < 9 || !navigator.onLine) {
      setCustomerLookup(null);
      return;
    }
    let active = true;
    void supabase
      .rpc('identify_customer', { p_phone: customerPhone, p_name: customerName.trim() || null })
      .then(({ data, error }) => {
        if (!active || error || !data) return;
        const resumo = data as { name: string | null; orders_count: number; total_spent_cents: number };
        setCustomerLookup(resumo);
        // Cliente já conhecido e a atendente ainda não escreveu nome: sugere
        // o que já sabemos em vez de obrigar a reescrevê-lo.
        if (resumo.name && !customerName.trim()) setCustomerName(resumo.name);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerPhone]);
  /**
   * Onde é a entrega. Nome, telefone e zona não são uma morada: o entregador
   * saía do balcão com "Zona Maputo" e um número para telefonar do carro.
   */
  const [customerAddress, setCustomerAddress] = useState('');
  const [zoneId, setZoneId] = useState('');
  /** Campo de texto aberto no teclado do ecrã. Null = teclado fechado. */
  const [keyboardField, setKeyboardField] = useState<
    'name' | 'phone' | 'address' | 'orderNote' | null
  >(null);
  /** Confirmação de "desvincular este PC", no ecrã bloqueado. */
  const [unbindConfirm, setUnbindConfirm] = useState(false);
  /** Linha do carrinho a receber nota ("sem jalapeño"). */
  const [noteLine, setNoteLine] = useState<CartLine | null>(null);
  const [noteKeyboard, setNoteKeyboard] = useState(false);
  /** A nota da linha enquanto se escolhe — só vai para o carrinho no OK. */
  const [noteDraft, setNoteDraft] = useState('');
  /** Selector aberto no painel do carrinho (horário ou zona). */
  const [cartPicker, setCartPicker] = useState<'schedule' | 'zone' | null>(null);
  /**
   * Os dados do cliente abertos no carrinho. Fechados, são uma barra só: o
   * espaço do painel é dos artigos, que é o que se confere a cada venda. Abrem
   * ao escolher Levantamento ou Entrega (é aí que são precisos) e fecham à mão
   * depois de anotados — a barra continua a dizer o que falta.
   */
  const [customerOpen, setCustomerOpen] = useState(false);

  /**
   * A taxa da zona escolhida.
   *
   * Quem manda no preco e o servidor (Regra 2): a RPC volta a procurar a zona
   * e a somar a taxa. Isto e so para o operador ver o total certo antes de
   * cobrar e para o plano de pagamento fechar — se o POS cobrasse o subtotal,
   * a venda passava a ser recusada com payment_total_mismatch.
   */
  const deliveryFeeCents = useMemo(() => {
    if (fulfillment !== 'delivery' || !zoneId) return 0;
    return channels.zones.find((zone) => zone.id === zoneId)?.fee_cents ?? 0;
  }, [channels.zones, fulfillment, zoneId]);
  const totalCents = subtotalCents + deliveryFeeCents;
  const [orderNote, setOrderNote] = useState('');
  /** Hora marcada, em ISO com fuso. Vazio = para agora. */
  const [scheduledFor, setScheduledFor] = useState('');
  const [funnel, setFunnel] = useState<PosUpsellStep[]>([]);
  const [funnelIndex, setFunnelIndex] = useState(0);
  const funnelStep = funnel[funnelIndex] ?? null;
  useEffect(() => {
    if (!funnelStep || !context?.storeSlug) return;
    for (const item of funnelStep.items) trackUpsell('upsell_view', item.id, `pos_${funnelStep.kind}`, 'pos', context.storeSlug, saleId);
  }, [funnelStep, context?.storeSlug, saleId]);
  const [paymentInfo, setPaymentInfo] = useState<PosPaymentInfo>(EMPTY_PAYMENT_INFO);
  /** Último artigo tocado — é o que o visor do cliente mostra a seguir. */
  const [lastTouched, setLastTouched] = useState<{ id: string; name: string } | null>(null);

  /**
   * O carrinho não vai directo ao pagamento: passa pelo funil de upsell.
   * `buildPosUpsellFunnel` devolve lista vazia quando não há nada a oferecer
   * (pedido já completo, só uma bebida, upsell desligado) — e aí não se perde
   * um segundo. O funil nunca inventa um passo sem produtos.
   */
  function startCheckout() {
    const passos = buildPosUpsellFunnel({
      enabled: posSettings.upsell.enabled,
      steps: posSettings.upsell.steps,
      categories,
      cart: lines.map((line) => ({ menuItemId: line.menuItemId, qty: line.qty })),
      // Estável durante esta venda, diferente na próxima: roda as frases sem as
      // fazer piscar enquanto o operador está a ler.
      seed: Math.floor(Date.now() / 1000),
    });
    if (passos.length === 0) {
      setPaying(true);
      return;
    }
    setFunnel(passos);
    setFunnelIndex(0);
  }

  function advanceFunnel() {
    const proximo = funnelIndex + 1;
    if (proximo >= funnel.length) {
      setFunnel([]);
      setFunnelIndex(0);
      setPaying(true);
      return;
    }
    setFunnelIndex(proximo);
  }

  /**
   * Voltar ao carrinho a meio da oferta. Não é uma porta de saída do funil: o
   * `startCheckout` volta a construí-lo no PAGAR seguinte. Serve só para ir
   * corrigir o que já lá estava — e é a diferença entre um engano e um estorno.
   */
  function cancelFunnel() {
    setFunnel([]);
    setFunnelIndex(0);
  }
  const activeCategoryObj = categories.find((category) => category.id === activeCategory);
  const visibleItems = activeCategoryObj?.items ?? [];
  // Bebidas são lata/garrafa: a foto não vende como a do prato e cartões
  // grandes só fazem scroll a mais no ecrã que devia ser o mais rápido do
  // balcão. Cartão pequeno, mais por linha, mesma grelha.
  const isDrinksCategory = /bebida/i.test(activeCategoryObj?.name ?? '');
  const paymentPlan = useMemo(
    () => buildPaymentPlan({ totalCents, methods, mixed, allocations }),
    [allocations, methods, mixed, totalCents],
  );
  const cashPaymentCents =
    paymentPlan.payments.find((payment) => payment.method === 'cash')?.amountCents ?? 0;
  // No misto, o que se escreve no botão Dinheiro já é o recebido (payment.ts);
  // o campo "Recebido" à parte só existe no pagamento só em dinheiro.
  const receivedCents = mixed ? (paymentPlan.cashReceivedCents ?? 0) : cashReceivedCents;
  const changeCents = useMemo(() => {
    if (cashPaymentCents === 0 || receivedCents < cashPaymentCents) return null;
    return calculateChange(cashPaymentCents, receivedCents);
  }, [cashPaymentCents, receivedCents]);

  /**
   * Pagamento móvel: o guião que o operador diz e o número que o cliente marca.
   *
   * Estava tudo na cabeça de quem está ao balcão — e o número dito de cor é o
   * género de erro que só se descobre quando o dinheiro não chega. O número vem
   * da loja (`stores.mpesa_number`), nunca do código.
   */
  const mobileMethod = methods.find(
    (method): method is 'mpesa' | 'emola' => method === 'mpesa' || method === 'emola',
  );
  const mobileInstructions = useMemo(() => {
    if (!mobileMethod) return null;
    const due = !mixed
      ? totalCents
      : (allocations[mobileMethod] ?? 0) || Math.max(0, paymentPlan.remainingCents);
    return paymentInstructions(mobileMethod, paymentInfo, due);
  }, [allocations, mixed, mobileMethod, paymentInfo, paymentPlan.remainingCents, totalCents]);

  /**
   * O que aparece no visor virado para o cliente, passo a passo. Sem venda em
   * curso volta ao ocioso e é o bridge que passa o nome da casa a andar.
   */
  const displayState = useMemo<DisplayState>(() => {
    if (confirmation) return { step: 'thanks', dailyNumber: confirmation.dailyNumber };
    if (lines.length === 0) return { step: 'idle' };
    if (paying) {
      // Troco em primeiro lugar: é o número que o cliente quer confirmar.
      if (cashPaymentCents > 0 && changeCents !== null) {
        return { step: 'change', receivedCents, changeCents };
      }
      const method = methods[0] ?? 'cash';
      return {
        step: 'payment',
        method,
        totalCents,
        number: mobileInstructions?.prettyNumber ?? null,
      };
    }
    const touched = lastTouched ? lines.find((line) => line.id === lastTouched.id) : undefined;
    if (touched) {
      return {
        step: 'item',
        name: touched.name,
        qty: touched.qty,
        lineTotalCents: touched.price_cents * touched.qty,
      };
    }
    return { step: 'cart', itemCount: count, totalCents };
  }, [
    cashPaymentCents,
    changeCents,
    confirmation,
    count,
    lastTouched,
    lines,
    methods,
    mobileInstructions,
    paying,
    receivedCents,
    totalCents,
  ]);

  // O artigo fica no visor o tempo de o cliente o ler e depois dá lugar ao
  // total. Um visor preso no último produto não diz quanto se vai pagar.
  useEffect(() => {
    if (!lastTouched) return;
    const timer = window.setTimeout(() => setLastTouched(null), 2500);
    return () => window.clearTimeout(timer);
  }, [lastTouched]);

  // Best-effort puro: sem bridge, sem visor ou sem cabo não acontece nada e
  // ninguém dá por isso do lado de cá do balcão (CLAUDE §1).
  const lastDisplayFrame = useRef('');
  useEffect(() => {
    const bridge = readLocalBridgeConfig(window.localStorage);
    if (!bridge) return;
    const frame = buildDisplayFrame(displayState);
    const key = frameKey(frame);
    if (key === lastDisplayFrame.current) return;
    lastDisplayFrame.current = key;
    void sendDisplayFrame(bridge, frame);
  }, [displayState]);

  function changeQty(item: MenuItem, delta: number, variant?: PosVariant | null) {
    // Sem variante indicada assume-se a de omissão. É o que faz um produto sem
    // escolha (batata) e um produto de escolha única continuarem a ser um toque.
    const sellable = resolveSellable(item, variant ?? defaultVariant(item));
    setLastTouched({ id: sellable.id, name: sellable.name });
    if (funnelStep && delta > 0) {
      sellable.upsell = { kind: 'companion', qty: delta, placement: `pos_${funnelStep.kind}` };
      trackUpsell('upsell_accept', item.id, sellable.upsell.placement, 'pos', context?.storeSlug, saleId);
    }
    setCart((current) => applyQty(current, sellable, delta));
  }

  /**
   * O toque na grelha.
   *
   * Um Classic Smash não é um preço só: HAW são 300 e WAGYU são 400. Enquanto
   * o balcão não perguntava, o WAGYU **não se conseguia vender** — e o servidor
   * (migration 1018) já sabia cobrá-lo. Pergunta-se apenas quando há mesmo
   * escolha; o resto do cardápio continua a entrar com um toque.
   */
  function tapItem(item: MenuItem) {
    if (needsVariantChoice(item)) {
      setVariantPick(item);
      return;
    }
    changeQty(item, 1);
  }

  /**
   * O ± da lista do carrinho. Age sobre a linha que já existe, e por isso não
   * volta a perguntar a variante: quem já escolheu WAGYU e carrega no + quer
   * outro WAGYU, não outra pergunta.
   */
  function changeLineQty(line: CartLine, delta: number) {
    setLastTouched({ id: line.id, name: line.name });
    setCart((current) => applyQty(current, { ...line, upsell: undefined }, delta));
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
      // Os dois primeiros meios ligados na loja (por defeito dinheiro + M-Pesa).
      const par = payMethods.slice(0, 2).map((m) => m.id);
      setMethods(par);
      setKeypadTarget(par[0] ?? 'cash');
    } else {
      const primeiro = methods[0] ?? payMethods[0]?.id ?? 'cash';
      setMethods([primeiro]);
      setKeypadTarget(primeiro === 'cash' ? 'cash_received' : primeiro);
    }
  }

  const mixedAvailable = posSettings.payments.allowMixed && payMethods.length >= 2;

  // A loja desligou o meio que estava escolhido (ou o misto): volta ao primeiro
  // meio ligado. Sem isto o ecrã podia cobrar por um botão que já não existe.
  useEffect(() => {
    const ligados = new Set(payMethods.map((m) => m.id));
    const valido = methods.every((m) => ligados.has(m)) && (!mixed || mixedAvailable);
    if (valido) return;
    // Volta a um estado limpo de um só meio: uma parcela de um pagamento misto
    // atribuída a um meio que já não existe não pode ficar pendurada.
    const primeiro = payMethods[0]?.id ?? 'cash';
    setMixed(false);
    setAllocations({});
    setMethods([primeiro]);
    setKeypadTarget(primeiro === 'cash' ? 'cash_received' : primeiro);
  }, [payMethods, mixedAvailable, methods, mixed]);

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

  /**
   * Mostra "VENDA REGISTADA". Com dinheiro não há temporizador: o ecrã só sai
   * com o OK do caixa, depois de entregar o troco (`lib/pos/sale-confirmation`).
   * Sem dinheiro continua a sair sozinho, nos segundos da aba POS.
   */
  function showConfirmation(next: NonNullable<typeof confirmation>) {
    window.clearTimeout(confirmationTimer.current);
    setConfirmation(next);
    if (!next.closing.requiresAck) {
      confirmationTimer.current = window.setTimeout(
        () => setConfirmation(null),
        posSettings.sale.confirmationSeconds * 1000,
      );
    }
  }

  function dismissConfirmation() {
    window.clearTimeout(confirmationTimer.current);
    setConfirmation(null);
  }

  async function finalizeSale() {
    if (!context || lines.length === 0 || !paymentPlan.complete) return;
    if (cashPaymentCents > 0 && changeCents === null) {
      setError('O valor recebido em dinheiro é insuficiente.');
      return;
    }
    // O que o ecrã de confirmação precisa, lido antes de o carrinho limpar.
    const closingInput = {
      payments: paymentPlan.payments,
      cashReceivedCents: cashPaymentCents > 0 ? receivedCents : null,
      clientChangeCents: changeCents,
    };

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
          menuItemId: line.menuItemId,
          // Sem o variantId aqui, um WAGYU vendido sem rede sincronizava ao
          // preco base: cobrado 400 ao cliente, lancado 300 no servidor.
          ...(line.variantId ? { variantId: line.variantId } : {}),
          name: line.name,
          qty: line.qty,
          ...(line.upsell ? { upsell: line.upsell } : {}),
          unitPriceCents: line.price_cents,
          station: line.station,
          ...(line.notes ? { notes: line.notes } : {}),
        })),
        payments: paymentPlan.payments,
        ...(cashPaymentCents > 0 ? { cashReceivedCents: receivedCents } : {}),
        totalCents,
      });
    } catch {
      setSubmitting(false);
      setError('Não foi possível guardar a venda neste PC. Não feches nem recarregues o POS.');
      return;
    }

    const completeOfflineSale = () => {
      setSubmitting(false);
      showConfirmation({
        orderId: '',
        dailyNumber: queuedSale.localNumber,
        totalCents: queuedSale.totalCents,
        offline: true,
        closing: buildSaleClosing(closingInput),
      });
      setCart({});
      setSaleId(crypto.randomUUID());
      setAllocations({});
      setCashReceivedCents(0);
      setPendingSales((current) => current + 1);
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
        items: salePayloadItems(lines),
        payments: paymentPlan.payments,
        ...(cashPaymentCents > 0 ? { cashReceivedCents: receivedCents } : {}),
        // Campos que a RPC sempre aceitou e o POS nunca enviou. Só vão no
        // caminho online: offline o POS vende balcão e não cria entregas
        // (CLAUDE §7.5), por isso a fila local não os transporta.
        fulfillmentType: fulfillment,
        ...(fulfillment === 'delivery' && zoneId ? { deliveryZoneId: zoneId } : {}),
        ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
        ...(customerPhone.trim() ? { customerPhone: customerPhone.trim() } : {}),
        ...(fulfillment === 'delivery' && customerAddress.trim()
          ? { address: customerAddress.trim() }
          : {}),
        ...(orderNote.trim() ? { notes: orderNote.trim() } : {}),
        ...(scheduledFor ? { scheduledFor } : {}),
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
    showConfirmation({
      ...completed,
      closing: buildSaleClosing({ ...closingInput, serverChangeCents: data.change_cents }),
    });
    setLastSale(completed);
    setCart({});
    setSaleId(crypto.randomUUID());
    setAllocations({});
    setCashReceivedCents(0);
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

  /**
   * Rodapé do terminal — vive nos ecrãs de entrada e de bloqueio, nunca no
   * cabeçalho do POS: no cabeçalho seria um botão ao lado do "Pedidos" que
   * desliga o terminal a meio de um serviço. Aqui é preciso parar primeiro e
   * ainda confirmar.
   */
  const terminalFooter = (
    <div className="space-y-3">
      <a
        href="/login?next=/pos"
        className="pos-btn pos-btn--quiet !min-h-14 w-full !text-sm"
      >
        Entrar por email · criar o meu PIN
      </a>
      {!unbindConfirm ? (
        <button
          type="button"
          onClick={() => setUnbindConfirm(true)}
          className="pos-btn pos-btn--quiet !min-h-14 w-full !text-sm"
        >
          Sair · desvincular este PC
        </button>
      ) : (
        <div className="pos-note pos-note--danger !p-4">
          <p className="text-sm font-semibold">
            Desvincular este PC de <strong>{context?.storeName ?? 'esta loja'}</strong>?
          </p>
          <p className="mt-1 text-xs font-normal text-ink-dim">
            O terminal volta ao ecrã de registo e será preciso escolher a loja
            e o token do bridge outra vez. As vendas já feitas não se perdem.
          </p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={() => setUnbindConfirm(false)}
              className="pos-btn !min-h-14 flex-1"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={unbindDevice}
              className="pos-btn pos-btn--danger-solid !min-h-14 flex-1"
            >
              Desvincular
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // Versão nova publicada → o POS recarrega-se sozinho no primeiro momento em
  // que não estraga nada (lib/pos/app-update.ts). O quiosque nunca é
  // recarregado à mão, e sem isto cada melhoria só chegava ao balcão depois de
  // alguém fechar e abrir o programa.
  const [versaoNova, setVersaoNova] = useState(false);
  useEffect(() => {
    const verificar = async () => {
      if (isNewBuild(CURRENT_BUILD, await fetchLatestBuild())) setVersaoNova(true);
    };
    void verificar();
    const timer = window.setInterval(() => void verificar(), VERSION_CHECK_MS);
    return () => window.clearInterval(timer);
  }, []);
  const ocupado =
    paying ||
    funnel.length > 0 ||
    !!confirmation ||
    !!keyboardField ||
    !!variantPick ||
    !!noteLine ||
    !!cartPicker ||
    boardOpen ||
    availabilityOpen ||
    voidOpen ||
    unbindConfirm;
  useEffect(() => {
    if (!versaoNova) return;
    if (!canReloadNow({ cartEmpty: lines.length === 0, busy: ocupado, online })) return;
    // Travão: nunca mais de um recarregar automático em 10 min (sem ciclos).
    let storage: Storage | null = null;
    try {
      storage = window.sessionStorage;
    } catch {
      storage = null;
    }
    if (!reloadAllowed(storage)) return;
    markReload(storage);
    window.location.reload();
  }, [versaoNova, lines.length, ocupado, online]);

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center">
        <p className="flex items-center gap-3 text-lg font-semibold text-ink-dim">
          <span className="h-2 w-2 animate-pulse rounded-full bg-gold" />
          A preparar o POS…
        </p>
      </main>
    );
  }

  if (cardLoginDeviceId) {
    return (
      <PosLogin
        deviceId={cardLoginDeviceId}
        onAuthenticated={handleAuthenticated}
        footer={terminalFooter}
      />
    );
  }

  if (!context) {
    if (availableStores.length > 0) {
      return (
        <main className="grid min-h-screen place-items-center p-6">
          <section className="pos-sheet w-full max-w-xl !p-8">
            <p className="pos-eyebrow !text-gold">CONFIGURAÇÃO INICIAL</p>
            <h1 className="pos-title mt-2 !text-3xl">Vincular este PC</h1>
            <p className="mt-2 text-sm text-ink-dim">
              Esta acção é feita uma vez por um gerente ou pelo dono e fica auditada.
            </p>
            <label className="mt-6 block text-sm font-semibold text-ink-dim" htmlFor="pos-store">
              Loja
            </label>
            {/* Cards em vez de um dropdown: e um ecra tactil, e escolher a
                loja e a decisao que estraga tudo se sair errada. Um alvo
                grande e um estado seleccionado bem visivel valem mais aqui
                do que a poupanca de espaco de uma lista (§7.6). */}
            <div className="mt-2 grid grid-cols-2 gap-3">
              {availableStores.map((store) => {
                const escolhida = selectedStoreId === store.id;
                return (
                  <button
                    key={store.id}
                    type="button"
                    onClick={() => setSelectedStoreId(store.id)}
                    aria-pressed={escolhida}
                    className="pos-choice !min-h-24 !flex-col !gap-1 !text-xl"
                  >
                    {store.short_name}
                    {escolhida && <span className="block text-xs font-semibold">seleccionada</span>}
                  </button>
                );
              })}
            </div>
            {!selectedStoreId && (
              <p className="pos-note pos-note--warn mt-3 !text-sm !font-normal">
                Escolhe a loja onde <strong>este computador</strong> está.
                Se escolheres a errada, as vendas caem na outra loja e não sai
                papel nenhum aqui.
              </p>
            )}
            <label className="mt-4 block text-sm font-semibold text-ink-dim" htmlFor="pos-label">
              Nome do terminal
            </label>
            <input
              id="pos-label"
              value={deviceLabel}
              onChange={(event) => setDeviceLabel(event.target.value)}
              maxLength={80}
              className="pos-well mt-2 !min-h-16 w-full !px-4 !font-semibold outline-none focus:shadow-[inset_0_0_0_1.5px_var(--gold)]"
            />
            <label className="mt-4 block text-sm font-semibold text-ink-dim" htmlFor="bridge-url">
              Endereço local do bridge
            </label>
            <input
              id="bridge-url"
              value={bridgeUrl}
              onChange={(event) => setBridgeUrl(event.target.value)}
              className="pos-well mt-2 !min-h-16 w-full !px-4 !font-mono !text-sm outline-none focus:shadow-[inset_0_0_0_1.5px_var(--gold)]"
            />
            <label className="mt-4 block text-sm font-semibold text-ink-dim" htmlFor="bridge-token">
              Token local do bridge
            </label>
            <input
              id="bridge-token"
              type="password"
              value={bridgeToken}
              onChange={(event) => setBridgeToken(event.target.value)}
              autoComplete="off"
              className="pos-well mt-2 !min-h-16 w-full !px-4 !font-mono outline-none focus:shadow-[inset_0_0_0_1.5px_var(--gold)]"
            />
            {error && <p role="alert" className="pos-note pos-note--danger mt-4">{error}</p>}
            <button
              type="button"
              disabled={
                binding
                || !selectedStoreId
                || deviceLabel.trim().length < 3
                || bridgeToken.trim().length < 32
              }
              onClick={() => void bindDevice()}
              className="pos-btn pos-btn--primary mt-6 w-full"
            >
              {binding ? 'A vincular…' : 'Vincular POS'}
            </button>
          </section>
        </main>
      );
    }

    return (
      <main className="grid min-h-screen place-items-center p-8">
        <section className="pos-sheet max-w-lg !p-8 !text-center">
          <h1 className="pos-title">POS indisponível</h1>
          <p className="pos-note pos-note--danger mt-4 !font-normal">{error}</p>
          <button
            type="button"
            onClick={() => void loadPos()}
            className="pos-btn pos-btn--primary mt-6 w-full"
          >
            Tentar novamente
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen lg:h-screen lg:overflow-hidden">
      <header className="flex min-h-[3.75rem] items-center gap-2 border-b border-white/[0.07] bg-bg1 px-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <span className="truncate font-display text-[1.4rem] leading-none tracking-[0.04em] text-gold">
              {brand.name}
            </span>
            <span className="rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[0.625rem] font-bold tracking-[0.16em] text-ink-dim">
              POS
            </span>
          </p>
          <p className="mt-1 truncate text-xs font-medium text-ink-mute">
            {context.storeName} · {context.deviceLabel}
          </p>
        </div>
        {/* O browser tem o som suspenso: o pedido chega, o botão pisca e ninguém
            ouve. Um toque aqui liga o som e dá um toque de teste — é também
            como se confirma que as colunas do PC estão ligadas e com volume. */}
        {posSettings.alerts.newOrderChime && alerta.somBloqueado && (
          <button
            type="button"
            onClick={() => {
              prepararSom();
              tocarAlarme();
            }}
            className="pos-btn pos-alarm !min-h-12 shrink-0 !rounded-[14px] !px-4 !text-[0.9375rem]"
          >
            🔇 Som dos pedidos desligado — tocar para ligar
          </button>
        )}
        {/* O caixa gere as entregas sem sair do terminal. E daqui que se ve
            o que ja foi pago e ainda nao saiu pela porta. */}
        {/* Um pedido da internet faz-se ver daqui: pisca enquanto houver algum
            por aprovar ou por ver, com o número no crachá. */}
        <button
          type="button"
          onClick={() => setBoardOpen(true)}
          aria-label={alerta.piscar ? `Pedidos — ${alerta.aAtender} à espera` : 'Pedidos'}
          className={`pos-btn relative !min-h-12 shrink-0 !rounded-[14px] !px-4 !text-[0.9375rem] ${alerta.piscar ? 'pos-alarm' : ''}`}
        >
          <PosIcon name="inbox" />
          Pedidos
          {alerta.piscar && (
            <span className="pos-qty pos-num absolute -right-2.5 -top-2.5 !h-8 !min-w-8 !text-sm">
              {alerta.aAtender}
            </span>
          )}
        </button>
        {/* "Acabou o Double" — tira o produto do site e do balcão num toque. */}
        <button
          type="button"
          onClick={() => setAvailabilityOpen(true)}
          className="pos-btn !min-h-12 shrink-0 !rounded-[14px] !px-4 !text-[0.9375rem]"
        >
          <PosIcon name="ban" />
          Esgotados
        </button>
        {lastSale && (
          <>
            <span aria-hidden className="mx-1 h-8 w-px shrink-0 bg-white/10" />
            <button
              type="button"
              disabled={reprintPending}
              onClick={() => void reprintLastReceipt()}
              className="pos-btn pos-btn--accent-outline !min-h-12 shrink-0 !rounded-[14px] !px-3.5 !text-sm"
            >
              <PosIcon name="printer" size={18} />
              {reprintPending ? 'A reimprimir…' : `Reimprimir talão #${lastSale.dailyNumber}`}
            </button>
            <button
              type="button"
              onClick={() => setVoidOpen(true)}
              className="pos-btn pos-btn--danger !min-h-12 shrink-0 !rounded-[14px] !px-3.5 !text-sm"
            >
              <PosIcon name="undo" size={18} />
              Anular #{lastSale.dailyNumber}
            </button>
          </>
        )}
        <span aria-hidden className="mx-1 h-8 w-px shrink-0 bg-white/10" />
        <button
          type="button"
          onClick={() => void lockDevice()}
          className="pos-btn pos-btn--quiet !min-h-12 shrink-0 !rounded-[14px] !px-3.5 !text-sm"
        >
          <PosIcon name="lock" size={18} />
          Bloquear · trocar
        </button>
        <div
          role="status"
          data-tone={networkStatus.tone === 'offline' ? 'offline' : 'online'}
          className="pos-status shrink-0"
        >
          {reprintFeedback ?? networkStatus.label}
        </div>
      </header>

      <div className="grid lg:h-[calc(100vh-3.75rem)] lg:grid-cols-[9.5rem_minmax(0,1fr)_24rem]">
        <nav className="flex gap-1.5 overflow-x-auto border-b border-white/[0.07] bg-bg1 p-2 lg:flex-col lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-2.5">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              aria-current={posView === 'menu' && activeCategory === category.id ? 'true' : undefined}
              onClick={() => {
                setPosView('menu');
                setActiveCategory(category.id);
              }}
              className="pos-rail-item min-w-28 shrink-0 lg:min-w-0"
            >
              {category.name}
            </button>
          ))}
          {/* O cashier fecha vendas no balcão, mas também precisa de ver o
              que está a sair pela loja online — sem sair do POS nem
              depender de acesso ao painel admin, que o perfil não tem. */}
          <span aria-hidden className="mx-2 my-1.5 hidden h-px shrink-0 bg-white/[0.07] lg:block" />
          <button
            type="button"
            aria-current={posView === 'delivery' ? 'true' : undefined}
            onClick={() => setPosView('delivery')}
            className="pos-rail-item min-w-28 shrink-0 !gap-2 lg:min-w-0"
          >
            <PosIcon name="truck" size={18} className="shrink-0 opacity-80" />
            Delivery
          </button>
          {/* A senha que a cozinha pôs no balcão vai daqui para a TV. */}
          <button
            type="button"
            aria-current={posView === 'senhas' ? 'true' : undefined}
            onClick={() => setPosView('senhas')}
            className="pos-rail-item min-w-28 shrink-0 !gap-2 lg:min-w-0"
          >
            <PosIcon name="ticket" size={18} className="shrink-0 opacity-80" />
            Senhas
          </button>
        </nav>

        <section className="overflow-y-auto p-2.5 lg:p-3">
          {posView === 'senhas' ? (
            <SenhasTab
              storeId={context.storeId}
              storeName={context.storeName}
              keyboardActive={!ocupado && !locked}
            />
          ) : posView === 'delivery' ? (
            <OnlineOrdersTab
              storeName={context.storeName}
              orders={deliveryOrders}
              loading={deliveryLoading}
              error={deliveryError}
              zones={channels.zones}
              closesAt={channels.closesAt}
              onRefresh={() => void fetchDeliveryOrders()}
            />
          ) : (
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {visibleItems.map((item) => {
              const availability = posItemAvailability(item);
              const qty = qtyOfItem(cart, item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!availability.sellable}
                  onClick={() => tapItem(item)}
                  data-in-cart={qty ? 'true' : undefined}
                  className="pos-product"
                >
                  <span className="pos-product__media aspect-[4/3]">
                    {item.photo_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.photo_url}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        // object-contain nas bebidas: latas e garrafas são altas
                        // e o cover cortava-lhes o rótulo. O cartão continua do
                        // mesmo tamanho dos lanches — só a foto encolhe para
                        // caber inteira lá dentro.
                        className={
                          isDrinksCategory
                            ? 'h-full w-full object-contain p-3 drop-shadow-[0_10px_14px_rgba(0,0,0,.45)]'
                            : 'h-full w-full object-cover'
                        }
                      />
                    )}
                    {availability.badge && (
                      <span
                        className={`pos-tag absolute left-2.5 top-2.5 ${
                          availability.sellable ? '' : 'pos-tag--danger'
                        }`}
                      >
                        {availability.badge}
                      </span>
                    )}
                    {qty && (
                      <span className="pos-qty absolute right-2 top-2">
                        {qty}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-1 flex-col justify-between gap-1 px-3 pb-2.5 pt-2">
                    <span className="block text-[0.8125rem] font-semibold leading-snug text-ink">
                      {item.name}
                    </span>
                    <span className="pos-num block text-base font-bold text-gold">
                      {mt(item.price_cents)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          )}
        </section>

        {/* Se num ecrã baixo nem assim couber, o painel inteiro rola — nunca
            corta o botão PAGAR nem um campo por preencher. */}
        <aside className="flex min-h-[36rem] flex-col border-t border-white/[0.07] bg-bg1 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <div className="shrink-0 space-y-2 border-b border-white/[0.07] p-2.5">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-base font-bold tracking-tight">Carrinho</h2>
              <span className="pos-num rounded-full bg-white/[0.06] px-2 py-0.5 text-[0.6875rem] font-semibold text-ink-dim">
                {count} artigos
              </span>
            </div>

            {/* Tipo de pedido. Só aparecem os canais que a loja tem ligados —
                oferecer entrega numa loja sem entrega é prometer o que não se
                cumpre. Offline fica só o balcão (CLAUDE §7.5).
                Escolher Levantamento ou Entrega abre os dados do cliente, que
                é o que esse pedido pede a seguir; tocar outra vez no mesmo
                tipo abre ou fecha os dados. */}
            <div className="pos-seg">
              {(['counter', 'pickup', 'delivery'] as FulfillmentType[]).map((tipo) => {
                if (!canalPermitido(tipo)) return null;
                return (
                  <button
                    key={tipo}
                    type="button"
                    aria-pressed={fulfillment === tipo}
                    onClick={() => {
                      if (fulfillment === tipo) {
                        setCustomerOpen((aberto) => !aberto);
                        return;
                      }
                      setFulfillment(tipo);
                      setCustomerOpen(tipo !== 'counter');
                    }}
                    className="flex-col !gap-0.5 !text-[0.75rem]"
                  >
                    <PosIcon name={FULFILLMENT_ICONS[tipo]} size={16} />
                    {FULFILLMENT_LABELS[tipo]}
                  </button>
                );
              })}
            </div>

            {(() => {
              const zona = channels.zones.find((z) => z.id === zoneId);
              const pedeCliente = fulfillment !== 'counter' || posSettings.cart.askCustomerOnCounter;
              const faltam =
                fulfillment === 'counter'
                  ? []
                  : [
                      !customerName.trim() && 'nome',
                      !customerPhone.trim() && 'telefone',
                      fulfillment === 'delivery' && !customerAddress.trim() && 'morada',
                      fulfillment === 'delivery' && !zona && 'zona',
                    ].filter((campo): campo is string => Boolean(campo));
              const resumo = [
                customerName.trim(),
                customerPhone.trim(),
                fulfillment === 'delivery' ? customerAddress.trim() : '',
                fulfillment === 'delivery' && zona ? zona.name : '',
                fulfillment !== 'counter' ? formatSlot(scheduledFor || null) : '',
                orderNote.trim() ? `Nota: ${orderNote.trim()}` : '',
              ]
                .filter(Boolean)
                .join(' · ');
              const titulo =
                fulfillment === 'counter'
                  ? pedeCliente
                    ? 'Cliente e nota'
                    : 'Nota do pedido'
                  : `Dados · ${FULFILLMENT_LABELS[fulfillment]}`;

              if (!customerOpen) {
                // Fechados, os dados são uma barra: diz o que já se sabe e, a
                // âmbar, o que ainda falta para a entrega sair bem.
                return (
                  <button
                    type="button"
                    onClick={() => setCustomerOpen(true)}
                    data-warn={faltam.length > 0}
                    className="pos-field !min-h-12 w-full"
                  >
                    <PosIcon
                      name={pedeCliente ? 'user' : 'pencil'}
                      size={16}
                      className={`shrink-0 ${faltam.length > 0 ? 'text-amber-300' : 'text-ink-mute'}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={`pos-eyebrow !block truncate ${faltam.length > 0 ? '!text-amber-300/80' : ''}`}>
                        {faltam.length > 0 ? `Faltam: ${faltam.join(', ')}` : titulo}
                      </span>
                      <span
                        className={`block truncate text-[0.8125rem] ${
                          resumo ? 'font-semibold text-ink' : 'font-medium text-ink-mute'
                        }`}
                      >
                        {resumo || (pedeCliente ? 'Toca para anotar' : '+ Nota do pedido')}
                      </span>
                    </span>
                    <PosIcon name="chevronDown" size={16} className="shrink-0 text-ink-mute" />
                  </button>
                );
              }

              return (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 pl-1">
                    <span className="pos-eyebrow">{titulo}</span>
                    <button
                      type="button"
                      onClick={() => setCustomerOpen(false)}
                      className="pos-btn !min-h-10 !gap-1 !rounded-xl !px-3 !text-[0.8125rem]"
                    >
                      <PosIcon name="chevronUp" size={16} />
                      Fechar
                    </button>
                  </div>

                  {/* Os dados do pedido em barras compactas: cada uma diz o que é
                      e o que já tem, e tocar abre o sítio de a preencher (teclado
                      do POS ou selector grande). Nome e telefone aparecem em
                      qualquer venda, não só entrega: é o que deixa reconhecer
                      quem compra ao balcão também. */}
                  <div className="grid grid-cols-2 gap-1.5">
                    {/* A loja pode dispensar nome e telefone no balcão (aba POS). */}
                    {pedeCliente && (
                      <>
                        <CartField
                          label="Nome"
                          value={customerName.trim()}
                          placeholder="Nome do cliente"
                          warn={fulfillment !== 'counter'}
                          onClick={() => setKeyboardField('name')}
                        />
                        <CartField
                          label={
                            customerLookup
                              ? customerLookup.orders_count > 0
                                ? `Telefone · 👋 ${customerLookup.orders_count} pedidos`
                                : 'Telefone · 🆕 novo'
                              : 'Telefone'
                          }
                          value={customerPhone.trim()}
                          placeholder={fulfillment === 'counter' ? 'Opcional' : 'Telefone'}
                          warn={fulfillment !== 'counter'}
                          onClick={() => setKeyboardField('phone')}
                        />
                      </>
                    )}
                    {fulfillment === 'delivery' && (
                      <CartField
                        className="col-span-2"
                        label="Morada"
                        value={customerAddress.trim()}
                        placeholder="Sem isto o entregador liga"
                        warn
                        onClick={() => setKeyboardField('address')}
                      />
                    )}
                    {fulfillment !== 'counter' && (
                      <CartField
                        className={fulfillment === 'delivery' ? '' : 'col-span-2'}
                        label="Horário"
                        value={formatSlot(scheduledFor || null)}
                        placeholder="Agora"
                        onClick={() => setCartPicker('schedule')}
                      />
                    )}
                    {fulfillment === 'delivery' && (
                      <CartField
                        label="Zona"
                        value={zona ? `${zona.name} · ${mt(zona.fee_cents)}` : ''}
                        placeholder="Escolher zona"
                        warn
                        onClick={() => setCartPicker('zone')}
                      />
                    )}
                    <CartField
                      className="col-span-2"
                      label="Observações"
                      value={orderNote.trim()}
                      placeholder="+ Nota do pedido"
                      onClick={() => setKeyboardField('orderNote')}
                    />
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="min-h-[8rem] flex-1 overflow-y-auto px-2.5">
            {lines.length === 0 ? (
              <div className="grid h-full min-h-28 place-items-center text-center">
                <div>
                  <PosIcon name="bag" size={26} strokeWidth={1.5} className="mx-auto text-ink-mute opacity-60" />
                  <p className="mt-2 text-sm text-ink-mute">Toca num produto para começar.</p>
                </div>
              </div>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {lines.map((line) => (
                  <li key={line.id} className="flex items-center gap-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[0.8125rem] font-semibold leading-tight">{line.name}</h3>
                      <div className="mt-1 flex min-w-0 items-center gap-1.5">
                        <span className="pos-num shrink-0 text-[0.8125rem] font-bold text-gold">
                          {mt(line.price_cents * line.qty)}
                        </span>
                        {/* "SEM JALAPENO" é meio balcão. Sai na comanda da
                            cozinha e no talão, e faz da linha uma linha própria:
                            um sem jalapeño e um normal não são `2x Classic`. */}
                        <button
                          type="button"
                          onClick={() => {
                            setNoteDraft(line.notes ?? '');
                            setNoteLine(line);
                          }}
                          className={`pos-press inline-flex min-h-8 min-w-0 items-center gap-1 rounded-lg px-2 text-left text-[0.625rem] font-bold uppercase tracking-wide ${
                            line.notes
                              ? 'bg-[color:var(--pos-accent-soft)] text-gold'
                              : 'bg-white/[0.05] text-ink-mute'
                          }`}
                        >
                          <PosIcon name="pencil" size={11} className="shrink-0" />
                          <span className="truncate">{line.notes ?? '+ sem / nota'}</span>
                        </button>
                      </div>
                    </div>
                    <div className="pos-well !flex shrink-0 !items-center !rounded-xl !p-0.5">
                      <button
                        type="button"
                        onClick={() => changeLineQty(line, -1)}
                        className="pos-press grid h-12 w-11 place-items-center rounded-[10px] active:bg-white/10"
                        aria-label={`Retirar ${line.name}`}
                      >
                        <PosIcon name="minus" size={18} />
                      </button>
                      <span className="pos-num min-w-7 text-center text-base font-bold">{line.qty}</span>
                      <button
                        type="button"
                        onClick={() => changeLineQty(line, 1)}
                        className="pos-press grid h-12 w-11 place-items-center rounded-[10px] active:bg-white/10"
                        aria-label={`Adicionar ${line.name}`}
                      >
                        <PosIcon name="plus" size={18} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* O total vive no próprio botão: é o número que se diz ao cliente
              no momento em que se carrega nele, e poupa uma linha ao carrinho. */}
          <div className="shrink-0 border-t border-white/[0.07] p-2.5">
            {deliveryFeeCents > 0 && (
              <p className="mb-1.5 flex items-baseline justify-between px-1 text-xs font-medium text-ink-mute">
                <span>Inclui entrega</span>
                <span className="pos-num">{mt(deliveryFeeCents)}</span>
              </p>
            )}
            <button
              type="button"
              disabled={lines.length === 0}
              onClick={startCheckout}
              className="pos-btn pos-btn--primary w-full !min-h-16 !justify-between !rounded-[18px] !px-5"
            >
              <span className="text-xl tracking-[0.06em]">PAGAR</span>{' '}
              <span className="pos-num text-2xl">{mt(totalCents)}</span>
            </button>
          </div>
        </aside>
      </div>

      {/* Selector de variante.
          O Classic Smash não tem um preço: HAW são 300 e WAGYU são 400. Até
          aqui o balcão não perguntava e o WAGYU simplesmente não se vendia,
          enquanto o servidor (migration 1018) já o sabia cobrar. Aparece só
          quando há mesmo escolha — um toque a mais em cada batata frita seriam
          segundos que ao balcão não existem. */}
      {boardOpen && (
        <OrdersBoard
          storeId={context.storeId}
          zones={channels.zones}
          closesAt={channels.closesAt}
          onClose={() => setBoardOpen(false)}
        />
      )}
      {availabilityOpen && (
        <AvailabilityPanel
          storeId={context.storeId}
          storeSlug={context.storeSlug}
          onClose={() => {
            setAvailabilityOpen(false);
            // O balcão tem de ficar a cinzento já, sem esperar pelo realtime.
            void refreshMenu();
          }}
        />
      )}

      {/* Horário e zona: um toque na barra abre a escolha em alvos grandes,
          em vez de uma fila a rolar de lado e de um <select> nativo que num
          ecrã táctil abre pequeno. Escolher fecha logo. */}
      {cartPicker && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <div aria-hidden className="pos-scrim" onClick={() => setCartPicker(null)} />
          <div className="pos-sheet relative !flex max-h-full w-full max-w-2xl !flex-col !p-6">
            <p className="pos-eyebrow">
              {cartPicker === 'schedule' ? 'PARA QUANDO?' : 'PARA ONDE?'}
            </p>
            <h2 className="pos-title mb-5 mt-1">
              {cartPicker === 'schedule' ? 'Horário' : 'Zona de entrega'}
            </h2>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {cartPicker === 'schedule' ? (
                // Janelas de 30 minutos até ao fecho da loja: a hora vem do
                // horário dela, por isso nunca se promete uma hora a que já não
                // há ninguém.
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {[
                    { value: '', label: 'Agora' },
                    ...buildPickupSlots({ now: new Date(), closesAt: channels.closesAt }),
                  ].map((slot) => (
                    <button
                      key={slot.value || 'agora'}
                      type="button"
                      aria-pressed={scheduledFor === slot.value}
                      onClick={() => {
                        setScheduledFor(slot.value);
                        setCartPicker(null);
                      }}
                      className="pos-choice pos-num !text-xl !text-ink aria-pressed:!text-[color:var(--pos-on-accent)]"
                    >
                      {slot.label}
                    </button>
                  ))}
                </div>
              ) : channels.zones.length === 0 ? (
                <p className="pos-note pos-note--warn">
                  Esta loja ainda não tem zonas de entrega configuradas no painel.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {channels.zones.map((zona) => (
                    <button
                      key={zona.id}
                      type="button"
                      aria-pressed={zoneId === zona.id}
                      onClick={() => {
                        setZoneId(zona.id);
                        setCartPicker(null);
                      }}
                      className="pos-choice !justify-between !px-4 !text-left !text-ink aria-pressed:!text-[color:var(--pos-on-accent)]"
                    >
                      <span className="text-lg font-semibold">{zona.name}</span>
                      <span className="pos-num shrink-0 text-lg font-bold">{mt(zona.fee_cents)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setCartPicker(null)}
              className="pos-btn mt-5 w-full shrink-0 !text-lg"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {variantPick && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <div aria-hidden className="pos-scrim" onClick={() => setVariantPick(null)} />
          <div className="pos-sheet relative w-full max-w-2xl !p-6">
            <p className="pos-eyebrow">QUAL?</p>
            <h2 className="pos-title mb-5 mt-1">{variantPick.name}</h2>

            <div className="grid gap-3 sm:grid-cols-2">
              {(variantPick.variants ?? []).map((variante) => (
                <button
                  key={variante.id}
                  type="button"
                  onClick={() => {
                    changeQty(variantPick, 1, variante);
                    setVariantPick(null);
                  }}
                  className="pos-press flex min-h-24 items-center justify-between gap-3 rounded-[20px] bg-bg2 px-6 text-left shadow-[inset_0_0_0_1px_var(--pos-hair-strong)] active:bg-bg3"
                >
                  <span className="text-2xl font-bold tracking-tight text-ink">{variante.name}</span>
                  <span className="pos-num shrink-0 text-2xl font-bold text-gold">
                    {mt(variante.price_cents)}
                  </span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setVariantPick(null)}
              className="pos-btn mt-5 w-full !text-lg"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {funnelStep && (
        <div className="pos-screen fixed inset-0 z-40 flex flex-col">
          <header className="shrink-0 border-b border-white/[0.07] bg-bg1 px-6 pb-4 pt-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <p className="pos-eyebrow shrink-0">
                    PASSO {funnelIndex + 1} DE {funnel.length}
                  </p>
                  <div aria-hidden className="pos-steps max-w-40 flex-1">
                    {funnel.map((passo, indice) => (
                      <span key={passo.kind + indice} data-done={indice <= funnelIndex} />
                    ))}
                  </div>
                </div>
                <h2 className="pos-title mt-1.5 !text-3xl">{funnelStep.title}</h2>
              </div>
              {/* O funil é obrigatório, o caminho de volta não pode ser. Quem
                  precisa de mexer no que já estava no carrinho vai lá, corrige,
                  e volta a passar pela oferta — não fica preso a olhar para ela. */}
              <button
                type="button"
                onClick={cancelFunnel}
                className="pos-btn pos-btn--quiet shrink-0"
              >
                ← Carrinho
              </button>
            </div>
            {/* A frase existe para ser dita em voz alta. É o que separa um balcão
                que oferece de um que não oferece — e quem tem fila à frente não
                inventa uma boa pergunta de cada vez. As frases são da loja (aba
                POS); um passo sem frases continua a oferecer, só não sugere. */}
            {funnelStep.script && (
              <p className="mt-3 flex items-start gap-3 rounded-2xl bg-[color:var(--pos-accent-soft)] px-5 py-3 text-xl font-semibold text-gold shadow-[inset_3px_0_0_var(--gold)]">
                <span className="italic">“{funnelStep.script}”</span>
              </p>
            )}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="mx-auto flex w-full max-w-5xl flex-wrap justify-center gap-3">
              {funnelStep.items.map((item) => {
                const posItem = item as (typeof visibleItems)[number];
                const qty = qtyOfItem(cart, item.id);
                return (
                  <div
                    key={item.id}
                    data-in-cart={qty > 0 ? 'true' : undefined}
                    className="pos-product w-60 active:!transform-none"
                  >
                    <button
                      type="button"
                      onClick={() => tapItem(posItem)}
                      className="pos-press flex flex-1 flex-col text-left"
                    >
                      <span className="pos-product__media aspect-[3/2]">
                        {item.photo_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.photo_url}
                            alt=""
                            loading="lazy"
                            draggable={false}
                            // object-contain e nao object-cover: as latas e garrafas
                            // sao altas e o cover cortava-lhes o rotulo — ficavam
                            // sete rectangulos vermelhos indistinguiveis.
                            className="h-full w-full object-contain p-2 drop-shadow-[0_10px_14px_rgba(0,0,0,.45)]"
                          />
                        )}
                        {qty > 0 && (
                          <span className="pos-qty absolute right-2 top-2">
                            {qty}
                          </span>
                        )}
                      </span>
                      <span className="flex flex-1 flex-col justify-between gap-1 px-3 pb-2.5 pt-2">
                        <span className="block text-[0.8125rem] font-semibold leading-snug text-ink">{item.name}</span>
                        <span className="pos-num block text-base font-bold text-gold">
                          {mt(item.price_cents)}
                        </span>
                      </span>
                    </button>

                    {/* Tocar sem querer num ecrã touch é normal; ficar preso ao
                        engano não é. Até aqui o item só saía voltando ao carrinho
                        — que daqui nem se via. Tirar tem de estar onde se pôs. */}
                    {qty > 0 && (
                      <div className="flex items-stretch border-t border-white/[0.07] bg-black/25">
                        <button
                          type="button"
                          aria-label={`Tirar um ${item.name}`}
                          onClick={() => setCart((atual) => removeOneOfItem(atual, posItem.id))}
                          className="grid min-h-16 flex-1 place-items-center text-red-300 active:bg-red-500/15"
                        >
                          <PosIcon name="minus" size={24} />
                        </button>
                        <span className="pos-num grid min-h-16 w-14 place-items-center text-2xl font-bold">
                          {qty}
                        </span>
                        <button
                          type="button"
                          aria-label={`Juntar um ${item.name}`}
                          onClick={() => tapItem(posItem)}
                          className="grid min-h-16 flex-1 place-items-center text-gold active:bg-white/10"
                        >
                          <PosIcon name="plus" size={24} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <footer className="shrink-0 border-t border-white/[0.07] bg-bg1 p-4">
            <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
              {/* Saltar tem de ser fácil: o que se força é a oferta, não a compra.
                  Um cliente que diz que não é um toque, não uma negociação. */}
              <button
                type="button"
                onClick={advanceFunnel}
                className="pos-btn pos-btn--lg flex-1"
              >
                Não quis
              </button>
              <div className="hidden shrink-0 px-4 text-right sm:block">
                <p className="pos-eyebrow">TOTAL</p>
                <p className="pos-num mt-0.5 text-2xl font-extrabold">{mt(totalCents)}</p>
              </div>
              <button
                type="button"
                onClick={advanceFunnel}
                className="pos-btn pos-btn--primary pos-btn--lg flex-1"
              >
                {funnelIndex + 1 < funnel.length ? 'Continuar →' : 'Ir pagar →'}
              </button>
            </div>
          </footer>
        </div>
      )}

      {paying && (
        <div className="pos-screen fixed inset-0 z-40 flex flex-col">
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/[0.07] bg-bg1 px-6 py-4">
            <div>
              <p className="pos-eyebrow">TOTAL A PAGAR</p>
              <p className="pos-num mt-1 text-5xl font-extrabold leading-none text-gold">{mt(totalCents)}</p>
            </div>
            <button
              type="button"
              onClick={() => setPaying(false)}
              className="pos-btn pos-btn--quiet shrink-0 !text-lg"
            >
              ← Voltar ao carrinho
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <div className="mx-auto grid w-full max-w-5xl gap-5 lg:grid-cols-2">
              <div className="space-y-3">
                {/* O que se está a cobrar, à vista de quem cobra. Sem isto o
                    ecrã pede um valor sem dizer de quê, e conferir obrigava a
                    voltar ao carrinho — e a repetir o funil de oferta. */}
                <div className="pos-card !p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="pos-eyebrow">
                      RESUMO · {count} {count === 1 ? 'ARTIGO' : 'ARTIGOS'}
                    </p>
                    {fulfillment !== 'counter' && (
                      <p className="pos-eyebrow !text-gold">
                        {FULFILLMENT_LABELS[fulfillment].toUpperCase()}
                        {customerName.trim() ? ` · ${customerName.trim()}` : ''}
                      </p>
                    )}
                  </div>
                  <ul className="mt-3 max-h-52 space-y-1.5 overflow-y-auto">
                    {lines.map((line) => (
                      <li
                        key={line.id}
                        className="flex items-baseline justify-between gap-3 text-[0.9375rem] font-medium"
                      >
                        <span className="min-w-0">
                          <span className="pos-num font-bold text-gold">{line.qty}×</span> {line.name}
                        </span>
                        <span className="pos-num shrink-0 text-ink-dim">
                          {mt(line.price_cents * line.qty)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {deliveryFeeCents > 0 && (
                    <p className="mt-3 flex items-baseline justify-between gap-3 border-t border-white/[0.07] pt-3 text-[0.9375rem] font-medium text-ink-dim">
                      <span>Taxa de entrega</span>
                      <span className="pos-num">{mt(deliveryFeeCents)}</span>
                    </p>
                  )}
                  <p className="mt-3 flex items-baseline justify-between border-t border-white/[0.07] pt-3 text-lg font-bold">
                    <span>TOTAL</span>
                    <span className="pos-num text-gold">{mt(totalCents)}</span>
                  </p>
                </div>

                {/* Misto só faz sentido com dois meios ligados e com a loja a
                    deixar dividir a conta (aba POS). */}
                {mixedAvailable && (
                <label className="pos-card !flex !min-h-16 cursor-pointer !items-center !justify-between !px-4 !text-base !font-semibold">
                  Pagamento misto
                  <input
                    type="checkbox"
                    checked={mixed}
                    onChange={(event) => setMixedMode(event.target.checked)}
                    className="pos-switch"
                  />
                </label>
                )}

                <div className="grid grid-cols-2 gap-3">
                  {payMethods.map((method) => {
                    const selected = methods.includes(method.id);
                    return (
                      <button
                        key={method.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => selectMethod(method.id)}
                        className="pos-choice !min-h-20 !justify-start !gap-3 !px-5 !text-lg"
                      >
                        <PosIcon name={METHOD_ICONS[method.id]} size={22} className="shrink-0 opacity-90" />
                        <span className="min-w-0 text-left">
                          {method.label}
                          {mixed && selected && (
                            <span className="pos-num mt-0.5 block text-sm font-semibold opacity-80">
                              {mt(allocations[method.id] ?? 0)}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {mixed && (
                  <p
                    className={`pos-note !text-center ${
                      paymentPlan.complete ? 'pos-note--ok' : 'pos-note--warn'
                    }`}
                  >
                    {paymentPlan.complete
                      ? 'Pagamento completo'
                      : paymentPlan.remainingCents > 0
                        ? `Faltam ${mt(paymentPlan.remainingCents)}`
                        : methods.includes('cash')
                          ? 'Os meios digitais já passam do total — reduz a parcela'
                          : `Excede ${mt(Math.abs(paymentPlan.remainingCents))} — só o dinheiro dá troco`}
                  </p>
                )}

                {changeCents !== null && cashPaymentCents > 0 && (
                  <p className="pos-pop pos-num rounded-[20px] bg-[color:var(--pos-ok-soft)] py-5 text-center text-4xl font-extrabold text-emerald-300 shadow-[inset_0_0_0_1px_rgba(52,211,153,.3)]">
                    TROCO {mt(changeCents)}
                  </p>
                )}

                {/* Loja sem número configurado não pode fingir que tem um.
                    Melhor dizer o que falta do que mostrar um campo vazio. */}
                {mobileMethod && !mobileInstructions && (
                  <p className="pos-note pos-note--warn">
                    Esta loja ainda não tem número de{' '}
                    {mobileMethod === 'mpesa' ? 'M-Pesa' : 'e-Mola'} configurado. Cobra pelo número
                    do costume e avisa o gerente para o preencher em Lojas.
                  </p>
                )}

                {error && (
                  <p role="alert" className="pos-note pos-note--danger">
                    {error}
                  </p>
                )}
              </div>

              {(mixed || methods[0] === 'cash') && (
                <div className="pos-card !p-4">
                  {mixed && (
                    <div className="mb-3 flex gap-2 overflow-x-auto">
                      {methods.map((method) => (
                        <button
                          key={method}
                          type="button"
                          aria-pressed={keypadTarget === method}
                          onClick={() => setKeypadTarget(method)}
                          className="pos-choice !min-h-14 min-w-28 !flex-col !gap-0 !text-sm aria-pressed:!bg-ink aria-pressed:!text-bg0"
                        >
                          {payMethods.find((entry) => entry.id === method)?.label ?? method}
                          {method === 'cash' && <span className="block text-xs font-medium opacity-70">recebido</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Sem misto, o dinheiro recebido é o visor: um só número
                      grande, em vez de um botão e um visor a dizer o mesmo. */}
                  {!mixed && cashPaymentCents > 0 ? (
                    <button
                      type="button"
                      onClick={() => setKeypadTarget('cash_received')}
                      className="pos-well mb-3 !flex !min-h-20 w-full !items-center !justify-between !gap-3 !px-5 !text-left !shadow-[inset_0_0_0_1.5px_rgba(52,211,153,.5)]"
                    >
                      <span className="text-sm font-semibold text-emerald-200/80">Recebido:</span>{' '}
                      <span className="pos-num text-4xl font-extrabold">{mt(cashReceivedCents)}</span>
                    </button>
                  ) : (
                    <div className="pos-well mb-3 !flex !min-h-20 !items-center !justify-between !px-5">
                      <span className="text-sm font-semibold text-ink-mute">
                        {keypadTarget === 'cash_received' || keypadTarget === 'cash'
                          ? 'Valor recebido'
                          : 'Parcela'}
                      </span>
                      <strong className="pos-num text-4xl font-extrabold">{mt(targetValue())}</strong>
                    </div>
                  )}

                  {/* Valores rápidos: é o que a caixa recebe em nove de cada dez
                      vendas. Poupa três toques por venda e um erro de digitação
                      num campo onde o erro vira troco errado. */}
                  {(keypadTarget === 'cash_received' || keypadTarget === 'cash') && (
                    <div className="mb-3 grid grid-cols-4 gap-2">
                      {[50_000, 100_000, 200_000].map((valor) => (
                        <button
                          key={valor}
                          type="button"
                          onClick={() => setTargetValue(valor)}
                          className="pos-key !text-lg !font-bold"
                        >
                          {valor / 100}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={fillRemaining}
                        className="pos-key !bg-[color:var(--pos-ok-soft)] !text-base !font-bold !text-emerald-200"
                      >
                        Exacto
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => pressKey(key)}
                        className={`pos-key ${key === 'C' || key === '⌫' ? 'pos-key--muted' : ''}`}
                      >
                        {key}
                      </button>
                    ))}
                  </div>

                  {/* Em dinheiro o "Exacto" já está na fila rápida, por cima do
                      teclado. Este botão fica só para as parcelas do pagamento
                      misto — dois botões com a mesma função é um deles a mais. */}
                  {keypadTarget !== 'cash_received' && keypadTarget !== 'cash' && (
                    <button
                      type="button"
                      onClick={fillRemaining}
                      className="pos-btn mt-3 w-full"
                    >
                      Preencher restante
                    </button>
                  )}
                </div>
              )}

              {/* O número grande é para o cliente ver de longe e o operador ler
                  em voz alta sem o dizer de cor. Os passos são o guião de quem
                  paga por M-Pesa pela primeira vez — e são os mesmos que saem
                  no visor virado para ele. */}
              {mobileInstructions && (
                <div className="rounded-[20px] bg-[color:var(--pos-accent-soft)] p-5 shadow-[inset_0_0_0_1px_var(--pos-accent-line)]">
                  <p className="pos-eyebrow">
                    {mobileInstructions.label.toUpperCase()} · NÚMERO DA LOJA
                  </p>
                  <p className="pos-num mt-1 select-all text-5xl font-extrabold leading-tight text-gold">
                    {mobileInstructions.prettyNumber}
                  </p>
                  {mobileInstructions.holder && (
                    <p className="text-lg font-semibold text-ink-dim">{mobileInstructions.holder}</p>
                  )}
                  <p className="pos-well pos-num mt-4 !px-4 !py-3 !text-2xl !font-bold">
                    Enviar {mobileInstructions.amount}
                  </p>
                  <ol className="mt-4 space-y-2.5">
                    {mobileInstructions.steps.map((step, index) => (
                      <li key={step} className="flex gap-3 text-base font-medium text-ink-dim">
                        <span className="pos-num grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-bold text-ink">
                          {index + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                  <p className="mt-4 text-sm font-bold text-amber-300">
                    Só finalizar depois de ver a SMS de confirmação.
                  </p>
                </div>
              )}
            </div>
          </div>

          <footer className="shrink-0 border-t border-white/[0.07] bg-bg1 p-4">
            <button
              type="button"
              disabled={
                submitting ||
                lines.length === 0 ||
                !paymentPlan.complete ||
                (cashPaymentCents > 0 && changeCents === null)
              }
              onClick={() => void finalizeSale()}
              className="pos-btn pos-btn--primary pos-btn--lg mx-auto !flex w-full max-w-5xl !text-2xl !tracking-[0.03em]"
            >
              {submitting ? 'A registar…' : 'FINALIZAR VENDA'}
            </button>
          </footer>
        </div>
      )}
      {/* Teclado do POS. Um só componente serve nome, telefone, morada e nota:
          o PC de balcão não tem teclado físico e o Windows 10 em modo desktop
          não abre o de toque sozinho. */}
      {keyboardField && (
        <TouchKeyboard
          label={KEYBOARD_LABELS[keyboardField]}
          mode={keyboardField === 'phone' ? 'tel' : 'text'}
          value={
            keyboardField === 'name'
              ? customerName
              : keyboardField === 'phone'
                ? customerPhone
                : keyboardField === 'address'
                  ? customerAddress
                  : orderNote
          }
          suggestions={keyboardField === 'orderNote' ? quickNotes : []}
          onCancel={() => setKeyboardField(null)}
          onConfirm={(valor) => {
            if (keyboardField === 'name') setCustomerName(valor);
            else if (keyboardField === 'phone') setCustomerPhone(valor);
            else if (keyboardField === 'address') setCustomerAddress(valor);
            else setOrderNote(valor);
            setKeyboardField(null);
          }}
        />
      )}

      {/* "Sem jalapeño" — a nota do artigo, com os SEM de todos os dias a um
          toque. Escrever à mão fica para o que é fora do comum. */}
      {noteLine && (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4">
          <div aria-hidden className="pos-scrim" />
          <section className="pos-sheet relative w-full max-w-2xl !p-6">
            <p className="pos-eyebrow">NOTA DO ARTIGO</p>
            <h2 className="pos-title mt-1">{noteLine.name}</h2>
            <p
              className={`mt-4 !min-h-14 !rounded-2xl !px-4 !py-3 !text-lg !font-bold ${
                noteDraft
                  ? 'bg-[color:var(--pos-accent-soft)] !text-gold !shadow-[inset_0_0_0_1px_var(--pos-accent-line)]'
                  : 'pos-well !font-medium !text-ink-mute'
              }`}
            >
              {noteDraft ||
                (quickNotes.length > 0 ? 'Toca nos atalhos — somam-se' : 'Toca em Escrever')}
            </p>

            {/* Os atalhos somam-se ("SEM CEBOLA, SEM MOLHO") e um segundo toque
                tira-os. Nada vai para o carrinho até ao OK. */}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {quickNotes.map((nota) => {
                const escolhida = noteHasChip(noteDraft, nota);
                return (
                  <button
                    key={nota}
                    type="button"
                    aria-pressed={escolhida}
                    onClick={() => setNoteDraft((actual) => toggleNoteChip(actual, nota))}
                    className="pos-choice !px-2 !text-base !text-ink aria-pressed:!text-[color:var(--pos-on-accent)]"
                  >
                    {escolhida ? `✓ ${nota}` : nota}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => setNoteLine(null)}
                className="pos-btn pos-btn--quiet"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => setNoteDraft('')}
                className="pos-btn"
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={() => setNoteKeyboard(true)}
                className="pos-btn"
              >
                <PosIcon name="pencil" size={18} />
                Escrever
              </button>
              <button
                type="button"
                onClick={() => {
                  setCart((actual) => setLineNotes(actual, noteLine, noteDraft || null));
                  setNoteLine(null);
                }}
                className="pos-btn pos-btn--primary !text-lg"
              >
                OK
              </button>
            </div>
          </section>
        </div>
      )}

      {noteLine && noteKeyboard && (
        <TouchKeyboard
          label={`Nota · ${noteLine.name}`}
          value={noteDraft}
          maxLength={120}
          suggestions={quickNotes}
          onCancel={() => setNoteKeyboard(false)}
          onConfirm={(valor) => {
            setCart((actual) => setLineNotes(actual, noteLine, valor || null));
            setNoteKeyboard(false);
            setNoteLine(null);
          }}
        />
      )}

      {confirmation && (
        <div className="fixed inset-0 z-50 grid place-items-center p-6">
          <div aria-hidden className="pos-scrim !bg-black/85" />
          {/* A única animação com vagar do balcão: é a que diz "ficou feito".
              Um visto a desenhar-se lê-se de relance, de pé, com fila. */}
          <section className="pos-sheet pos-pop relative w-full max-w-md !p-8 !text-center">
            <span className={`pos-mark mx-auto ${confirmation.offline ? 'pos-mark--warn' : ''}`}>
              <PosIcon name={confirmation.offline ? 'clock' : 'check'} size={34} strokeWidth={2.5} />
            </span>
            <p
              className={`mt-4 text-sm font-bold tracking-[0.14em] ${
                confirmation.offline ? 'text-amber-300' : 'text-emerald-300'
              }`}
            >
              {confirmation.offline ? 'VENDA GUARDADA OFFLINE' : 'VENDA REGISTADA'}
            </p>
            <p className="pos-num my-3 font-display text-[8.5rem] leading-none tracking-normal text-ink">
              {confirmation.dailyNumber}
            </p>
            <p className="pos-num text-3xl font-extrabold text-gold">{mt(confirmation.totalCents)}</p>

            {/* Com dinheiro, o troco manda no ecrã e o OK é obrigatório: o
                caixa confirma que o que deu é o que o sistema gravou. */}
            {confirmation.closing.requiresAck && (
              <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="flex justify-between text-base text-ink-dim">
                  <span>Em dinheiro</span>
                  <span className="pos-num font-bold">{mt(confirmation.closing.cashDueCents)}</span>
                </div>
                {confirmation.closing.receivedCents !== null && (
                  <div className="flex justify-between text-base text-ink-dim">
                    <span>Recebido</span>
                    <span className="pos-num font-bold">{mt(confirmation.closing.receivedCents)}</span>
                  </div>
                )}
                {confirmation.closing.otherPayments.map((payment) => (
                  <div key={payment.method} className="flex justify-between text-base text-ink-dim">
                    <span>{payMethods.find((entry) => entry.id === payment.method)?.label ?? payment.method}</span>
                    <span className="pos-num font-bold">{mt(payment.amountCents)}</span>
                  </div>
                ))}
                <p className="mt-3 text-sm font-bold tracking-[0.14em] text-ink-mute">TROCO A DAR</p>
                <p className="pos-num font-display text-6xl leading-none text-emerald-300">
                  {confirmation.closing.changeCents === null ? '—' : mt(confirmation.closing.changeCents)}
                </p>
                {confirmation.closing.changeMismatch && (
                  <p role="alert" className="mt-3 rounded-xl bg-amber-500/15 px-3 py-2 text-sm font-bold text-amber-200">
                    Atenção: o sistema gravou este troco, diferente do que apareceu ao cobrar. Dá este.
                  </p>
                )}
              </div>
            )}

            {confirmation.offline && (
              <p className="mt-4 text-sm text-ink-mute">Será sincronizada quando a ligação voltar.</p>
            )}
            <button
              type="button"
              autoFocus
              onClick={dismissConfirmation}
              className="pos-btn pos-btn--primary pos-btn--lg mt-5 w-full !text-2xl"
            >
              {confirmation.closing.requiresAck
                ? confirmation.closing.changeCents
                  ? 'Troco entregue · OK'
                  : 'Dinheiro conferido · OK'
                : 'OK · Nova venda'}
            </button>
          </section>
        </div>
      )}

      {voidOpen && lastSale && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
          <div aria-hidden className="pos-scrim" />
          <section className="pos-sheet relative w-full max-w-lg !p-6">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[color:var(--pos-danger-soft)] text-red-300">
              <PosIcon name="undo" size={22} />
            </span>
            <h2 className="pos-title mt-4 !text-2xl">Anular venda #{lastSale.dailyNumber}</h2>
            <p className="mt-1.5 text-sm text-ink-dim">A acção exige gerente e fica registada.</p>
            <textarea
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
              placeholder="Motivo obrigatório"
              className="pos-well mt-4 !min-h-28 w-full !p-4 !text-ink outline-none placeholder:text-ink-mute focus:shadow-[inset_0_0_0_1.5px_rgba(248,113,113,.6)]"
            />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setVoidOpen(false)}
                className="pos-btn"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={submitting || voidReason.trim().length < 3}
                onClick={() => void voidLastSale()}
                className="pos-btn pos-btn--danger-solid"
              >
                Confirmar anulação
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Ecrã bloqueado é o MESMO ecrã de entrada: os cartões da equipa. Quem
          se ausentou volta ao seu turno com o seu PIN; quem rende o turno toca
          no próprio cartão e a sessão passa a ser dele — é o que mantém cada
          venda assinada por quem a fez (§6). */}
      {pinConfigured && locked && (
        <div className="fixed inset-0 z-[70] overflow-auto bg-bg0">
          <PosLogin
            deviceId={context.deviceId}
            currentUserId={sessionUserId}
            onUnlockCurrentUser={unlockCurrentUser}
            onAuthenticated={handleAuthenticated}
            footer={terminalFooter}
          />
        </div>
      )}

      {!pinConfigured && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-bg0 p-4">
          <section className="pos-sheet w-full max-w-md !p-7 !text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[color:var(--pos-accent-soft)] text-gold">
              <PosIcon name="lock" size={26} />
            </span>
            <p className="pos-eyebrow mt-4 !text-gold">CRIAR PIN</p>
            <h2 className="pos-title mt-1.5 !text-3xl">Protege este turno</h2>
            <p className="mt-2 text-sm text-ink-dim">
              Escolhe 4 a 6 algarismos. É com este PIN que passas a entrar pelo
              teu cartão neste terminal — o email não volta a ser preciso.
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
                if (event.key === 'Enter') void configurePin();
              }}
              className="pos-well mt-6 !min-h-16 w-full !px-4 !text-center !text-3xl !font-bold !tracking-[0.5em] outline-none focus:shadow-[inset_0_0_0_1.5px_var(--gold)]"
            />
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
              className="pos-well mt-3 !min-h-16 w-full !px-4 !text-center !text-xl !font-bold !tracking-[0.35em] outline-none placeholder:tracking-normal placeholder:text-ink-mute focus:shadow-[inset_0_0_0_1.5px_var(--gold)]"
            />
            {pinError && (
              <p role="alert" className="pos-note pos-note--danger mt-4">
                {pinError}
              </p>
            )}
            <button
              type="button"
              disabled={submitting || !isPosPin(pin) || pin !== pinConfirmation}
              onClick={() => void configurePin()}
              className="pos-btn pos-btn--primary mt-5 w-full !text-lg"
            >
              {submitting ? 'A confirmar…' : 'Guardar PIN'}
            </button>

            <div className="mt-8 border-t border-white/[0.07] pt-5 text-left">{terminalFooter}</div>
          </section>
        </div>
      )}
    </main>
  );
}
