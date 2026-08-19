'use client';

import { useEffect, useState } from 'react';

import { DEFAULT_STORE_SLUG, parseStoreCookie } from '@/lib/store-context';

function readSlug(): string {
  if (typeof document === 'undefined') return DEFAULT_STORE_SLUG;
  return parseStoreCookie(document.cookie) ?? DEFAULT_STORE_SLUG;
}

/**
 * Loja escolhida pelo cliente (cookie `hs_store`). Tudo o que o checkout mostra
 * — zonas, taxas, horários e números de pagamento — vem desta loja.
 */
export function useStoreSlug(): string {
  const [slug, setSlug] = useState<string>(readSlug);

  useEffect(() => {
    setSlug(readSlug());
  }, []);

  return slug;
}
