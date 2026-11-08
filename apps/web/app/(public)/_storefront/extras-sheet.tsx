'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { formatMT, type Cents } from '@delivery/core';

import { noteHasChip, toggleNoteChip } from '@/lib/pos/notes';

import { CartIcon, CloseIcon } from './icons';
import type { MenuAddon, MenuItem, MenuVariant } from './types';

const mt = (value: number) => formatMT(value as Cents);

/** Limite de `order_items.notes` no schema do pedido. */
export const NOTE_MAX = 200;

export interface ExtrasChoice {
  addonIds: string[];
  notes: string;
}

/**
 * "Quer algum extra?" — abre quando se adiciona um produto que tem extras.
 *
 * O mesmo gesto do balcão: toca-se no extra (foto + preço) e nas observações
 * ("SEM MOLHO"), que se somam. O total é uma pré-visualização; o que vale é o
 * que o `create_order` recalcula a partir dos ids (regra 2). Adicionar sem
 * escolher nada é o caminho normal — o botão nunca obriga a decidir.
 */
export function ExtrasSheet({
  item,
  variant,
  quickNotes,
  onConfirm,
  onClose,
}: {
  item: MenuItem;
  variant: MenuVariant | null;
  quickNotes: string[];
  onConfirm: (choice: ExtrasChoice) => void;
  onClose: () => void;
}) {
  const addons: MenuAddon[] = item.addons ?? [];
  const [chosen, setChosen] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const base = variant?.price_cents ?? item.price_cents;
  const total = base + addons.filter((a) => chosen.includes(a.id)).reduce((sum, a) => sum + a.price_cents, 0);

  const toggle = (id: string) =>
    setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div
      className="hs-dialog hs-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={`Extras para ${item.name}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="hs-dialog-card hs-sheet-card">
        <header className="hs-sheet-head">
          <div>
            <h3>{item.name}</h3>
            {variant && <span className="hs-sheet-variant">{variant.name}</span>}
          </div>
          <button type="button" className="hs-cart-btn" aria-label="Fechar" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="hs-sheet-body">
          {addons.length > 0 && (
            <section>
              <p className="hs-sheet-l">Algum extra?</p>
              <div className="hs-extras">
                {addons.map((addon) => {
                  const on = chosen.includes(addon.id);
                  return (
                    <button
                      key={addon.id}
                      type="button"
                      className={`hs-extra${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      onClick={() => toggle(addon.id)}
                    >
                      {addon.photo_url ? (
                        <Image src={addon.photo_url} alt="" width={72} height={72} />
                      ) : (
                        <span className="hs-extra-ph" aria-hidden />
                      )}
                      <span className="nm">{addon.name}</span>
                      <span className="pr">+{mt(addon.price_cents)}</span>
                      {on && <span className="ck" aria-hidden>✓</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section>
            <p className="hs-sheet-l">Observações para a cozinha</p>
            {quickNotes.length > 0 && (
              <div className="hs-notechips">
                {quickNotes.map((chip) => {
                  const on = noteHasChip(notes, chip);
                  return (
                    <button
                      key={chip}
                      type="button"
                      className={`hs-notechip${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      onClick={() => setNotes((actual) => toggleNoteChip(actual, chip).slice(0, NOTE_MAX))}
                    >
                      {chip}
                    </button>
                  );
                })}
              </div>
            )}
            <input
              type="text"
              className="hs-sheet-input"
              value={notes}
              maxLength={NOTE_MAX}
              placeholder="Outra observação (opcional)"
              aria-label={`Observação para ${item.name}`}
              onChange={(e) => setNotes(e.target.value)}
            />
          </section>
        </div>

        <button
          type="button"
          className="hs-btn hs-btn-gold hs-sheet-cta"
          onClick={() => onConfirm({ addonIds: chosen, notes: notes.trim() })}
        >
          <CartIcon size={16} />
          Adicionar · {mt(total)}
        </button>
      </div>
    </div>
  );
}
