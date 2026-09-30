'use client';

import { useState, type ReactNode } from 'react';
import { formatMT, type Cents } from '@delivery/core';
import type { CashSold } from '@delivery/receipt';
import type { CashPayments } from '@/lib/cash/history';

/** Peças visuais partilhadas pela aba Caixa: turno actual, turnos e fechos do dia. */

export const mt = (value: number) => {
  const absolute = formatMT(Math.abs(value) as Cents);
  return value < 0 ? `-${absolute}` : absolute;
};

export const time = (iso: string) =>
  new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Africa/Maputo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));

export const dateTime = (iso: string) =>
  new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Africa/Maputo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));

export { dayHeading, duration, maputoDay } from '@/lib/cash/history';
export type Payments = CashPayments;

const PAYMENT_METHODS: Array<{ key: keyof Payments; label: string; color: string }> = [
  { key: 'cash', label: 'Dinheiro', color: '#F5A623' },
  { key: 'mpesa', label: 'M-Pesa', color: '#E5484D' },
  { key: 'emola', label: 'e-Mola', color: '#F97316' },
  { key: 'credit_card', label: 'Cartão', color: '#60A5FA' },
];

/** A divisão por meio de pagamento: uma barra e a legenda com valor e %. */
export function PaymentSplit({ payments }: { payments: Payments }) {
  const total = PAYMENT_METHODS.reduce((sum, method) => sum + payments[method.key], 0);
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-white/[0.06]">
        {total > 0 && PAYMENT_METHODS.map((method) => payments[method.key] > 0 && (
          <span key={method.key} style={{ width: `${(payments[method.key] / total) * 100}%`, background: method.color }} />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {PAYMENT_METHODS.map((method) => (
          <div key={method.key} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-xs text-[#8F8376]">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: method.color }} />
              {method.label}
              {total > 0 && <span className="text-[#6F665C]">{Math.round((payments[method.key] / total) * 100)}%</span>}
            </dt>
            <dd className="mt-0.5 truncate font-black text-[#E8DDCF]">{mt(payments[method.key])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** A conta da gaveta, linha a linha, até ao esperado. */
export function DrawerMath({ rows, total, totalLabel }: {
  rows: Array<{ label: string; value: number; sign: '+' | '−' }>;
  total: number;
  totalLabel: string;
}) {
  return (
    <div className="rounded-xl bg-black/25 p-4">
      <ul className="space-y-1.5 text-sm">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-3">
            <span className="text-[#A99C8C]">
              <span className={`mr-2 inline-block w-3 text-center font-black ${row.sign === '+' ? 'text-emerald-300' : 'text-red-300'}`}>{row.sign}</span>
              {row.label}
            </span>
            <span className={`font-bold ${row.value === 0 ? 'text-[#6F665C]' : 'text-[#E8DDCF]'}`}>{mt(row.value)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
        <span className="text-sm font-black text-white">= {totalLabel}</span>
        <span className="text-lg font-black text-[#F5A623]">{mt(total)}</span>
      </div>
    </div>
  );
}

/** Contado contra esperado: verde quando bate, âmbar quando falta ou sobra. */
export function DifferenceBadge({ cents }: { cents: number }) {
  if (cents === 0) {
    return <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-black text-emerald-300">Certo</span>;
  }
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-black ${cents < 0 ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}>
      {cents < 0 ? 'Falta' : 'Sobra'} {mt(Math.abs(cents))}
    </span>
  );
}

const SOLD_PREVIEW = 8;

/** Os artigos vendidos, do mais vendido para o menos, com a barra da quantidade. */
export function SoldItems({ sold, emptyHint }: { sold: CashSold | null | undefined; emptyHint?: string }) {
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState('');
  if (!sold) {
    return <p className="py-6 text-center text-sm text-[#8F8376]">{emptyHint ?? 'Este fecho é anterior à lista de artigos.'}</p>;
  }
  if (sold.items.length === 0) {
    return <p className="py-6 text-center text-sm text-[#8F8376]">Nenhum artigo vendido.</p>;
  }
  const units = sold.items.reduce((sum, item) => sum + item.qty, 0);
  const maxQty = Math.max(...sold.items.map((item) => item.qty));
  const needle = query.trim().toLocaleLowerCase('pt-PT');
  const filtered = needle
    ? sold.items.filter((item) => `${item.name} ${item.variant ?? ''}`.toLocaleLowerCase('pt-PT').includes(needle))
    : sold.items;
  const visible = all || needle ? filtered : filtered.slice(0, SOLD_PREVIEW);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[#8F8376]">
          <strong className="text-[#E8DDCF]">{units}</strong> unidades · <strong className="text-[#E8DDCF]">{sold.items.length}</strong> artigos diferentes
        </p>
        {sold.items.length > SOLD_PREVIEW && (
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Procurar artigo…"
            aria-label="Procurar artigo"
            className="min-h-9 w-44 rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-white outline-none focus:border-[#F5A623]"
          />
        )}
      </div>
      <ul className="mt-3 space-y-1">
        {visible.map((item) => (
          <li key={`${item.name}|${item.variant ?? ''}`} className="relative overflow-hidden rounded-lg px-3 py-2">
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 bg-[#F5A623]/[0.08]"
              style={{ width: `${(item.qty / maxQty) * 100}%` }}
            />
            <div className="relative flex items-center gap-3 text-sm">
              <span className="w-10 shrink-0 font-black text-[#F5A623]">{item.qty}×</span>
              <span className="min-w-0 flex-1 truncate text-white">
                {item.name}
                {item.variant && <span className="text-[#A99C8C]"> · {item.variant}</span>}
              </span>
              <span className="shrink-0 font-bold text-[#E8DDCF]">{mt(item.total_cents)}</span>
            </div>
          </li>
        ))}
        {visible.length === 0 && <li className="py-4 text-center text-sm text-[#8F8376]">Nenhum artigo com esse nome.</li>}
      </ul>
      {!needle && sold.items.length > SOLD_PREVIEW && (
        <button type="button" onClick={() => setAll((value) => !value)} className="mt-2 text-xs font-bold text-[#F5A623]">
          {all ? 'Mostrar menos' : `Ver os ${sold.items.length} artigos`}
        </button>
      )}
      <dl className="mt-3 space-y-1 border-t border-white/10 pt-3 text-sm">
        <SoldTotal label="Artigos" value={sold.items_total_cents} />
        {sold.delivery_fees_cents > 0 && <SoldTotal label="Taxas de entrega" value={sold.delivery_fees_cents} />}
        {sold.discounts_cents > 0 && <SoldTotal label="Descontos" value={-sold.discounts_cents} />}
      </dl>
    </div>
  );
}

function SoldTotal({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[#8F8376]">{label}</dt>
      <dd className="font-bold text-[#E8DDCF]">{mt(value)}</dd>
    </div>
  );
}

export function Stat({ label, value, hint, accent = false }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-black uppercase tracking-wider text-[#8F8376]">{label}</p>
      <p className={`mt-1 truncate text-xl font-black ${accent ? 'text-[#F5A623]' : 'text-white'}`}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-[#8F8376]">{hint}</p>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-white/10 bg-white/[0.04] p-5 ${className}`}>{children}</section>;
}

export function CardTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-sm font-black uppercase tracking-wider text-[#C9BCAC]">{children}</h2>
      {aside}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-[#8F8376]">{children}</p>;
}
