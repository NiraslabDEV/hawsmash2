'use client';

import { formatMT, type Cents } from '@delivery/core';

import { PosIcon, type PosIconName } from './pos-icons';

/**
 * O POS no telemóvel.
 *
 * É o mesmo POS do PC — a mesma sessão por PIN, o mesmo caixa, os mesmos
 * pedidos — com a arrumação de um ecrã estreito: o que no PC está na barra
 * lateral e na de cima passa para o fundo, onde o polegar chega, e o carrinho
 * abre por cima dos produtos em vez de ficar ao lado. Abaixo de `lg` só.
 */

export type PosView = 'menu' | 'delivery' | 'estafetas' | 'senhas' | 'mesas' | 'caixa';

const mt = (c: number) => formatMT(c as Cents);

const ABAS: Array<{ view: PosView; label: string; icon: PosIconName }> = [
  { view: 'menu', label: 'Vender', icon: 'bag' },
  { view: 'delivery', label: 'Delivery', icon: 'truck' },
  { view: 'mesas', label: 'Mesas', icon: 'table' },
  { view: 'caixa', label: 'Caixa', icon: 'cash' },
];

export function MobileBar({
  posView,
  count,
  totalCents,
  mesaNumber,
  onCart,
  onView,
  onMais,
}: {
  posView: PosView;
  count: number;
  totalCents: number;
  mesaNumber: number | null;
  onCart: () => void;
  onView: (view: PosView) => void;
  onMais: () => void;
}) {
  const noMais = posView === 'estafetas' || posView === 'senhas';
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/[0.07] bg-bg1 pb-[env(safe-area-inset-bottom)] lg:hidden">
      {posView === 'menu' && (
        <div className="px-2.5 pt-2.5">
          <button
            type="button"
            onClick={onCart}
            className={`pos-btn w-full !min-h-14 !justify-between !rounded-[16px] !px-4 ${
              count > 0 ? 'pos-btn--primary' : ''
            }`}
          >
            <span className="flex items-center gap-2.5">
              <span className="pos-num grid h-8 min-w-8 place-items-center rounded-full bg-black/20 px-1.5 text-sm">
                {count}
              </span>
              <span className="text-base font-extrabold tracking-[0.04em]">
                {mesaNumber != null ? `MESA ${mesaNumber}` : count > 0 ? 'VER CARRINHO' : 'CARRINHO'}
              </span>
            </span>
            <span className="pos-num text-lg font-extrabold">{mt(totalCents)}</span>
          </button>
        </div>
      )}
      <nav className="grid grid-cols-5 px-1 pt-1" aria-label="Secções do POS">
        {ABAS.map((aba) => {
          const activa = posView === aba.view;
          return (
            <button
              key={aba.view}
              type="button"
              aria-current={activa ? 'page' : undefined}
              onClick={() => onView(aba.view)}
              className={`pos-press flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-bold ${
                activa ? 'text-gold' : 'text-ink-mute'
              }`}
            >
              <PosIcon name={aba.icon} size={22} strokeWidth={activa ? 2.4 : 2} />
              {aba.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onMais}
          aria-current={noMais ? 'page' : undefined}
          className={`pos-press flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-bold ${
            noMais ? 'text-gold' : 'text-ink-mute'
          }`}
        >
          <PosIcon name="menu" size={22} />
          Mais
        </button>
      </nav>
    </div>
  );
}

/** Tudo o que no PC está à vista e no telemóvel não cabe. */
export function MaisSheet({
  onClose,
  online,
  lastSaleNumber,
  reprintPending,
  onView,
  onEsgotados,
  onReprint,
  onVoid,
  onTrocaTurno,
  onLock,
}: {
  onClose: () => void;
  online: boolean;
  lastSaleNumber: number | null;
  reprintPending: boolean;
  onView: (view: PosView) => void;
  onEsgotados: () => void;
  onReprint: () => void;
  onVoid: () => void;
  onTrocaTurno: () => void;
  onLock: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center lg:hidden">
      <div aria-hidden className="pos-scrim" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Mais"
        className="pos-sheet relative max-h-[90dvh] w-full overflow-y-auto !rounded-b-none !p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15" aria-hidden />
        <div className="grid grid-cols-2 gap-2">
          <Opcao icon="user" label="Estafetas" onClick={() => onView('estafetas')} />
          <Opcao icon="ticket" label="Senhas" onClick={() => onView('senhas')} />
          <Opcao icon="ban" label="Esgotados" onClick={onEsgotados} />
          <Opcao icon="lock" label="Bloquear · trocar" onClick={onLock} />
        </div>

        {lastSaleNumber != null && (
          <>
            <p className="pos-eyebrow mb-2 mt-5">Última venda · #{lastSaleNumber}</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={reprintPending}
                onClick={onReprint}
                className="pos-btn pos-btn--accent-outline !min-h-14 !rounded-[14px] !text-sm"
              >
                <PosIcon name="printer" size={18} />
                {reprintPending ? 'A reimprimir…' : 'Reimprimir talão'}
              </button>
              <button
                type="button"
                onClick={onVoid}
                className="pos-btn pos-btn--danger !min-h-14 !rounded-[14px] !text-sm"
              >
                <PosIcon name="undo" size={18} />
                Anular
              </button>
            </div>
          </>
        )}

        <button
          type="button"
          disabled={!online}
          onClick={onTrocaTurno}
          className="pos-btn mt-5 w-full !min-h-14 !rounded-[14px] !text-sm"
        >
          <PosIcon name="user" size={18} />
          TROCAR DE TURNO
        </button>
        <button type="button" onClick={onClose} className="pos-btn pos-btn--quiet mt-2 w-full !min-h-12 !text-sm">
          Fechar
        </button>
      </section>
    </div>
  );
}

function Opcao({ icon, label, onClick }: { icon: PosIconName; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pos-btn !min-h-[4.5rem] !flex-col !gap-1.5 !rounded-[16px] !text-sm"
    >
      <PosIcon name={icon} size={22} />
      {label}
    </button>
  );
}
