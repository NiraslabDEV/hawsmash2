'use client';

/**
 * Peças partilhadas pelos três ecrãs do funil (checkout → pagamento →
 * pedido recebido).
 *
 * A razão de existirem: a régua do topo — logo + 01/02/03 — tem de ser
 * exactamente igual nos três. Quando cada página desenhava a sua, os rótulos
 * assentavam a alturas diferentes e o passo 2 chamava-se "Pagamento" num ecrã
 * e "Pago" no outro. Um componente, uma verdade.
 *
 * Regra de (public)/CLAUDE.md §4: nenhum hex nem texto de marca aqui. Tudo sai
 * de config/brand.ts — as cores por var(--hs-*), o texto por `brand`.
 */

import type { CSSProperties, ReactNode } from 'react';
import { brand } from '@brand';

/* ── Ícones ──────────────────────────────────────────────────────────────
   Grelha 24, altura óptica ~16, traço 1.7 acima de 14px e 2.6 abaixo. São
   dois valores e não doze de propósito: com traços a olho os ícones lêem com
   pesos diferentes lado a lado. */

type IconProps = { size?: number; className?: string };
const S = (size: number) => ({
  viewBox: '0 0 24 24',
  width: size,
  height: size,
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: size <= 13 ? 2.6 : 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const IcoCheck = ({ size = 16, className }: IconProps) => (
  <svg {...S(size)} className={className}><path d="m5 12.5 4.5 4.5L19 7" /></svg>
);
export const IcoArrow = ({ size = 17, className }: IconProps) => (
  <svg {...S(size)} className={className}><path d="M4 12h14" /><path d="m12.5 6 6 6-6 6" /></svg>
);
export const IcoBack = ({ size = 20, className }: IconProps) => (
  <svg {...S(size)} className={className}><path d="M19 12H5" /><path d="m11 6-6 6 6 6" /></svg>
);
export const IcoStore = ({ size = 22, className }: IconProps) => (
  <svg {...S(size)} className={className}><path d="M4 9.5 5.5 5.5h13L20 9.5" /><path d="M5 9.5V19h14V9.5" /><path d="M10 19v-5.5h4V19" /></svg>
);
export const IcoScooter = ({ size = 22, className }: IconProps) => (
  <svg {...S(size)} className={className}>
    <circle cx="6" cy="16.5" r="3" /><circle cx="18" cy="16.5" r="3" />
    <rect x="3.5" y="7" width="7" height="6.5" rx="1.2" />
    <path d="M10.5 10.2h3.3l2.6 4.5" /><path d="M15 7.5h2.8" /><path d="M9 16.5h6" />
  </svg>
);
export const IcoClock = ({ size = 18, className }: IconProps) => (
  <svg {...S(size)} className={className}><circle cx="12" cy="12" r="8" /><path d="M12 7.5v4.8l3 1.8" /></svg>
);
export const IcoCalendar = ({ size = 18, className }: IconProps) => (
  <svg {...S(size)} className={className}><rect x="3.5" y="5.5" width="17" height="15" rx="2.5" /><path d="M8 3.5v4M16 3.5v4M3.5 10.5h17" /></svg>
);
export const IcoPin = ({ size = 18, className }: IconProps) => (
  <svg {...S(size)} className={className}><path d="M12 20.5s6.5-5.4 6.5-10.2a6.5 6.5 0 1 0-13 0C5.5 15.1 12 20.5 12 20.5Z" /><circle cx="12" cy="10" r="2.3" /></svg>
);
export const IcoUser = ({ size = 18, className }: IconProps) => (
  <svg {...S(size)} className={className}><circle cx="12" cy="7.6" r="2.9" /><path d="M5.8 19.6a6.2 6.2 0 0 1 12.4 0" /></svg>
);
export const IcoPhone = ({ size = 18, className }: IconProps) => (
  <svg {...S(size)} className={className}><path d="M6.5 4h3l1.5 3.8-2 1.4a12 12 0 0 0 5.8 5.8l1.4-2L20 14.5v3a2 2 0 0 1-2.2 2A15.9 15.9 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4Z" /></svg>
);
export const IcoMail = ({ size = 18, className }: IconProps) => (
  <svg {...S(size)} className={className}><rect x="3.5" y="6" width="17" height="12" rx="2" /><path d="M4 7.2 12 13l8-5.8" /></svg>
);
export const IcoTicket = ({ size = 15, className }: IconProps) => (
  <svg {...S(size)} className={className} strokeWidth={1.7}><path d="M4 9.2V6.8A1.8 1.8 0 0 1 5.8 5h12.4A1.8 1.8 0 0 1 20 6.8v2.4a2.8 2.8 0 0 0 0 5.6v2.4a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 17.2v-2.4a2.8 2.8 0 0 0 0-5.6Z" /></svg>
);
export const IcoCopy = ({ size = 14, className }: IconProps) => (
  <svg {...S(size)} className={className} strokeWidth={1.7}><rect x="9" y="9" width="11" height="11" rx="2.4" /><path d="M5.5 15H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 3h9A1.5 1.5 0 0 1 15.5 4.5V5" /></svg>
);
export const IcoUpload = ({ size = 20, className }: IconProps) => (
  <svg {...S(size)} className={className}><path d="M12 16.5V4.5" /><path d="m7.5 9 4.5-4.5L16.5 9" /><path d="M4.5 15v3.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V15" /></svg>
);
export const IcoShield = ({ size = 15, className }: IconProps) => (
  <svg {...S(size)} className={className} strokeWidth={1.7}><path d="M12 3.5 5.5 6.3v5.2c0 4.1 2.7 7.7 6.5 9 3.8-1.3 6.5-4.9 6.5-9V6.3L12 3.5Z" /></svg>
);
export const IcoWhats = ({ size = 17, className }: IconProps) => (
  <svg {...S(size)} className={className} strokeWidth={1.7}><path d="M20.5 11.7a8.3 8.3 0 0 1-12.2 7.3L3.5 20.5l1.6-4.7A8.3 8.3 0 1 1 20.5 11.7Z" /></svg>
);
export const IcoAlert = ({ size = 18, className }: IconProps) => (
  <svg {...S(size)} className={className} strokeWidth={1.7}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.6v5" /><circle cx="12" cy="16.4" r="1" fill="currentColor" stroke="none" /></svg>
);
export const IcoRefresh = ({ size = 17, className }: IconProps) => (
  <svg {...S(size)} className={className}><path d="M4 11a8 8 0 0 1 13.7-5.6L20 8" /><path d="M20 4v4h-4" /><path d="M20 13a8 8 0 0 1-13.7 5.6L4 16" /><path d="M4 20v-4h4" /></svg>
);
export const IcoPlus = ({ size = 14, className }: IconProps) => (
  <svg {...S(size)} className={className}><path d="M12 5v14M5 12h14" /></svg>
);
export const IcoStar = ({ size = 24, filled = false, className }: IconProps & { filled?: boolean }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className} aria-hidden>
    <path
      d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9L12 3.6Z"
      opacity={filled ? 1 : 0.16}
    />
  </svg>
);

/* ── Marca ───────────────────────────────────────────────────────────────
   O símbolo é desenhado, não uma imagem: tem de sair nítido a 15px no rodapé
   e a 34px na régua, e nunca falhar por 404. As cores vêm dos tokens. */

export function BrandMark({ size = 34, muted = false }: { size?: number; muted?: boolean }) {
  const bun = muted ? 'var(--hs-ink-mute)' : 'var(--hs-ink)';
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden style={{ flexShrink: 0 }}>
      {!muted && <rect width="64" height="64" rx="14" fill="var(--hs-bg-0)" />}
      <path d="M12 24c0-9 9-16 20-16s20 7 20 16H12z" fill={bun} />
      {!muted && (
        <>
          <circle cx="24" cy="17" r="1.5" fill="var(--hs-bg-0)" />
          <circle cx="32" cy="14" r="1.5" fill="var(--hs-bg-0)" />
          <circle cx="40" cy="17" r="1.5" fill="var(--hs-bg-0)" />
        </>
      )}
      <rect x="11" y="26" width="42" height="5" rx="2" fill="var(--hs-gold)" />
      <rect x="11" y="33" width="42" height="6" rx="2" fill="var(--hs-gold-deep)" />
      <path d="M11 41h42v5a5 5 0 0 1-5 5H16a5 5 0 0 1-5-5v-5z" fill={bun} />
    </svg>
  );
}

