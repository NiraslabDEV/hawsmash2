'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { formatMT, type Cents } from '@delivery/core';
import { brand } from '@brand';

import { useCart } from '@/utils/useCart';
import { useStoreSlug } from '@/utils/useStore';
import { trackAddToCart } from '@/lib/analytics/track';
import { alreadyServed, companionOffers, upgradeOffers, upsellDecision } from '@/lib/upsell';

import '../_hawsmash/landing.css';
import { ArrowIcon, CartIcon } from '../_hawsmash/icons';
import type { MenuItem, MenuPayload, MenuVariant } from '../_hawsmash/types';

const L = brand.storefront.landing;
const mt = (value: number) => formatMT(value as Cents);

/** Sabor por omissão de um item (o marcado, senão o primeiro). */
function defaultVariant(item: MenuItem): MenuVariant | null {
  const variants = (item.variants ?? []).filter((v) => v.available !== false);
  if (!variants.length) return null;
  return variants.find((v) => v.is_default) ?? variants[0];
}

/**
 * Upsell — o ecrã entre o carrinho e o pagamento.
 *
 * Regra que manda em tudo: **nunca bloqueia a venda**. Se não houver nada para
 * oferecer, se o dono tiver o upsell desligado ou se o cliente já tiver bebida
 * no carrinho, este ecrã salta sozinho para o pagamento sem ninguém dar por ele.
 * A decisão está em `lib/upsell.ts`, testada à parte.
 */
