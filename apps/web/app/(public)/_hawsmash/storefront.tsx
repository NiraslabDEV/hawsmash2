'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { brand } from '@brand';

import { useCart } from '@/utils/useCart';
import { CART_STORE_KEY, shouldClearCart } from '@/lib/cart-store';
import { serializeStoreCookie } from '@/lib/store-context';
import { trackAddToCart, trackBeginCheckout, trackViewMenu } from '@/lib/analytics/track';
import type { PublicStoreOption } from '@/lib/public-stores';

import './landing.css';
import { CartDrawer, StoreSwitchDialog } from './cart-drawer';
import { CartIcon, MenuIcon, StoreIcon } from './icons';
import { MenuBanners } from './menu-banners';
import { Footer, Hero, Marquee, Story } from './sections';
import type { CartView, MenuItem, MenuPayload, MenuVariant } from './types';

const L = brand.storefront.landing;

/**
 * Loja pública do HAWSMASH — a pele do 1.0 sobre o motor do 2.0.
 *
 * O que é do 1.0: o desenho (hero, marquee, banners laranja/preto, caixa de
 * preço com HAW/WAGYU, rodapé). O que é do 2.0 e não se toca: o carrinho
 * (`useCart` → localStorage['cart'], lido pelo /checkout), o cardápio vindo de
 * `get_menu` por loja e o tracking. Preço, stock e horário são do servidor.
 */
