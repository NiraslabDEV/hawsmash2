'use client';

import { useEffect } from 'react';

import { serializeStoreCookie } from '@/lib/store-context';

/**
 * Guarda a loja escolhida no cookie `hs_store`. É uma preferência, não um
 * segredo: fica legível ao cliente e válida 30 dias (CLAUDE §5.5).
 */
export function RememberStore({ slug }: { slug: string }) {
  useEffect(() => {
    try {
      document.cookie = serializeStoreCookie(slug);
    } catch {
      // Slug inválido nunca chega aqui (a rota valida antes); se chegar, a loja
      // continua a funcionar sem memorizar a escolha.
    }
  }, [slug]);

  return null;
}
