'use client';

import { useState } from 'react';
import Image from 'next/image';
import { formatMT, type Cents } from '@delivery/core';
import { brand } from '@brand';

import { CartIcon } from './icons';
import type { MenuCategory, MenuItem, MenuVariant } from './types';

const L = brand.storefront.landing;

/** "400 MT" → ["400", "MT"], para o preço grande com a unidade pequena ao lado. */
function splitMT(cents: number): [string, string] {
  const text = formatMT(cents as Cents);
  const cut = text.lastIndexOf(' ');
  return [text.slice(0, cut), text.slice(cut + 1)];
}

/** Variante escolhida por omissão: a marcada como default, senão a primeira. */
function defaultVariant(item: MenuItem): MenuVariant | null {
  const variants = (item.variants ?? []).filter((v) => v.available !== false);
  if (!variants.length) return null;
  return variants.find((v) => v.is_default) ?? variants[0];
}

/* ───────────────────── caixa de preço ───────────────────── */

function PriceChip({
  item,
  variants,
  active,
  onPick,
  qty,
  disabled,
  onAdd,
  onDec,
  onInc,
}: {
  item: MenuItem;
  variants: MenuVariant[];
  active: MenuVariant | null;
  onPick: (variant: MenuVariant) => void;
  qty: number;
  disabled: boolean;
  onAdd: () => void;
  onDec: () => void;
  onInc: () => void;
}) {
  // O preço é sempre o do servidor: da variante quando há, do item quando não há.
  const [value, unit] = splitMT(active ? active.price_cents : item.price_cents);

  // WAGYU (ou qualquer variante mais cara que a primeira) ganha o brilho premium
  // do 1.0 — é o sinal visual de que se está a subir de gama.
  const premium = Boolean(active && variants.length > 1 && active.price_cents > variants[0].price_cents);

  return (
    <div className={`hs-chip${premium ? ' is-premium' : ''}`}>
      {variants.length > 1 && (
        <div className="hs-vtoggle" role="group" aria-label={`Opções de ${item.name}`}>
          {variants.map((variant) => {
            const isActive = active?.id === variant.id;
            const isPremium = variant.price_cents > variants[0].price_cents;
            return (
              <button
                key={variant.id}
                type="button"
                className={`hs-vtog${isActive ? ' is-active' : ''}${isActive && isPremium ? ' is-premium' : ''}`}
                aria-pressed={isActive}
                onClick={() => onPick(variant)}
              >
                {variant.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="hs-vrow">
        <span className="hs-vprice">
          {value}
          <i>{unit}</i>
        </span>

        {qty > 0 ? (
          <span className="hs-chip-qty">
            <button type="button" aria-label={`Menos um ${item.name}`} onClick={onDec}>
              −
            </button>
            <span>{qty}</span>
            <button type="button" aria-label={`Mais um ${item.name}`} onClick={onInc}>
              +
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="hs-chip-add"
            disabled={disabled}
            aria-label={`Adicionar ${item.name}`}
            onClick={onAdd}
          >
            <CartIcon size={14} />
            Adicionar
          </button>
        )}
      </div>
    </div>
  );
}

/* ───────────────────── banner de um produto ───────────────────── */

function Banner({
  item,
  index,
  acceptingOrders,
  qtyFor,
  onAdd,
  onDec,
  onInc,
}: {
  item: MenuItem;
  index: number;
  acceptingOrders: boolean;
  qtyFor: (item: MenuItem, variant: MenuVariant | null) => number;
  onAdd: (item: MenuItem, variant: MenuVariant | null) => void;
  onDec: (item: MenuItem, variant: MenuVariant | null) => void;
  onInc: (item: MenuItem, variant: MenuVariant | null) => void;
}) {
  const variants = (item.variants ?? []).filter((v) => v.available !== false);
  const [chosen, setChosen] = useState<MenuVariant | null>(() => defaultVariant(item));
  const active = variants.length ? (chosen ?? variants[0]) : null;

  // Foto do sabor escolhido (bebidas do 1.0: cada sabor tem a sua lata).
  const photo = active?.photo_url ?? item.photo_url;
  const soldOut = item.available === false;

  return (
    <article className={`hs-banner ${index % 2 === 0 ? 'is-orange' : 'is-dark'}`}>
      <div className="hs-bn-photo">
        <span className="hs-bn-board" aria-hidden />
        {photo && (
          <Image
            key={photo}
            src={photo}
            alt={item.name}
            width={400}
            height={400}
            sizes="(max-width: 900px) 78vw, 400px"
          />
        )}
      </div>

      <div className="hs-bn-info">
        <h3 className="hs-bn-name">{item.name}</h3>
        {item.description && <p className="hs-bn-ing">{item.description}</p>}
        <PriceChip
          item={item}
          variants={variants}
          active={active}
          onPick={setChosen}
          qty={qtyFor(item, active)}
          disabled={!acceptingOrders || soldOut}
          onAdd={() => onAdd(item, active)}
          onDec={() => onDec(item, active)}
          onInc={() => onInc(item, active)}
        />
      </div>
    </article>
  );
}

/* ───────────────────── banners do cardápio ───────────────────── */

export function MenuBanners({
  categories,
  acceptingOrders,
  qtyFor,
  onAdd,
  onDec,
  onInc,
}: {
  categories: MenuCategory[];
  acceptingOrders: boolean;
  qtyFor: (item: MenuItem, variant: MenuVariant | null) => number;
  onAdd: (item: MenuItem, variant: MenuVariant | null) => void;
  onDec: (item: MenuItem, variant: MenuVariant | null) => void;
  onInc: (item: MenuItem, variant: MenuVariant | null) => void;
}) {
  const [tab, setTab] = useState<string | null>(null);
  const active = categories.find((c) => c.id === tab) ?? categories[0];

  return (
    <section className="hs-section" id="cardapio">
      <div className="hs-container">
        <div className="hs-section-head">
          <div>
            <span className="hs-eyebrow">{L.menu.eyebrow}</span>
            <h2>{L.menu.title}</h2>
          </div>
          <p>{L.menu.lead}</p>
        </div>

        {categories.length > 1 && (
          <div className="hs-tabs-wrap">
            <div className="hs-tabs" role="tablist" aria-label="Categorias do cardápio">
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  role="tab"
                  aria-selected={active?.id === category.id}
                  className={`hs-tab${active?.id === category.id ? ' is-active' : ''}`}
                  onClick={() => setTab(category.id)}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {!acceptingOrders && (
          <div className="hs-notice">
            <h3>Loja fechada de momento</h3>
            <p>
              Podes ver o cardápio à vontade — assim que a loja reabrir, o pedido volta a ficar
              disponível neste mesmo ecrã.
            </p>
          </div>
        )}

        <div className="hs-banners">
          {(active?.items ?? []).map((item, index) => (
            <Banner
              key={item.id}
              item={item}
              index={index}
              acceptingOrders={acceptingOrders}
              qtyFor={qtyFor}
              onAdd={onAdd}
              onDec={onDec}
              onInc={onInc}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
