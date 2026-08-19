'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * Lógica do carrinho — agnóstica de design.
 * Guarda { menuItemId, qty, notes, variantId?, addonIds? } em localStorage['cart']
 * (a mesma forma que /checkout lê).
 *
 * DECISÃO (F8): a partir dos Tamanhos/Adicionais, uma linha é identificada pela
 * ASSINATURA = menuItemId + variantId + addonIds ordenados. O mesmo produto com
 * tamanhos/adicionais diferentes = linhas separadas. O preço continua a ser a
 * verdade do servidor (create_order recalcula); aqui só guardamos as escolhas.
 */

/** Escolhas de um grupo de modificadores (acompanhamentos, molho, tipo de ovo…). */
export interface CartModifier {
  groupId: string;
  optionIds: string[];
}

export interface CartLine {
  menuItemId: string;
  qty: number;
  notes?: string;
  variantId?: string;
  addonIds?: string[];
  modifiers?: CartModifier[];
}

const KEY = 'cart';

// Parte da assinatura referente às escolhas: ordenada, para que a mesma
// selecção feita por ordens diferentes conte como a MESMA linha.
function modifierSignature(modifiers?: CartModifier[]): string {
  if (!modifiers?.length) return '';
  return modifiers
    .map((m) => `${m.groupId}:${m.optionIds.slice().sort().join('+')}`)
    .sort()
    .join(';');
}

// Assinatura estável de uma linha (para juntar iguais e distinguir escolhas).
export function lineSignature(
  line: Pick<CartLine, 'menuItemId' | 'variantId' | 'addonIds' | 'modifiers'>,
): string {
  const addons = (line.addonIds ?? []).slice().sort().join(',');
  return `${line.menuItemId}|${line.variantId ?? ''}|${addons}|${modifierSignature(line.modifiers)}`;
}

// Linha "simples" de um item (sem variante, adicionais nem escolhas).
const plainSignature = (menuItemId: string) => `${menuItemId}|||`;

export interface AddOptions {
  variantId?: string;
  addonIds?: string[];
  notes?: string;
  modifiers?: CartModifier[];
}

export function useCart() {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // hidratar do localStorage no mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setCart(JSON.parse(saved));
    } catch {
      /* ignora JSON corrompido */
    }
    setHydrated(true);
  }, []);

  // persistir (só depois de hidratar, para não apagar o carrinho guardado)
  useEffect(() => {
    if (hydrated) localStorage.setItem(KEY, JSON.stringify(cart));
  }, [cart, hydrated]);

  const add = useCallback((menuItemId: string, qty = 1, opts: AddOptions = {}) => {
    const incoming: CartLine = {
      menuItemId,
      qty,
      ...(opts.variantId ? { variantId: opts.variantId } : {}),
      ...(opts.addonIds && opts.addonIds.length ? { addonIds: opts.addonIds } : {}),
      ...(opts.modifiers && opts.modifiers.length ? { modifiers: opts.modifiers } : {}),
      ...(opts.notes ? { notes: opts.notes } : {}),
    };
    const sig = lineSignature(incoming);
    setCart((prev) => {
      const existing = prev.find((l) => lineSignature(l) === sig);
      if (existing) {
        return prev.map((l) => (lineSignature(l) === sig ? { ...l, qty: l.qty + qty } : l));
      }
      return [...prev, incoming];
    });
  }, []);

  // Operações por índice — para o drawer, onde variantes do mesmo item coexistem.
  const setQtyByIndex = useCallback((index: number, qty: number) => {
    setCart((prev) =>
      qty <= 0
        ? prev.filter((_, i) => i !== index)
        : prev.map((l, i) => (i === index ? { ...l, qty } : l))
    );
  }, []);

  const removeByIndex = useCallback(
    (index: number) => setCart((prev) => prev.filter((_, i) => i !== index)),
    []
  );

  // Operações por menuItemId — agem na linha SIMPLES (sem variante/adicionais).
  // Mantêm os cards de itens simples a funcionar como antes.
  const setQty = useCallback((menuItemId: string, qty: number) => {
    const sig = plainSignature(menuItemId);
    setCart((prev) =>
      qty <= 0
        ? prev.filter((l) => lineSignature(l) !== sig)
        : prev.map((l) => (lineSignature(l) === sig ? { ...l, qty } : l))
    );
  }, []);

  const remove = useCallback(
    (menuItemId: string) =>
      setCart((prev) => prev.filter((l) => lineSignature(l) !== plainSignature(menuItemId))),
    []
  );

  const clear = useCallback(() => setCart([]), []);

  // qty da linha simples (o que os cards mostram); itens com opções usam o ecrã de produto.
  const qtyOf = useCallback(
    (menuItemId: string) =>
      cart.find((l) => lineSignature(l) === plainSignature(menuItemId))?.qty ?? 0,
    [cart]
  );

  const count = cart.reduce((s, l) => s + l.qty, 0);

  return { cart, hydrated, add, setQty, setQtyByIndex, removeByIndex, remove, clear, qtyOf, count };
}
