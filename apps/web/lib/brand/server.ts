import { createClient } from '@supabase/supabase-js';

import { brand as factory } from '@brand';
import { resolveBrand, type BrandRow, type ResolvedBrand } from './resolve';

/**
 * A marca, em runtime, do lado do servidor.
 *
 * Contrato inegociável: **isto nunca lança e nunca devolve vazio**. Se a base
 * de dados estiver em baixo, se a env faltar, se a RPC mudar de forma — a loja
 * abre com a marca de fábrica em vez de abrir com um erro. A identidade é
 * importante; não é mais importante do que a loja estar de pé (CLAUDE.md §1).
 */

/** Quanto tempo o servidor guarda a marca antes de voltar a perguntar. */
const TTL_MS = 60_000;

type CacheEntry = { brand: ResolvedBrand; expiresAt: number };
let cached: CacheEntry | null = null;

/**
 * Resolve a marca a partir de um leitor qualquer. Separado de `getBrand()`
 * para o caminho de falha ser testável sem base de dados.
 */
export async function loadBrand(read: () => Promise<BrandRow | null>): Promise<ResolvedBrand> {
  try {
    return resolveBrand(factory, await read());
  } catch (error) {
    console.error('Marca: falha a ler brand_settings, a servir o fallback de fábrica.', error);
    return resolveBrand(factory, null);
  }
}

async function readFromDatabase(): Promise<BrandRow | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.rpc('get_brand');
  if (error) throw error;
  return (data as BrandRow | null) ?? null;
}

/**
 * A marca resolvida, com cache curta em memória do servidor.
 *
 * A cache existe porque isto é lido em todos os layouts, em todos os pedidos;
 * é curta porque o dono que muda a cor no painel quer ver o resultado antes de
 * desconfiar do sistema.
 */
export async function getBrand(): Promise<ResolvedBrand> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.brand;

  const brand = await loadBrand(readFromDatabase);
  cached = { brand, expiresAt: now + TTL_MS };
  return brand;
}

/** Usado pela aba Aparência depois de gravar, para o painel não mentir. */
export function invalidateBrandCache(): void {
  cached = null;
}
