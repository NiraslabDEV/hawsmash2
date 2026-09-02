'use client';

import Image from 'next/image';
import { formatMT, type Cents } from '@delivery/core';

import { storeStatusLabel, type PublicStoreOption } from '@/lib/public-stores';

import { CloseIcon } from './icons';
import type { CartView } from './types';

/** O payload do menu traz centavos como number; a marca `Cents` é do domínio. */
const mt = (value: number) => formatMT(value as Cents);

/* ─────────────────────────── CARRINHO ─────────────────────────── */

export function CartDrawer({
  open,
  lines,
  storeName,
  onClose,
  onDec,
  onInc,
  onCheckout,
  canCheckout,
}: {
  open: boolean;
  lines: CartView[];
  storeName: string;
  onClose: () => void;
  onDec: (line: CartView) => void;
  onInc: (line: CartView) => void;
  onCheckout: () => void;
  canCheckout: boolean;
}) {
  // Pré-visualização apenas: o total que vale é o que o `create_order`
  // recalcula no servidor (CLAUDE §1, regra 2).
  const total = lines.reduce((sum, line) => sum + line.unitCents * line.qty, 0);

  return (
    <>
      <div
        className={`hs-overlay${open ? ' is-open' : ''}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`hs-drawer${open ? ' is-open' : ''}`}
        aria-label="Carrinho"
        aria-hidden={!open}
      >
        <header className="hs-drawer-head">
          <div>
            <div className="hs-drawer-title">Carrinho</div>
            <div className="hs-drawer-store">{storeName}</div>
          </div>
          <button type="button" className="hs-cart-btn" aria-label="Fechar carrinho" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="hs-drawer-body">
          {lines.length === 0 && <p className="hs-drawer-empty">O carrinho está vazio.</p>}

          {lines.map((line) => (
            <div key={`${line.item.id}-${line.variant?.id ?? 'base'}-${line.index}`} className="hs-drawer-line">
              {line.item.photo_url ? (
                <Image src={line.item.photo_url} alt="" width={56} height={56} />
              ) : (
                <span />
              )}
              <div>
                <div className="nm">{line.item.name}</div>
                {line.variant && <div className="vr">{line.variant.name}</div>}
                <div className="pr">{mt(line.unitCents)} cada</div>
              </div>
              <span className="hs-chip-qty">
                <button
                  type="button"
                  aria-label={`Menos um ${line.item.name}`}
                  onClick={() => onDec(line)}
                >
                  −
                </button>
                <span>{line.qty}</span>
                <button
                  type="button"
                  aria-label={`Mais um ${line.item.name}`}
                  onClick={() => onInc(line)}
                >
                  +
                </button>
              </span>
            </div>
          ))}
        </div>

        <footer className="hs-drawer-foot">
          <div className="hs-drawer-total">
            <span className="l">Total estimado</span>
            <span className="v">{mt(total)}</span>
          </div>
          <button
            type="button"
            className="hs-btn hs-btn-gold"
            disabled={lines.length === 0 || !canCheckout}
            onClick={onCheckout}
          >
            Finalizar pedido
          </button>
          {!canCheckout && lines.length > 0 && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--hs-ink-mute)' }}>
              A loja não está a aceitar pedidos neste momento.
            </p>
          )}
        </footer>
      </aside>
    </>
  );
}

/* ──────────────────────── TROCAR DE LOJA ──────────────────────── */

export function StoreSwitchDialog({
  stores,
  currentSlug,
  onPick,
  onClose,
}: {
  stores: PublicStoreOption[];
  currentSlug: string;
  onPick: (slug: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="hs-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Trocar de loja"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="hs-dialog-card">
        <h3>Trocar de loja</h3>
        <p>
          Cada loja tem o seu stock e as suas taxas de entrega. Ao trocar de loja,
          o teu carrinho é esvaziado.
        </p>

        {stores.map((store) => {
          const isCurrent = store.slug === currentSlug;
          return (
            <button
              key={store.slug}
              type="button"
              className="hs-store-option"
              disabled={isCurrent}
              onClick={() => onPick(store.slug)}
            >
              <span>
                <span className="nm">{store.short_name}</span>
                <span className="st" style={{ display: 'block', marginTop: 4 }}>
                  {isCurrent ? 'Loja actual' : storeStatusLabel(store)}
                </span>
              </span>
            </button>
          );
        })}

        <button type="button" className="hs-btn hs-btn-ghost hs-btn-sm" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
