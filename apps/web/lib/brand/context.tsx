'use client';

import { createContext, useContext, type ReactNode } from 'react';

import { brand as factory } from '@brand';
import { resolveBrand, type ResolvedBrand } from './resolve';

/**
 * A marca do lado do cliente.
 *
 * O servidor resolve-a uma vez (layout raiz) e passa-a por aqui. Os
 * componentes do browser deixam de importar `@brand` — se importassem, a
 * identidade voltava a entrar no bundle em tempo de compilação e mudar a cor
 * no painel voltava a exigir um deploy (CLAUDE.md §18.2).
 *
 * O valor por omissão é a fábrica: um componente montado fora do provider
 * (teste, storybook, rota nova) renderiza na mesma.
 */
const BrandContext = createContext<ResolvedBrand>(resolveBrand(factory, null));

export function BrandProvider({ brand, children }: { brand: ResolvedBrand; children: ReactNode }) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useBrand(): ResolvedBrand {
  return useContext(BrandContext);
}