export default function UpsellPage() {
  const router = useRouter();
  const storeSlug = useStoreSlug();
  const { cart, hydrated, add, setQtyByIndex, setLineVariantByIndex, count } = useCart();

  // Sabores escolhidos nos cartões de acompanhamento, antes de somar ao carrinho.
  const [flavours, setFlavours] = useState<Record<string, string>>({});
  // Subidas de gama marcadas: só entram no carrinho no "Continuar", para o ecrã
  // não se reordenar debaixo do dedo a cada toque.
  const [upgrades, setUpgrades] = useState<Record<number, boolean>>({});

  const { data, isLoading } = useQuery<MenuPayload>({
    queryKey: ['menu', storeSlug],
    queryFn: async () => {
      const response = await fetch(`/api/menu?channel=delivery&store=${encodeURIComponent(storeSlug)}`);
      if (!response.ok) throw new Error('Não foi possível carregar o cardápio.');
      return response.json();
    },
    staleTime: 60_000,
  });

  const items = useMemo(
    () => (data?.categories ?? []).flatMap((category) => category.items),
    [data],
  );

  const offers = useMemo(() => upgradeOffers(cart, items), [cart, items]);
  const companions = useMemo(() => companionOffers(cart, items), [cart, items]);
  const served = useMemo(() => alreadyServed(cart, items), [cart, items]);

  const ready = hydrated && !isLoading && Boolean(data);
  const decision = upsellDecision({
    ready,
    enabled: data?.upsell_enabled ?? true,
    cartLength: cart.length,
    upgrades: offers.length,
    companions: companions.length,
    served,
  });

  useEffect(() => {
    if (decision === 'store') router.replace(`/l/${storeSlug}`);
    if (decision === 'checkout') router.replace('/checkout');
  }, [decision, router, storeSlug]);

  // Total de pré-visualização, já com as subidas de gama marcadas. O servidor
  // recalcula tudo no create_order — isto é só para o cliente ver o efeito.
  const previewTotal = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    return cart.reduce((sum, line, index) => {
      const item = byId.get(line.menuItemId);
      if (!item) return sum;
      const offer = offers.find((o) => o.index === index);
      const chosen = (item.variants ?? []).find((v) => v.id === line.variantId);
      const unit = upgrades[index] && offer
        ? offer.better.price_cents
        : chosen?.price_cents ?? item.price_cents;
      return sum + unit * line.qty;
    }, 0);
  }, [cart, items, offers, upgrades]);

  const addCompanion = useCallback(
    (item: MenuItem) => {
      const variants = (item.variants ?? []).filter((v) => v.available !== false);
      const chosenId = flavours[item.id];
      const variant = variants.find((v) => v.id === chosenId) ?? defaultVariant(item);
      add(item.id, 1, variant ? { variantId: variant.id } : {});
      trackAddToCart({
        id: item.id,
        name: item.name,
        price_cents: variant?.price_cents ?? item.price_cents,
        qty: 1,
      });
    },
    [add, flavours],
  );

  const handleContinue = useCallback(() => {
    // Aplica as subidas de gama de baixo para cima: mudar uma linha pode
    // juntá-la a outra e mexer nos índices seguintes.
    const chosen = offers.filter((offer) => upgrades[offer.index]).sort((a, b) => b.index - a.index);
    for (const offer of chosen) {
      setLineVariantByIndex(offer.index, offer.better.id);
      trackAddToCart({
        id: `${offer.item.id}:${offer.better.id}`,
        name: `${offer.item.name} — ${offer.better.name}`,
        price_cents: offer.extraCents,
        qty: offer.qty,
      });
    }
    router.push('/checkout');
  }, [offers, router, setLineVariantByIndex, upgrades]);

  if (decision !== 'show') {
    return (
      <div className="hs hs-upsell" style={{ minHeight: '100vh' }}>
        <div className="hs-upsell-loading">A preparar o teu pedido…</div>
      </div>
    );
  }

  return (
    <div className="hs hs-upsell">
      <nav className="hs-nav is-scrolled">
        <div className="hs-container hs-nav-inner">
          <button
            type="button"
            className="hs-cart-btn"
            aria-label="Voltar ao cardápio"
            onClick={() => router.push(`/l/${storeSlug}`)}
          >
            <span style={{ transform: 'rotate(180deg)', display: 'grid' }}>
              <ArrowIcon size={18} />
            </span>
          </button>
          <span className="hs-brand-name">{L.wordmark}</span>
          <span className="hs-store-pill" aria-hidden>
            <CartIcon size={16} />
            {count}
          </span>
        </div>
      </nav>

      <main className="hs-container hs-upsell-main">
        <header className="hs-upsell-head">
          <span className="hs-eyebrow">Antes de fechar</span>
          <h1>{data?.upsell_title ?? 'Falta alguma coisa?'}</h1>
          <p>{data?.upsell_subtitle ?? 'Uma bebida gelada cai sempre bem com o smash.'}</p>
        </header>

        {offers.length > 0 && (
          <section className="hs-upsell-block">
            <h2>{offers.length > 1 ? 'Sobe os teus burgers' : 'Sobe o teu burger'}</h2>

            {offers.map((offer) => {
              const on = Boolean(upgrades[offer.index]);
              return (
                <article key={`${offer.item.id}-${offer.index}`} className={`hs-upgrade${on ? ' is-on' : ''}`}>
                  {offer.item.photo_url && (
                    <Image src={offer.item.photo_url} alt="" width={96} height={96} />
                  )}
                  <div className="hs-upgrade-text">
                    <h3>
                      {offer.item.name}
                      {offer.qty > 1 && <span className="qty"> ×{offer.qty}</span>}
                    </h3>
                    <p>
                      {offer.current.name} <span aria-hidden>→</span>{' '}
                      <strong>{offer.better.name}</strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`hs-upgrade-btn${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    aria-label={`Passar ${offer.item.name} para ${offer.better.name}`}
                    onClick={() =>
                      setUpgrades((prev) => ({ ...prev, [offer.index]: !prev[offer.index] }))
                    }
                  >
                    {on ? '✓ Adicionado' : `+ ${mt(offer.extraCents)}`}
                  </button>
                </article>
              );
            })}
          </section>
        )}

        {companions.length > 0 && (
          <section className="hs-upsell-block">
            <h2>Para acompanhar</h2>

            <div className="hs-upsell-grid">
              {companions.map((raw) => {
                const item = raw as MenuItem;
                const variants = (item.variants ?? []).filter((v) => v.available !== false);
                const chosen =
                  variants.find((v) => v.id === flavours[item.id]) ?? defaultVariant(item);
                const photo = chosen?.photo_url ?? item.photo_url;
                const inCart = cart.findIndex(
                  (line) =>
                    line.menuItemId === item.id && (line.variantId ?? null) === (chosen?.id ?? null),
                );
                const qty = inCart < 0 ? 0 : cart[inCart].qty;

                return (
                  <article key={item.id} className="hs-upsell-card">
                    <div className="hs-upsell-photo">
                      {photo && (
                        <Image
                          src={photo}
                          alt={item.name}
                          width={220}
                          height={220}
                          sizes="(max-width: 640px) 45vw, 220px"
                        />
                      )}
                    </div>

                    <h3>{item.name}</h3>

                    {variants.length > 1 && (
                      <div className="hs-flavours" role="group" aria-label={`Sabor de ${item.name}`}>
                        {variants.map((variant) => (
                          <button
                            key={variant.id}
                            type="button"
                            className={`hs-flavour${chosen?.id === variant.id ? ' is-active' : ''}`}
                            aria-pressed={chosen?.id === variant.id}
                            onClick={() => setFlavours((prev) => ({ ...prev, [item.id]: variant.id }))}
                          >
                            {variant.name}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="hs-upsell-foot">
                      <span className="hs-upsell-price">
                        {mt(chosen?.price_cents ?? item.price_cents)}
                      </span>
                      {qty === 0 ? (
                        <button
                          type="button"
                          className="hs-chip-add"
                          aria-label={`Adicionar ${item.name}`}
                          onClick={() => addCompanion(item)}
                        >
                          + Juntar
                        </button>
                      ) : (
                        <span className="hs-chip-qty">
                          <button
                            type="button"
                            aria-label={`Menos um ${item.name}`}
                            onClick={() => setQtyByIndex(inCart, qty - 1)}
                          >
                            −
                          </button>
                          <span>{qty}</span>
                          <button
                            type="button"
                            aria-label={`Mais um ${item.name}`}
                            onClick={() => setQtyByIndex(inCart, qty + 1)}
                          >
                            +
                          </button>
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </main>

      <div className="hs-upsell-cta">
        <button type="button" className="hs-btn hs-btn-gold" onClick={handleContinue}>
          Continuar para o pagamento <span className="total">· {mt(previewTotal)}</span>
        </button>
      </div>
    </div>
  );
}