export function Storefront({
  store,
  stores,
}: {
  store: PublicStoreOption;
  stores: PublicStoreOption[];
}) {
  const router = useRouter();
  const { cart, hydrated, add, setQtyByIndex, clear, count } = useCart();

  const [scrolled, setScrolled] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const { data } = useQuery<MenuPayload>({
    queryKey: ['menu', store.slug],
    queryFn: async () => {
      const response = await fetch(`/api/menu?channel=delivery&store=${encodeURIComponent(store.slug)}`);
      if (!response.ok) throw new Error('Não foi possível carregar o cardápio.');
      return response.json();
    },
    // O cardápio muda quando o dono mexe no stock: 60 s é o suficiente para o
    // esgotado aparecer sem martelar o servidor.
    staleTime: 60_000,
  });

  const categories = useMemo(() => data?.categories ?? [], [data]);
  // A loja fecha por duas vias: o interruptor do painel e o horário.
  const acceptingOrders = (data?.accepting_orders ?? store.accepting_orders) && store.accepting_orders;

  // O carrinho pertence a uma loja. Trocar pelo diálogo já o esvazia, mas
  // ninguém garante que se chega aqui por aí: link partilhado, histórico do
  // browser ou o ecrã de escolha. Preço, stock e taxas são de outra unidade,
  // por isso a regra vale à chegada (CLAUDE §5.5) e não só no botão.
  useEffect(() => {
    if (!hydrated) return;
    const owner = window.localStorage.getItem(CART_STORE_KEY);
    if (owner === store.slug) return;
    if (shouldClearCart(owner, store.slug, window.localStorage.getItem('cart'))) {
      clear();
      setToast('Carrinho esvaziado: era de outra loja');
    }
    window.localStorage.setItem(CART_STORE_KEY, store.slug);
  }, [clear, hydrated, store.slug]);

  // Nav ganha fundo depois do hero (igual ao 1.0).
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const flatItems = useMemo(
    () => categories.flatMap((category) => category.items),
    [categories],
  );

  useEffect(() => {
    if (!flatItems.length) return;
    trackViewMenu(
      flatItems.map((item) => ({ id: item.id, name: item.name, price_cents: item.price_cents })),
    );
  }, [flatItems]);

  /* ── carrinho ─────────────────────────────────────────────── */

  const indexOfLine = useCallback(
    (itemId: string, variantId: string | null) =>
      cart.findIndex(
        (line) => line.menuItemId === itemId && (line.variantId ?? null) === variantId,
      ),
    [cart],
  );

  const qtyFor = useCallback(
    (item: MenuItem, variant: MenuVariant | null) => {
      const index = indexOfLine(item.id, variant?.id ?? null);
      return index < 0 ? 0 : cart[index].qty;
    },
    [cart, indexOfLine],
  );

  const handleAdd = useCallback(
    (item: MenuItem, variant: MenuVariant | null) => {
      add(item.id, 1, variant ? { variantId: variant.id } : {});
      trackAddToCart({
        id: item.id,
        name: item.name,
        price_cents: variant?.price_cents ?? item.price_cents,
        qty: 1,
      });
      setToast(`${item.name}${variant ? ` · ${variant.name}` : ''} no carrinho`);
    },
    [add],
  );

  const step = useCallback(
    (item: MenuItem, variant: MenuVariant | null, delta: number) => {
      const index = indexOfLine(item.id, variant?.id ?? null);
      if (index < 0) {
        if (delta > 0) handleAdd(item, variant);
        return;
      }
      setQtyByIndex(index, cart[index].qty + delta);
    },
    [cart, handleAdd, indexOfLine, setQtyByIndex],
  );

  // Linhas do carrinho cruzadas com o cardápio — o drawer mostra nome, foto e
  // preço unitário do servidor, nunca um preço guardado no browser.
  const lines = useMemo<CartView[]>(() => {
    const byId = new Map(flatItems.map((item) => [item.id, item]));
    return cart.flatMap((line, index) => {
      const item = byId.get(line.menuItemId);
      if (!item) return [];
      const variant = (item.variants ?? []).find((v) => v.id === line.variantId) ?? null;
      return [
        {
          index,
          item,
          variant,
          qty: line.qty,
          unitCents: variant?.price_cents ?? item.price_cents,
        },
      ];
    });
  }, [cart, flatItems]);

  const goToCheckout = useCallback(() => {
    trackBeginCheckout(
      lines.map((line) => ({
        id: line.item.id,
        name: line.item.name,
        price_cents: line.unitCents,
        qty: line.qty,
      })),
    );
    router.push('/checkout');
  }, [lines, router]);

  /* ── trocar de loja ───────────────────────────────────────── */

  const pickStore = useCallback(
    (slug: string) => {
      if (slug === store.slug) {
        setSwitchOpen(false);
        return;
      }
      // Stock, preços e taxas são de outra unidade: o carrinho não atravessa
      // a fronteira entre lojas (CLAUDE §5.5).
      clear();
      try {
        window.localStorage.setItem(CART_STORE_KEY, slug);
        document.cookie = serializeStoreCookie(slug);
      } catch {
        // Slug inválido não chega aqui; se chegasse, a navegação continua.
      }
      setSwitchOpen(false);
      setCartOpen(false);
      router.push(`/l/${slug}`);
    },
    [clear, router, store.slug],
  );

  const open = store.accepting_orders && store.open_now;

  return (
    <div className="hs hs-body-pad">
      {/* ── NAV ── */}
      <nav className={`hs-nav${scrolled ? ' is-scrolled' : ''}`}>
        <div className="hs-container hs-nav-inner">
          <a href="#topo" className="hs-brand">
            <span className="hs-brand-mark">
              <Image src={L.logoCircle} alt={brand.name} width={40} height={40} />
            </span>
            <span>
              <span className="hs-brand-name">{L.wordmark}</span>
              <span className="hs-brand-tag">{L.wordmarkTag}</span>
            </span>
          </a>

          <div className="hs-nav-right">
            <button
              type="button"
              className="hs-store-pill"
              onClick={() => setSwitchOpen(true)}
              aria-label="Trocar de loja"
            >
              <span className={`hs-store-dot${open ? '' : ' is-closed'}`} />
              {store.short_name}
            </button>

            <button
              type="button"
              className="hs-cart-btn"
              onClick={() => setCartOpen(true)}
              aria-label={`Abrir carrinho (${count})`}
            >
              <CartIcon />
              {count > 0 && <span className="hs-cart-count">{count}</span>}
            </button>
          </div>
        </div>
      </nav>

      <Hero store={store} cartCount={count} onCartOpen={() => setCartOpen(true)} />
      <Marquee />

      <MenuBanners
        categories={categories}
        acceptingOrders={acceptingOrders}
        qtyFor={qtyFor}
        onAdd={handleAdd}
        onInc={(item, variant) => step(item, variant, 1)}
        onDec={(item, variant) => step(item, variant, -1)}
      />

      <Story />
      <Footer store={store} cartCount={count} onCartOpen={() => setCartOpen(true)} />

      {/* ── BARRA MÓVEL ── */}
      <nav className="hs-mobbar" aria-label="Navegação rápida">
        <a href="#cardapio" className="hs-mobbtn">
          <MenuIcon />
          <span className="hs-mobbtn-label">Menu</span>
        </a>
        <button type="button" className="hs-mobbtn" onClick={() => setSwitchOpen(true)}>
          <StoreIcon />
          <span className="hs-mobbtn-label">{store.short_name}</span>
        </button>
        <button type="button" className="hs-mobbtn" onClick={() => setCartOpen(true)}>
          <CartIcon />
          {count > 0 && <span className="hs-mobbtn-count">{count}</span>}
          <span className="hs-mobbtn-label">Carrinho</span>
        </button>
      </nav>

      <CartDrawer
        open={cartOpen}
        lines={lines}
        storeName={store.short_name}
        canCheckout={acceptingOrders}
        onClose={() => setCartOpen(false)}
        onCheckout={goToCheckout}
        onInc={(line) => setQtyByIndex(line.index, line.qty + 1)}
        onDec={(line) => setQtyByIndex(line.index, line.qty - 1)}
      />

      {switchOpen && (
        <StoreSwitchDialog
          stores={stores}
          currentSlug={store.slug}
          onPick={pickStore}
          onClose={() => setSwitchOpen(false)}
        />
      )}

      {toast && (
        <div className="hs-toast" role="status">
          <CartIcon size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
