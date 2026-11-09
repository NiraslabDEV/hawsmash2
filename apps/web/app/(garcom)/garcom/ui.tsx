'use client';

import type { ReactNode } from 'react';

import { PosIcon } from '@/app/(pos)/pos/pos-icons';

/**
 * Peças do telemóvel do garçom, no vocabulário do POS (pos.css): as mesmas
 * superfícies, botões e folhas, para o garçom e a caixa verem o mesmo sistema.
 */

export type Aviso = { tipo: 'ok' | 'erro'; texto: string };

/** Campo de texto: poço escuro, contorno de acento ao escrever. */
export const CAMPO =
  'w-full rounded-[14px] bg-black/30 px-4 py-3.5 text-base text-ink shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] outline-none placeholder:text-ink-mute focus:shadow-[inset_0_0_0_1.5px_var(--gold)] disabled:opacity-60';

/** Folha que sobe do fundo, com o puxador e o fecho no canto. */
export function Folha({
  titulo,
  subtitulo,
  onFechar,
  fechar = true,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  onFechar: () => void;
  fechar?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <div className="pos-scrim" onClick={() => fechar && onFechar()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="pos-sheet relative max-h-[92dvh] w-full max-w-md overflow-y-auto !rounded-b-none px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15" aria-hidden />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-extrabold tracking-tight">{titulo}</h2>
            {subtitulo && <p className="mt-0.5 truncate text-sm text-ink-mute">{subtitulo}</p>}
          </div>
          {fechar && (
            <button onClick={onFechar} aria-label="Fechar" className="pos-btn pos-btn--quiet !min-h-10 !w-10 shrink-0 !rounded-xl !p-0">
              <PosIcon name="close" size={18} />
            </button>
          )}
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  );
}

export function Contador({
  qty,
  onMenos,
  onMais,
  disabled = false,
}: {
  qty: number;
  onMenos: () => void;
  onMais: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="pos-well flex shrink-0 items-center gap-1 p-1">
      <button onClick={onMenos} disabled={disabled} aria-label="Menos um" className="pos-btn !min-h-10 !w-10 !rounded-[10px] !p-0">
        <PosIcon name="minus" size={18} />
      </button>
      <span className="pos-num w-8 text-center text-lg font-extrabold">{qty}</span>
      <button onClick={onMais} disabled={disabled} aria-label="Mais um" className="pos-btn !min-h-10 !w-10 !rounded-[10px] !p-0">
        <PosIcon name="plus" size={18} />
      </button>
    </div>
  );
}

/** Aviso em linha: amarelo para "atenção", vermelho para erro. */
export function Nota({ tom, children }: { tom: 'warn' | 'danger' | 'ok'; children: ReactNode }) {
  return (
    <p role={tom === 'danger' ? 'alert' : undefined} className={`pos-note pos-note--${tom} text-sm`}>
      {children}
    </p>
  );
}

/** Cabeçalho de secção: o "eyebrow" do POS, com contagem opcional. */
export function Secao({ titulo, conta, tom }: { titulo: string; conta?: number; tom?: 'ok' }) {
  return (
    <h2 className={`pos-eyebrow flex items-center gap-2 ${tom === 'ok' ? '!text-emerald-300' : ''}`}>
      {titulo}
      {conta != null && conta > 0 && (
        <span className="pos-num rounded-full bg-white/[0.08] px-1.5 py-px text-[10px] tracking-normal text-ink-dim">{conta}</span>
      )}
    </h2>
  );
}

/** Ecrã vazio: diz o que fazer, não só que não há nada. */
export function Vazio({ children }: { children: ReactNode }) {
  return <p className="pos-card px-5 py-8 text-center text-sm leading-relaxed text-ink-mute">{children}</p>;
}

/** Barra de topo de um ecrã com "voltar". */
export function Topo({
  titulo,
  sobre,
  detalhe,
  onVoltar,
  direita,
  children,
}: {
  titulo: ReactNode;
  sobre?: string;
  detalhe?: ReactNode;
  onVoltar?: () => void;
  direita?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-bg0 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <div className="flex items-center gap-3">
        {onVoltar && (
          <button onClick={onVoltar} aria-label="Voltar" className="pos-btn pos-btn--quiet !min-h-11 !w-11 shrink-0 !rounded-xl !p-0">
            <PosIcon name="back" size={20} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          {sobre && <p className="pos-eyebrow">{sobre}</p>}
          <h1 className="truncate text-[1.375rem] font-extrabold leading-tight tracking-tight">{titulo}</h1>
          {detalhe && <div className="truncate text-sm text-ink-mute">{detalhe}</div>}
        </div>
        {direita}
      </div>
      {children}
    </header>
  );
}