/* ── Régua do funil ──────────────────────────────────────────────────── */

const STEPS = ['Pedido', 'Pagamento', 'Na chapa'] as const;

export function FunnelRail({
  step,
  storeName,
  storeOpen = true,
  onBack,
  failed = false,
}: {
  /** 1 pedido · 2 pagamento · 3 na chapa */
  step: 1 | 2 | 3;
  storeName?: string;
  storeOpen?: boolean;
  onBack?: () => void;
  /** pagamento por concluir: o passo 2 volta a ser o passo actual */
  failed?: boolean;
}) {
  return (
    <header className="hf-rail">
      <div className="hf-rail-top">
        {onBack && (
          <button type="button" onClick={onBack} className="hf-back" aria-label="Voltar">
            <IcoBack />
          </button>
        )}
        <BrandMark />
        <div style={{ minWidth: 0 }}>
          <div className="hf-brand-name">{brand.storefront.logoText}</div>
          <div className="hf-brand-tag">{brand.storefront.landing.story.tagValue}</div>
        </div>
        {storeName && (
          <span className={`hf-store${storeOpen ? '' : ' is-closed'}`}>
            <span className="hf-store-dot" />
            {storeName}
          </span>
        )}
      </div>
      <ol className="hf-steps">
        {STEPS.map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3;
          const done = n < step && !(failed && n === 2);
          const now = n === step;
          return (
            <li key={label} className={`hf-step${done ? ' is-done' : ''}${now ? ' is-now' : ''}`}>
              <span className="hf-step-bar" />
              <span className="hf-step-row">
                {done ? <IcoCheck size={12} /> : <span className="hf-step-n">{`0${n}`}</span>}
                <span className="hf-step-l">{label}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </header>
  );
}

/* ── Cabeçalho de secção ─────────────────────────────────────────────── */

export function SectionHead({ n, children, action }: { n?: number; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="hf-head">
      {n ? <span className="hf-num">{`0${n}`}</span> : null}
      <span className="hf-rule" />
      <span className="hf-kick">{children}</span>
      {action}
    </div>
  );
}

/* ── Rodapé ──────────────────────────────────────────────────────────── */

export function FunnelFoot({ rights = false }: { rights?: boolean }) {
  return (
    <footer className="hf-foot">
      <BrandMark size={15} muted />
      <span className="num">
        {rights
          ? brand.storefront.landing.footer.rights
          : `${brand.storefront.logoText} · ${brand.storefront.contact.addressLine1}`}
      </span>
    </footer>
  );
}

/* ── Assinatura de quem fez o sistema (espaço E) ─────────────────────── */

export function PoweredBy() {
  const pb = brand.storefront.poweredBy;
  if (!pb?.enabled) return null;

  const vars = {
    '--pb-accent': pb.accent,
    '--pb-bg': pb.bg,
    '--pb-bg-2': pb.bg2,
    '--pb-ink': pb.ink,
    '--pb-ink-dim': pb.inkDim,
    '--pb-ink-mute': pb.inkMute,
  } as CSSProperties;

  return (
    <section className="hf-sup" style={vars}>
      <div className="hf-sup-top">
        <svg viewBox="0 0 32 32" width={26} height={26} aria-hidden style={{ flexShrink: 0 }}>
          <rect x="1.5" y="1.5" width="29" height="29" rx="9" fill="none" stroke="var(--pb-accent)" strokeWidth="1.5" />
          <path d="M10.5 22V10l11 12V10" fill="none" stroke="var(--pb-accent)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="hf-sup-name">{pb.name}</span>
        <span className="hf-sup-kick">{pb.kicker}</span>
      </div>
      <h2 className="hf-sup-title">{pb.title}</h2>
      <p className="hf-sup-body">{pb.body}</p>
      <p className="hf-sup-proof">{pb.proof.join('  ·  ')}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 20, flexWrap: 'wrap' }}>
        {pb.whatsapp && (
          <a className="hf-sup-cta" href={pb.whatsapp} target="_blank" rel="noopener noreferrer">
            <IcoWhats />
            {pb.cta}
          </a>
        )}
        {pb.email && (
          <a className="hf-sup-mail" href={`mailto:${pb.email}`}>
            {pb.email}
          </a>
        )}
      </div>
    </section>
  );
}
