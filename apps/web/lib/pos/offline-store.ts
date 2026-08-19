import { z } from 'zod';

const DATABASE_NAME = 'hawsmash-pos';
const DATABASE_VERSION = 1;
const MENU_STORE = 'menu';

export const MENU_REFRESH_MS = 120_000;

const menuItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  price_cents: z.number().int().nonnegative(),
  available: z.boolean().optional(),
});

const menuCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  items: z.array(menuItemSchema),
});

const menuSchema = z.array(menuCategorySchema);

export type PosMenuItem = z.infer<typeof menuItemSchema>;
export type PosMenuCategory = z.infer<typeof menuCategorySchema>;

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
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir a cache do POS'));
  });
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
