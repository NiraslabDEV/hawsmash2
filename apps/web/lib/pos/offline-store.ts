import { z } from 'zod';

const DATABASE_NAME = 'hawsmash-pos';
const DATABASE_VERSION = 2;
const MENU_STORE = 'menu';
const SALES_STORE = 'sales';
const COUNTERS_STORE = 'counters';

export const MENU_REFRESH_MS = 120_000;

const rawMenuVariantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  price_cents: z.number().int().nonnegative(),
  photo_url: z.string().nullable().optional(),
  is_default: z.boolean().optional(),
});

const rawMenuItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  photo_url: z.string().nullable().optional(),
  price_cents: z.number().int().nonnegative(),
  available: z.boolean().optional(),
  track_stock: z.boolean().optional(),
  stock_qty: z.number().int().nonnegative().nullable().optional(),
  // O funil de upsell do balcão precisa destes dois. Sem eles o Zod deitava-os
  // fora em silêncio — foi o que aconteceu ao photo_url e por isso o POS nunca
  // teve fotos. Ficam também na cache IndexedDB, logo o funil funciona offline.
  is_upsell: z.boolean().optional(),
  variants: z.array(rawMenuVariantSchema).optional(),
});

const rawMenuCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  station: z.enum(['kitchen', 'cold_kitchen', 'bar']).default('kitchen'),
  items: z.array(rawMenuItemSchema),
});

const menuSchema = z.array(rawMenuCategorySchema).transform((categories) =>
  categories.map((category) => ({
    ...category,
    items: category.items.map((item) => ({
      ...item,
      station: category.station === 'cold_kitchen' ? ('kitchen' as const) : category.station,
    })),
  })),
);

export type PosMenuCategory = z.infer<typeof menuSchema>[number];
export type PosMenuItem = PosMenuCategory['items'][number];

export type PosItemAvailability = {
  sellable: boolean;
  badge: string | null;
};

/**
 * O POS mostra o esgotado a cinzento em vez de o fazer desaparecer a meio do
 * turno. O stock que chega aqui é o da loja do terminal (store_items).
 */
export function posItemAvailability(item: PosMenuItem): PosItemAvailability {
  const tracked = item.track_stock === true && typeof item.stock_qty === 'number';
  if (item.available === false || (tracked && (item.stock_qty as number) <= 0)) {
    return { sellable: false, badge: 'ESGOTADO' };
  }
  if (tracked) {
    return { sellable: true, badge: `Restam ${item.stock_qty}` };
  }
  return { sellable: true, badge: null };
}

const paymentMethodSchema = z.enum(['cash', 'mpesa', 'emola', 'credit_card']);

export type OfflineSaleDraft = {
  clientSaleId: string;
  deviceId: string;
  storeSlug: string;
  storeName: string;
  createdAt: string;
  items: Array<{
    menuItemId: string;
    name: string;
    qty: number;
    unitPriceCents: number;
    station: 'kitchen' | 'bar';
  }>;
  payments: Array<{ method: z.infer<typeof paymentMethodSchema>; amountCents: number }>;
  cashReceivedCents?: number;
  totalCents: number;
};

export type OfflineSale = OfflineSaleDraft & {
  localNumber: number;
  localOrderNumber: string;
  status: 'pending';
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  localPrint: { receipt: boolean; drawer: boolean; stations: Array<'kitchen' | 'bar'> };
};

const offlineSaleDraftSchema: z.ZodType<OfflineSaleDraft> = z.object({
  clientSaleId: z.string().uuid(),
  deviceId: z.string().uuid(),
  storeSlug: z.string().min(1),
  storeName: z.string().min(1),
  createdAt: z.string().datetime(),
  items: z.array(z.object({
    menuItemId: z.string().uuid(),
    name: z.string().min(1),
    qty: z.number().int().positive(),
    unitPriceCents: z.number().int().nonnegative(),
    station: z.enum(['kitchen', 'bar']),
  })).min(1),
  payments: z.array(z.object({
    method: paymentMethodSchema,
    amountCents: z.number().int().positive(),
  })).min(1),
  cashReceivedCents: z.number().int().nonnegative().optional(),
  totalCents: z.number().int().positive(),
});

export type CachedMenu = {
  storeSlug: string;
  categories: PosMenuCategory[];
  refreshedAt: number;
};

type MenuLoadResult = Omit<CachedMenu, 'storeSlug'> & { source: 'network' | 'cache' };

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Falha na IndexedDB do POS'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MENU_STORE)) {
        database.createObjectStore(MENU_STORE, { keyPath: 'storeSlug' });
      }
      if (!database.objectStoreNames.contains(SALES_STORE)) {
        database.createObjectStore(SALES_STORE, { keyPath: 'clientSaleId' });
      }
      if (!database.objectStoreNames.contains(COUNTERS_STORE)) {
        database.createObjectStore(COUNTERS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir a cache do POS'));
  });
}

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Falha na fila offline do POS'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Operação offline cancelada'));
  });
}

function maputoDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Maputo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function storePrefix(storeSlug: string): string {
  if (storeSlug === 'maputo') return 'MPT';
  if (storeSlug === 'matola') return 'MAT';
  return storeSlug.replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase().padEnd(3, 'X');
}

export async function enqueueOfflineSale(input: OfflineSaleDraft): Promise<OfflineSale> {
  const draft = offlineSaleDraftSchema.parse(input);
  const database = await openDatabase();
  try {
    const transaction = database.transaction([SALES_STORE, COUNTERS_STORE], 'readwrite');
    const sales = transaction.objectStore(SALES_STORE);
    const existing = await requestResult<OfflineSale | undefined>(sales.get(draft.clientSaleId));
    if (existing) return existing;

    const counterId = `${draft.storeSlug}:${maputoDay(draft.createdAt)}`;
    const counters = transaction.objectStore(COUNTERS_STORE);
    const counter = await requestResult<{ id: string; count: number } | undefined>(counters.get(counterId));
    const localNumber = (counter?.count ?? 0) + 1;
    const sale: OfflineSale = {
      ...draft,
      localNumber,
      localOrderNumber: `${storePrefix(draft.storeSlug)}-OFF-${String(localNumber).padStart(3, '0')}`,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null,
      localPrint: { receipt: false, drawer: false, stations: [] },
    };
    counters.put({ id: counterId, count: localNumber });
    sales.put(sale);
    await transactionResult(transaction);
    return sale;
  } finally {
    database.close();
  }
}

export async function getOfflineSale(clientSaleId: string): Promise<OfflineSale | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SALES_STORE, 'readonly');
    return (await requestResult<OfflineSale | undefined>(
      transaction.objectStore(SALES_STORE).get(clientSaleId),
    )) ?? null;
  } finally {
    database.close();
  }
}

export async function listOfflineSales(): Promise<OfflineSale[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SALES_STORE, 'readonly');
    const sales = await requestResult<OfflineSale[]>(transaction.objectStore(SALES_STORE).getAll());
    return sales.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  } finally {
    database.close();
  }
}

export async function updateOfflineSale(sale: OfflineSale): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SALES_STORE, 'readwrite');
    transaction.objectStore(SALES_STORE).put(sale);
    await transactionResult(transaction);
  } finally {
    database.close();
  }
}

export async function removeOfflineSale(clientSaleId: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SALES_STORE, 'readwrite');
    transaction.objectStore(SALES_STORE).delete(clientSaleId);
    await transactionResult(transaction);
  } finally {
    database.close();
  }
}

export async function getCachedMenu(storeSlug: string): Promise<CachedMenu | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(MENU_STORE, 'readonly');
    const record = await requestResult<CachedMenu | undefined>(
      transaction.objectStore(MENU_STORE).get(storeSlug),
    );
    if (!record) return null;
    return { ...record, categories: menuSchema.parse(record.categories) };
  } finally {
    database.close();
  }
}

export async function writeCachedMenu(
  storeSlug: string,
  categories: PosMenuCategory[],
  refreshedAt = Date.now(),
): Promise<CachedMenu> {
  const record: CachedMenu = {
    storeSlug,
    categories: menuSchema.parse(categories),
    refreshedAt,
  };
  const database = await openDatabase();
  try {
    const transaction = database.transaction(MENU_STORE, 'readwrite');
    await requestResult(transaction.objectStore(MENU_STORE).put(record));
    return record;
  } finally {
    database.close();
  }
}

export async function loadMenuWithFallback(
  storeSlug: string,
  fetchMenu: () => Promise<unknown>,
  now = Date.now(),
): Promise<MenuLoadResult> {
  try {
    const categories = menuSchema.parse(await fetchMenu());
    const saved = await writeCachedMenu(storeSlug, categories, now);
    return { categories: saved.categories, refreshedAt: saved.refreshedAt, source: 'network' };
  } catch (networkError) {
    const cached = await getCachedMenu(storeSlug);
    if (cached) {
      return { categories: cached.categories, refreshedAt: cached.refreshedAt, source: 'cache' };
    }
    throw new Error('Cardápio offline indisponível. Liga o POS à internet para a primeira carga.', {
      cause: networkError,
    });
  }
}

export async function clearPosOfflineDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Não foi possível limpar a cache do POS'));
    request.onblocked = () => reject(new Error('A cache do POS está em utilização'));
  });
}
