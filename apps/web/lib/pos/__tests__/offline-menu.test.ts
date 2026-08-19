import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MENU_REFRESH_MS,
  clearPosOfflineDatabase,
  getCachedMenu,
  loadMenuWithFallback,
  writeCachedMenu,
  type PosMenuCategory,
} from '../offline-store';

const maputoMenu: PosMenuCategory[] = [
  {
    id: 'burgers',
    name: 'Smash burgers',
    station: 'kitchen',
    items: [
      {
        id: 'classic',
        name: 'Classic Smash',
        description: null,
        price_cents: 30000,
        available: true,
        station: 'kitchen',
      },
    ],
  },
];

afterEach(async () => {
  await clearPosOfflineDatabase();
});

describe('cache offline do cardápio do POS', () => {
  it('guarda preços inteiros por loja sem misturar Maputo e Matola', async () => {
    await writeCachedMenu('maputo', maputoMenu, 1000);
    await writeCachedMenu(
      'matola',
      [{ ...maputoMenu[0], items: [{ ...maputoMenu[0].items[0], price_cents: 32000 }] }],
      2000,
    );

    expect((await getCachedMenu('maputo'))?.categories[0].items[0].price_cents).toBe(30000);
    expect((await getCachedMenu('matola'))?.categories[0].items[0].price_cents).toBe(32000);
  });

  it('refresca online e usa exactamente o registo persistido quando a rede falha', async () => {
    const onlineFetch = vi.fn().mockResolvedValue(maputoMenu);
    const online = await loadMenuWithFallback('maputo', onlineFetch, 5000);

    expect(online).toEqual({ categories: maputoMenu, source: 'network', refreshedAt: 5000 });
    expect(await getCachedMenu('maputo')).toEqual({
      storeSlug: 'maputo',
      categories: maputoMenu,
      refreshedAt: 5000,
    });

    const offlineFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const offline = await loadMenuWithFallback('maputo', offlineFetch, 9000);

    expect(offline).toEqual({ categories: maputoMenu, source: 'cache', refreshedAt: 5000 });
    expect(offlineFetch).toHaveBeenCalledOnce();
  });

  it('fixa o intervalo de atualização em dois minutos e falha sem cache inicial', async () => {
    expect(MENU_REFRESH_MS).toBe(120_000);
    await expect(
      loadMenuWithFallback('maputo', async () => {
        throw new TypeError('offline');
      }),
    ).rejects.toThrow('Cardápio offline indisponível');
  });
});
