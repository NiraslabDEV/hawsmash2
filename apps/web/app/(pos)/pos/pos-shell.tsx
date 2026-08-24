'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { buildPosUpsellFunnel, type PosUpsellStep } from '@/lib/pos/pos-upsell';
import { isPosPin, POS_IDLE_TIMEOUT_MS } from '@/lib/pos/session';
import { OrdersBoard } from './orders-board';
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
  upsellEnabled: boolean;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
};

type FulfillmentType = 'counter' | 'pickup' | 'delivery';

const FULFILLMENT_LABELS: Record<FulfillmentType, string> = {
  counter: 'Balcão',
  pickup: 'Levantamento',
  delivery: 'Entrega',
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

type DeliveryOrder = {
  id: string;
  order_number: string;
  daily_number: number | null;
  channel: string | null;
  status: string;
  customer_name: string;
  customer_phone: string;
  address: string | null;
  total_cents: number;
  created_at: string;
  items: Array<{ id: string; name: string; qty: number }>;
};

const DELIVERY_STATUS_META: Record<string, { label: string; className: string }> = {
  awaiting_approval: { label: 'Novo', className: 'bg-amber-500/15 text-amber-300' },
  awaiting_payment: { label: 'A pagar', className: 'bg-blue-500/15 text-blue-300' },
  paid: { label: 'Pago', className: 'bg-blue-500/15 text-blue-300' },
  approved: { label: 'Aceite', className: 'bg-emerald-500/15 text-emerald-300' },
  in_preparation: { label: 'Em preparo', className: 'bg-orange-500/15 text-orange-300' },
  ready: { label: 'Pronto', className: 'bg-purple-500/15 text-purple-300' },
  delivered: { label: 'Entregue', className: 'bg-green-500/15 text-green-400' },
  cancelled: { label: 'Cancelado', className: 'bg-red-500/15 text-red-300' },
};

// O carrinho vive em `lib/pos/cart.ts`: é lá que se decide o preço da variante
// e o que conta como a mesma linha. Aqui só se desenha.
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
  const warmedPhotoUrls = useRef<Set<string>>(new Set());
  // 'delivery' é só consulta — o cashier acompanha o que está a sair pela
  // loja online sem sair do POS nem precisar de acesso ao painel admin.
  const [posView, setPosView] = useState<'menu' | 'delivery'>('menu');
  const [deliveryOrders, setDeliveryOrders] = useState<DeliveryOrder[]>([]);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
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
  } | null>(null);
  const [lastSale, setLastSale] = useState<{ orderId: string; dailyNumber: number } | null>(null);
  const [paying, setPaying] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
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
        upsell_enabled?: boolean;
        store?: { pickup_enabled?: boolean; delivery_enabled?: boolean };
      };
      setChannels({
        zones: full.zones ?? [],
        upsellEnabled: full.upsell_enabled !== false,
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

  const fetchDeliveryOrders = useCallback(async () => {
    if (!context) return;
    setDeliveryLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_orders', {
        p_filters: { store: context.storeSlug, limit: 50 },
      });
      if (!error && data) {
        const all = (data.orders ?? []) as DeliveryOrder[];
        setDeliveryOrders(all.filter((order) => order.channel === 'delivery'));
      }
    } finally {
      setDeliveryLoading(false);
    }
  }, [context, supabase]);

  // Só faz polling enquanto a aba Delivery está aberta — o balcão já sofreu
  // com tráfego de fundo desnecessário em wifi fraco (aquecimento de fotos),
  // não vale a pena repetir o erro aqui.
  useEffect(() => {
    if (posView !== 'delivery' || !context) return;
    void fetchDeliveryOrders();
    const timer = window.setInterval(() => void fetchDeliveryOrders(), 20_000);
    return () => window.clearInterval(timer);
  }, [posView, context, fetchDeliveryOrders]);

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
                ...(item.variantId ? { variantId: item.variantId } : {}),
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

  const lines = useMemo(() => cartLines(cart), [cart]);
  const subtotalCents = useMemo(() => cartTotalCents(cart), [cart]);
  const count = useMemo(() => cartCount(cart), [cart]);

  // Aquece o cache das fotos do cardápio INTEIRO, não só o da categoria aberta.
  // Sem isto, uma categoria que ninguém abriu com rede aparece sem imagens
  // quando a ligação cai — e a ligação cai sempre no pior momento. O service
  // worker (`/pos-sw.js`) é quem guarda; aqui só se pedem os ficheiros.
  //
  // `warmedPhotoUrls` lembra o que já foi pedido nesta sessão: o menu
  // refresca a cada 2 min (MENU_REFRESH_MS) e cria arrays novos mesmo quando
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
      setFulfillment('counter');
      setCustomerName('');
      setCustomerPhone('');
      setZoneId('');
      setOrderNote('');
    }
  }, [lines.length]);

  const [channels, setChannels] = useState<StoreChannels>({
    zones: [],
    upsellEnabled: true,
    pickupEnabled: true,
    deliveryEnabled: true,
  });
  const [fulfillment, setFulfillment] = useState<FulfillmentType>('counter');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [zoneId, setZoneId] = useState('');

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
  const [noteOpen, setNoteOpen] = useState(false);
  const [funnel, setFunnel] = useState<PosUpsellStep[]>([]);
  const [funnelIndex, setFunnelIndex] = useState(0);
  const funnelStep = funnel[funnelIndex] ?? null;
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
      enabled: channels.upsellEnabled,
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
  const changeCents = useMemo(() => {
    if (cashPaymentCents === 0 || cashReceivedCents < cashPaymentCents) return null;
    return calculateChange(cashPaymentCents, cashReceivedCents);
  }, [cashPaymentCents, cashReceivedCents]);

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
        return { step: 'change', receivedCents: cashReceivedCents, changeCents };
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
    cashReceivedCents,
    changeCents,
    confirmation,
    count,
    lastTouched,
    lines,
    methods,
    mobileInstructions,
    paying,
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
    setCart((current) => applyQty(current, line, delta));
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
          menuItemId: line.menuItemId,
          // Sem o variantId aqui, um WAGYU vendido sem rede sincronizava ao
          // preco base: cobrado 400 ao cliente, lancado 300 no servidor.
          ...(line.variantId ? { variantId: line.variantId } : {}),
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
        items: salePayloadItems(lines),
        payments: paymentPlan.payments,
        ...(cashPaymentCents > 0 ? { cashReceivedCents } : {}),
        // Campos que a RPC sempre aceitou e o POS nunca enviou. Só vão no
        // caminho online: offline o POS vende balcão e não cria entregas
        // (CLAUDE §7.5), por isso a fila local não os transporta.
        fulfillmentType: fulfillment,
        ...(fulfillment === 'delivery' && zoneId ? { deliveryZoneId: zoneId } : {}),
        ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
        ...(customerPhone.trim() ? { customerPhone: customerPhone.trim() } : {}),
        ...(orderNote.trim() ? { notes: orderNote.trim() } : {}),
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
        {/* O caixa gere as entregas sem sair do terminal. E daqui que se ve
            o que ja foi pago e ainda nao saiu pela porta. */}
        <button
          type="button"
          onClick={() => setBoardOpen(true)}
          className="min-h-14 shrink-0 rounded-xl bg-white/[0.08] px-5 text-base font-black active:bg-white/20"
        >
          Pedidos
        </button>
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

      <div className="grid lg:h-[calc(100vh-4rem)] lg:grid-cols-[10rem_minmax(0,1fr)_25rem]">
        <nav className="flex gap-2 overflow-x-auto border-b border-white/10 bg-[#111110] p-2 lg:block lg:overflow-y-auto lg:border-b-0 lg:border-r">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => {
                setPosView('menu');
                setActiveCategory(category.id);
              }}
              className={`min-h-16 min-w-28 whitespace-normal rounded-2xl px-2 text-sm font-black leading-tight active:scale-[0.98] lg:mb-2 lg:w-full lg:min-w-0 ${
                posView === 'menu' && activeCategory === category.id
                  ? 'bg-[#e5a93c] text-black'
                  : 'bg-white/[0.06] text-[#c8bfb0]'
              }`}
            >
              {category.name}
            </button>
          ))}
          {/* O cashier fecha vendas no balcão, mas também precisa de ver o
              que está a sair pela loja online — sem sair do POS nem
              depender de acesso ao painel admin, que o perfil não tem. */}
          <button
            type="button"
            onClick={() => setPosView('delivery')}
            className={`min-h-16 min-w-28 whitespace-normal rounded-2xl px-2 text-sm font-black leading-tight active:scale-[0.98] lg:mb-2 lg:mt-2 lg:w-full lg:min-w-0 lg:border-t lg:border-white/10 lg:pt-4 ${
              posView === 'delivery'
                ? 'bg-[#e5a93c] text-black'
                : 'bg-white/[0.06] text-[#c8bfb0]'
            }`}
          >
            Delivery
          </button>
        </nav>

        <section className="overflow-y-auto p-3 lg:p-4">
          {posView === 'delivery' ? (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-black">Delivery · {context.storeName}</h2>
                <button
                  type="button"
                  onClick={() => void fetchDeliveryOrders()}
                  disabled={deliveryLoading}
                  className="min-h-12 shrink-0 rounded-xl bg-white/[0.07] px-4 text-sm font-bold active:bg-white/15 disabled:opacity-40"
                >
                  {deliveryLoading ? 'A actualizar…' : 'Actualizar'}
                </button>
              </div>
              {deliveryOrders.length === 0 && !deliveryLoading && (
                <p className="rounded-2xl border border-white/10 bg-[#1a1816] p-6 text-center text-[#847e72]">
                  Sem pedidos de delivery neste momento.
                </p>
              )}
              {deliveryOrders.map((order) => {
                const meta =
                  DELIVERY_STATUS_META[order.status] ??
                  ({ label: order.status, className: 'bg-white/10 text-white' } as const);
                return (
                  <div key={order.id} className="rounded-2xl border border-white/10 bg-[#1a1816] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-lg font-black">
                          #{order.daily_number ?? order.order_number} · {order.customer_name}
                        </p>
                        <p className="truncate text-sm text-[#847e72]">
                          {order.customer_phone}
                          {order.address ? ` · ${order.address}` : ''}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-3 py-1 text-xs font-black uppercase ${meta.className}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-[#c8bfb0]">
                      {order.items.map((it) => `${it.qty}× ${it.name}`).join(', ')}
                    </p>
                    <p className="mt-2 text-lg font-black text-[#e5a93c]">{mt(order.total_cents)}</p>
                  </div>
                );
              })}
            </div>
          ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
            {visibleItems.map((item) => {
              const availability = posItemAvailability(item);
              const qty = qtyOfItem(cart, item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!availability.sellable}
                  onClick={() => tapItem(item)}
                  className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#1a1816] text-left shadow-lg active:scale-[0.98] disabled:opacity-35"
                >
                  <span className="relative block aspect-[4/3] w-full overflow-hidden bg-black/40">
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
                            ? 'h-full w-full object-contain p-3'
                            : 'h-full w-full object-cover'
                        }
                      />
                    )}
                    {availability.badge && (
                      <span
                        className={`absolute left-2 top-2 rounded-full px-2 py-1 text-[11px] font-black uppercase ${
                          availability.sellable
                            ? 'bg-black/70 text-[#d8d2c6]'
                            : 'bg-[#7a2b2b] text-white'
                        }`}
                      >
                        {availability.badge}
                      </span>
                    )}
                    {qty && (
                      <span className="absolute right-2 top-2 grid h-11 min-w-11 place-items-center rounded-full bg-[#e5a93c] px-2 text-xl font-black text-black shadow-lg">
                        {qty}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-1 flex-col justify-between gap-1 p-3">
                    <span className="block text-base font-black leading-tight">{item.name}</span>
                    <span className="block text-xl font-black text-[#e5a93c]">
                      {mt(item.price_cents)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          )}
        </section>

        <aside className="flex min-h-[36rem] flex-col border-t border-white/10 bg-[#111110] lg:min-h-0 lg:border-l lg:border-t-0">
          <div className="shrink-0 border-b border-white/10 p-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 className="text-xl font-black">Carrinho</h2>
              <span className="text-sm text-[#847e72]">{count} artigos</span>
            </div>

            {/* Tipo de pedido. Só aparecem os canais que a loja tem ligados —
                oferecer entrega numa loja sem entrega é prometer o que não se
                cumpre. Offline fica só o balcão (CLAUDE §7.5). */}
            <div className="grid grid-cols-3 gap-2">
              {(['counter', 'pickup', 'delivery'] as FulfillmentType[]).map((tipo) => {
                const permitido =
                  tipo === 'counter' ||
                  (online &&
                    (tipo === 'pickup' ? channels.pickupEnabled : channels.deliveryEnabled));
                if (!permitido) return null;
                return (
                  <button
                    key={tipo}
                    type="button"
                    onClick={() => setFulfillment(tipo)}
                    className={`min-h-16 rounded-xl px-2 text-sm font-black active:scale-[0.98] ${
                      fulfillment === tipo
                        ? 'bg-[#e5a93c] text-black'
                        : 'bg-white/[0.07] text-[#c8bfb0]'
                    }`}
                  >
                    {FULFILLMENT_LABELS[tipo]}
                  </button>
                );
              })}
            </div>

            {fulfillment !== 'counter' && (
              <div className="mt-2 space-y-2">
                <input
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  placeholder="Nome do cliente"
                  className="min-h-14 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-base text-white outline-none focus:border-[#e5a93c]"
                />
                <input
                  value={customerPhone}
                  onChange={(event) => setCustomerPhone(event.target.value)}
                  inputMode="tel"
                  placeholder="Telefone"
                  className="min-h-14 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-base text-white outline-none focus:border-[#e5a93c]"
                />
                {fulfillment === 'delivery' && (
                  <select
                    value={zoneId}
                    onChange={(event) => setZoneId(event.target.value)}
                    className="min-h-14 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-base font-bold text-white outline-none focus:border-[#e5a93c]"
                  >
                    <option value="">Zona de entrega…</option>
                    {channels.zones.map((zona) => (
                      <option key={zona.id} value={zona.id}>
                        {zona.name} · {mt(zona.fee_cents)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
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
                        onClick={() => changeLineQty(line, -1)}
                        className="grid min-h-16 min-w-16 place-items-center rounded-xl bg-white/10 text-xl font-black active:bg-white/20"
                        aria-label={`Retirar ${line.name}`}
                      >
                        −
                      </button>
                      <span className="min-w-9 text-center text-lg font-black">{line.qty}</span>
                      <button
                        type="button"
                        onClick={() => changeLineQty(line, 1)}
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

          <section className="shrink-0 border-t border-white/10 p-3">
            <button
              type="button"
              onClick={() => setNoteOpen(true)}
              className={`mb-2 min-h-14 w-full rounded-xl px-3 text-left text-sm font-bold active:scale-[0.98] ${
                orderNote.trim() ? 'bg-white/[0.12] text-[#f6f1e6]' : 'bg-white/[0.05] text-[#847e72]'
              }`}
            >
              {orderNote.trim() ? `Nota: ${orderNote.trim()}` : '+ Nota do pedido'}
            </button>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-bold text-[#c8bfb0]">TOTAL</span>
              <strong className="text-3xl text-[#e5a93c]">{mt(totalCents)}</strong>
            </div>
            <button
              type="button"
              disabled={lines.length === 0}
              onClick={startCheckout}
              className="min-h-20 w-full rounded-2xl bg-[#e5a93c] px-4 text-2xl font-black text-black shadow-[0_10px_30px_rgba(229,169,60,.22)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
            >
              PAGAR
            </button>
          </section>
        </aside>
      </div>

      {/* Selector de variante.
          O Classic Smash não tem um preço: HAW são 300 e WAGYU são 400. Até
          aqui o balcão não perguntava e o WAGYU simplesmente não se vendia,
          enquanto o servidor (migration 1018) já o sabia cobrar. Aparece só
          quando há mesmo escolha — um toque a mais em cada batata frita seriam
          segundos que ao balcão não existem. */}
      {boardOpen && (
        <OrdersBoard storeId={context.storeId} onClose={() => setBoardOpen(false)} />
      )}

      {variantPick && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-[#141210] p-5 shadow-2xl">
            <p className="text-xs font-black tracking-[0.25em] text-[#847e72]">QUAL?</p>
            <h2 className="mb-4 text-3xl font-black text-[#f6f1e6]">{variantPick.name}</h2>

            <div className="grid gap-3 sm:grid-cols-2">
              {(variantPick.variants ?? []).map((variante) => (
                <button
                  key={variante.id}
                  type="button"
                  onClick={() => {
                    changeQty(variantPick, 1, variante);
                    setVariantPick(null);
                  }}
                  className="flex min-h-24 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-[#1a1816] px-5 text-left active:scale-[0.98]"
                >
                  <span className="text-2xl font-black text-[#f6f1e6]">{variante.name}</span>
                  <span className="shrink-0 text-2xl font-black text-[#e5a93c]">
                    {mt(variante.price_cents)}
                  </span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setVariantPick(null)}
              className="mt-4 min-h-16 w-full rounded-2xl bg-white/10 text-lg font-black text-[#f6f1e6] active:bg-white/20"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {funnelStep && (
        <div className="fixed inset-0 z-40 flex flex-col bg-[#0a0807] text-[#f6f1e6]">
          <header className="shrink-0 border-b border-white/10 px-6 py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-black tracking-[0.25em] text-[#847e72]">
                  PASSO {funnelIndex + 1} DE {funnel.length}
                </p>
                <h2 className="text-3xl font-black">{funnelStep.title}</h2>
              </div>
              {/* O funil é obrigatório, o caminho de volta não pode ser. Quem
                  precisa de mexer no que já estava no carrinho vai lá, corrige,
                  e volta a passar pela oferta — não fica preso a olhar para ela. */}
              <button
                type="button"
                onClick={cancelFunnel}
                className="min-h-16 shrink-0 rounded-2xl bg-white/10 px-5 text-base font-black active:bg-white/20"
              >
                ← Carrinho
              </button>
            </div>
            {/* A frase existe para ser dita em voz alta. É o que separa um balcão
                que oferece de um que não oferece — e quem tem fila à frente não
                inventa uma boa pergunta de cada vez. */}
            <p className="mt-2 rounded-2xl bg-[#e5a93c]/10 px-5 py-3 text-xl font-bold italic text-[#e5a93c]">
              “{funnelStep.script}”
            </p>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mx-auto flex w-full max-w-5xl flex-wrap justify-center gap-3">
              {funnelStep.items.map((item) => {
                const posItem = item as (typeof visibleItems)[number];
                const qty = qtyOfItem(cart, item.id);
                return (
                  <div
                    key={item.id}
                    className="flex w-60 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#1a1816] text-left shadow-lg"
                  >
                    <button
                      type="button"
                      onClick={() => tapItem(posItem)}
                      className="flex flex-1 flex-col text-left active:scale-[0.98]"
                    >
                      <span className="relative block aspect-[3/2] w-full overflow-hidden bg-black/40">
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
                            className="h-full w-full object-contain p-2"
                          />
                        )}
                        {qty > 0 && (
                          <span className="absolute right-2 top-2 grid h-11 min-w-11 place-items-center rounded-full bg-[#e5a93c] px-2 text-xl font-black text-black shadow-lg">
                            {qty}
                          </span>
                        )}
                      </span>
                      <span className="flex flex-1 flex-col justify-between gap-1 px-3 py-2">
                        <span className="block text-base font-black leading-tight">{item.name}</span>
                        <span className="block text-xl font-black text-[#e5a93c]">
                          {mt(item.price_cents)}
                        </span>
                      </span>
                    </button>

                    {/* Tocar sem querer num ecrã touch é normal; ficar preso ao
                        engano não é. Até aqui o item só saía voltando ao carrinho
                        — que daqui nem se via. Tirar tem de estar onde se pôs. */}
                    {qty > 0 && (
                      <div className="flex items-stretch border-t border-white/10 bg-black/30">
                        <button
                          type="button"
                          aria-label={`Tirar um ${item.name}`}
                          onClick={() => setCart((atual) => removeOneOfItem(atual, posItem.id))}
                          className="min-h-16 flex-1 text-3xl font-black text-red-300 active:bg-red-500/20"
                        >
                          −
                        </button>
                        <span className="grid min-h-16 w-14 place-items-center border-x border-white/10 text-2xl font-black">
                          {qty}
                        </span>
                        <button
                          type="button"
                          aria-label={`Juntar um ${item.name}`}
                          onClick={() => tapItem(posItem)}
                          className="min-h-16 flex-1 text-3xl font-black text-[#e5a93c] active:bg-white/10"
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <footer className="shrink-0 border-t border-white/10 p-4">
            <div className="mx-auto flex w-full max-w-5xl items-center gap-3">
              {/* Saltar tem de ser fácil: o que se força é a oferta, não a compra.
                  Um cliente que diz que não é um toque, não uma negociação. */}
              <button
                type="button"
                onClick={advanceFunnel}
                className="min-h-20 flex-1 rounded-2xl bg-white/10 px-4 text-xl font-black active:bg-white/20"
              >
                Não quis
              </button>
              <div className="hidden shrink-0 px-4 text-right sm:block">
                <p className="text-xs font-black tracking-[0.2em] text-[#847e72]">TOTAL</p>
                <p className="text-2xl font-black text-[#e5a93c]">{mt(totalCents)}</p>
              </div>
              <button
                type="button"
                onClick={advanceFunnel}
                className="min-h-20 flex-1 rounded-2xl bg-[#e5a93c] px-4 text-xl font-black text-black shadow-[0_10px_30px_rgba(229,169,60,.22)] active:scale-[0.98]"
              >
                {funnelIndex + 1 < funnel.length ? 'Continuar →' : 'Ir pagar →'}
              </button>
            </div>
          </footer>
        </div>
      )}

      {paying && (
        <div className="fixed inset-0 z-40 flex flex-col bg-[#0a0807] text-[#f6f1e6]">
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
            <div>
              <p className="text-xs font-black tracking-[0.25em] text-[#847e72]">TOTAL A PAGAR</p>
              <p className="text-5xl font-black leading-tight text-[#e5a93c]">{mt(totalCents)}</p>
            </div>
            <button
              type="button"
              onClick={() => setPaying(false)}
              className="min-h-16 shrink-0 rounded-2xl bg-white/10 px-6 text-lg font-black active:bg-white/20"
            >
              ← Voltar ao carrinho
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <div className="mx-auto grid w-full max-w-5xl gap-5 lg:grid-cols-2">
              <div className="space-y-3">
                {/* O que se está a cobrar, à vista de quem cobra. Sem isto o
                    ecrã pede um valor sem dizer de quê, e conferir obrigava a
                    voltar ao carrinho — e a repetir o funil de oferta. */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-xs font-black tracking-[0.25em] text-[#847e72]">
                      RESUMO · {count} {count === 1 ? 'ARTIGO' : 'ARTIGOS'}
                    </p>
                    {fulfillment !== 'counter' && (
                      <p className="text-xs font-black tracking-[0.2em] text-[#e5a93c]">
                        {FULFILLMENT_LABELS[fulfillment].toUpperCase()}
                        {customerName.trim() ? ` · ${customerName.trim()}` : ''}
                      </p>
                    )}
                  </div>
                  <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto">
                    {lines.map((line) => (
                      <li
                        key={line.id}
                        className="flex items-baseline justify-between gap-3 text-base font-bold"
                      >
                        <span className="min-w-0">
                          <span className="text-[#e5a93c]">{line.qty}×</span> {line.name}
                        </span>
                        <span className="shrink-0 tabular-nums text-[#c8bfb0]">
                          {mt(line.price_cents * line.qty)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {deliveryFeeCents > 0 && (
                    <p className="mt-2 flex items-baseline justify-between gap-3 border-t border-white/10 pt-2 text-base font-bold text-[#c8bfb0]">
                      <span>Taxa de entrega</span>
                      <span className="tabular-nums">{mt(deliveryFeeCents)}</span>
                    </p>
                  )}
                  <p className="mt-2 flex items-baseline justify-between border-t border-white/10 pt-2 text-xl font-black">
                    <span>TOTAL</span>
                    <span className="text-[#e5a93c]">{mt(totalCents)}</span>
                  </p>
                </div>

                <label className="flex min-h-14 items-center justify-between rounded-xl bg-white/[0.05] px-4 text-base font-bold">
                  Pagamento misto
                  <input
                    type="checkbox"
                    checked={mixed}
                    onChange={(event) => setMixedMode(event.target.checked)}
                    className="h-6 w-6 accent-[#e5a93c]"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  {METHODS.map((method) => {
                    const selected = methods.includes(method.id);
                    return (
                      <button
                        key={method.id}
                        type="button"
                        onClick={() => selectMethod(method.id)}
                        className={`min-h-20 rounded-2xl px-3 text-lg font-black active:scale-[0.98] ${
                          selected ? 'bg-[#e5a93c] text-black' : 'bg-white/[0.07] text-[#c8bfb0]'
                        }`}
                      >
                        {method.label}
                        {mixed && selected && (
                          <span className="mt-1 block text-sm">{mt(allocations[method.id] ?? 0)}</span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {mixed && (
                  <p
                    className={`rounded-xl py-3 text-center text-base font-bold ${
                      paymentPlan.complete
                        ? 'bg-emerald-500/10 text-emerald-300'
                        : 'bg-amber-500/10 text-amber-300'
                    }`}
                  >
                    {paymentPlan.complete
                      ? 'Pagamento completo'
                      : paymentPlan.remainingCents > 0
                        ? `Faltam ${mt(paymentPlan.remainingCents)}`
                        : `Excede ${mt(Math.abs(paymentPlan.remainingCents))}`}
                  </p>
                )}

                {changeCents !== null && cashPaymentCents > 0 && (
                  <p className="rounded-2xl bg-emerald-500/15 py-5 text-center text-4xl font-black text-emerald-300">
                    TROCO {mt(changeCents)}
                  </p>
                )}

                {/* Loja sem número configurado não pode fingir que tem um.
                    Melhor dizer o que falta do que mostrar um campo vazio. */}
                {mobileMethod && !mobileInstructions && (
                  <p className="rounded-2xl bg-amber-500/10 p-4 text-base font-bold text-amber-200">
                    Esta loja ainda não tem número de{' '}
                    {mobileMethod === 'mpesa' ? 'M-Pesa' : 'e-Mola'} configurado. Cobra pelo número
                    do costume e avisa o gerente para o preencher em Lojas.
                  </p>
                )}

                {error && (
                  <p
                    role="alert"
                    className="rounded-xl bg-red-950/60 p-4 text-base font-bold text-red-200"
                  >
                    {error}
                  </p>
                )}
              </div>

              {(mixed || methods[0] === 'cash') && (
                <div className="rounded-2xl border border-white/10 p-4">
                  {mixed && (
                    <div className="mb-3 flex gap-2 overflow-x-auto">
                      {methods.map((method) => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => setKeypadTarget(method)}
                          className={`min-h-14 min-w-28 rounded-xl px-3 text-sm font-bold ${
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
                      className={`mb-3 min-h-16 w-full rounded-xl px-4 text-left text-base font-bold ${
                        keypadTarget === 'cash_received'
                          ? 'bg-emerald-400 text-black'
                          : 'bg-white/10'
                      }`}
                    >
                      Recebido: {mt(cashReceivedCents)}
                    </button>
                  )}

                  {/* Valores rápidos: é o que a caixa recebe em nove de cada dez
                      vendas. Poupa três toques por venda e um erro de digitação
                      num campo onde o erro vira troco errado. */}
                  {keypadTarget === 'cash_received' && (
                    <div className="mb-3 grid grid-cols-4 gap-2">
                      {[50_000, 100_000, 200_000].map((valor) => (
                        <button
                          key={valor}
                          type="button"
                          onClick={() => setTargetValue(valor)}
                          className="min-h-16 rounded-xl bg-white/[0.12] text-lg font-black active:bg-white/20"
                        >
                          {valor / 100}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={fillRemaining}
                        className="min-h-16 rounded-xl bg-emerald-500/20 text-base font-black text-emerald-200 active:bg-emerald-500/30"
                      >
                        Exacto
                      </button>
                    </div>
                  )}

                  <div className="mb-3 flex items-center justify-between rounded-xl bg-black/30 px-4 py-3">
                    <span className="text-sm text-[#847e72]">
                      {keypadTarget === 'cash_received' ? 'Valor recebido' : 'Parcela'}
                    </span>
                    <strong className="text-3xl font-black">{mt(targetValue())}</strong>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => pressKey(key)}
                        className="min-h-16 rounded-xl bg-white/[0.08] text-2xl font-black active:bg-white/20"
                      >
                        {key}
                      </button>
                    ))}
                  </div>

                  {/* Em dinheiro o "Exacto" já está na fila rápida, por cima do
                      teclado. Este botão fica só para as parcelas do pagamento
                      misto — dois botões com a mesma função é um deles a mais. */}
                  {keypadTarget !== 'cash_received' && (
                    <button
                      type="button"
                      onClick={fillRemaining}
                      className="mt-3 min-h-16 w-full rounded-xl bg-white/10 text-base font-bold active:bg-white/20"
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
                <div className="rounded-2xl border border-[#e5a93c]/40 bg-[#e5a93c]/[0.07] p-5">
                  <p className="text-xs font-black tracking-[0.25em] text-[#847e72]">
                    {mobileInstructions.label.toUpperCase()} · NÚMERO DA LOJA
                  </p>
                  <p className="mt-1 select-all text-5xl font-black leading-tight text-[#e5a93c]">
                    {mobileInstructions.prettyNumber}
                  </p>
                  {mobileInstructions.holder && (
                    <p className="text-lg font-bold text-[#c8bfb0]">{mobileInstructions.holder}</p>
                  )}
                  <p className="mt-3 rounded-xl bg-black/30 px-4 py-3 text-2xl font-black">
                    Enviar {mobileInstructions.amount}
                  </p>
                  <ol className="mt-4 space-y-2">
                    {mobileInstructions.steps.map((step, index) => (
                      <li key={step} className="flex gap-3 text-base font-bold text-[#c8bfb0]">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-black text-[#f6f1e6]">
                          {index + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                  <p className="mt-3 text-sm font-black text-amber-300">
                    Só finalizar depois de ver a SMS de confirmação.
                  </p>
                </div>
              )}
            </div>
          </div>

          <footer className="shrink-0 border-t border-white/10 p-4">
            <button
              type="button"
              disabled={
                submitting ||
                lines.length === 0 ||
                !paymentPlan.complete ||
                (cashPaymentCents > 0 && changeCents === null)
              }
              onClick={() => void finalizeSale()}
              className="mx-auto block min-h-20 w-full max-w-5xl rounded-2xl bg-[#e5a93c] px-4 text-2xl font-black text-black shadow-[0_10px_30px_rgba(229,169,60,.22)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
            >
              {submitting ? 'A registar…' : 'FINALIZAR VENDA'}
            </button>
          </footer>
        </div>
      )}
      {noteOpen && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/80 p-4">
          <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#1a1816] p-6">
            <h2 className="text-2xl font-black">Nota do pedido</h2>
            <p className="mt-2 text-sm text-[#c8bfb0]">
              Sai na comanda da cozinha. Ex.: sem cebola, para levar, cliente aguarda.
            </p>
            <textarea
              value={orderNote}
              onChange={(event) => setOrderNote(event.target.value)}
              placeholder="Escreve a nota"
              className="mt-4 min-h-28 w-full rounded-2xl border border-white/10 bg-black/30 p-4 text-white outline-none focus:border-[#e5a93c]"
            />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setOrderNote('');
                  setNoteOpen(false);
                }}
                className="min-h-16 rounded-2xl bg-white/10 font-black active:bg-white/20"
              >
                Apagar
              </button>
              <button
                type="button"
                onClick={() => setNoteOpen(false)}
                className="min-h-16 rounded-2xl bg-[#e5a93c] font-black text-black active:scale-[0.98]"
              >
                Guardar
              </button>
            </div>
          </section>
        </div>
      )}

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
