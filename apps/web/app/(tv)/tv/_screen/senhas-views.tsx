'use client';

import { useEffect, useState } from 'react';

import { ticketLabel } from '@/lib/pos/senhas';
import type { TvConfig } from '@/lib/tv/settings';

import type { QueueEntry } from './use-store-queue';

type SenhasOptions = TvConfig['senhas'];

const tipo = (entry: QueueEntry) =>
  ticketLabel({ channel: entry.channel ?? null, fulfillment_type: entry.fulfillment_type ?? null });

/** Hora de Maputo, a mudar sozinha. Legível a 4 m, discreta. */
export function TvClock() {
  const [agora, setAgora] = useState<string | null>(null);
  useEffect(() => {
    const tick = () =>
      setAgora(
        new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Maputo' }),
      );
    tick();
    const timer = window.setInterval(tick, 15_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!agora) return null;
  return (
    <span className="text-3xl font-black tabular-nums" style={{ color: 'var(--tv-muted)' }}>
      {agora}
    </span>
  );
}

export function TvHeader({
  title,
  showClock,
  stale,
  right,
}: {
  title: string;
  showClock: boolean;
  stale: boolean;
  right?: string;
}) {
  return (
    <header className="flex shrink-0 items-baseline justify-between gap-6 px-8 pt-6">
      <h1 className="truncate text-4xl font-black uppercase tracking-widest" style={{ color: 'var(--tv-primary)' }}>
        {title}
      </h1>
      <div className="flex shrink-0 items-baseline gap-6">
        {(stale || right) && (
          <span className="text-2xl font-bold" style={{ color: stale ? '#ff9b9b' : 'var(--tv-muted-2)' }}>
            {stale ? 'A reconectar…' : right}
          </span>
        )}
        {showClock && <TvClock />}
      </div>
    </header>
  );
}

/** Senhas em ecrã inteiro: prontas em grande, em preparo por baixo. */
export function SenhasFull({
  ready,
  preparing,
  options,
}: {
  ready: QueueEntry[];
  preparing: QueueEntry[];
  options: SenhasOptions;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col px-8 pb-8">
      <section className="mt-6 min-h-0 flex-1 overflow-hidden">
        {ready.length === 0 ? (
          <p className="grid h-full place-items-center text-5xl font-black" style={{ color: 'var(--tv-muted-2)' }}>
            {options.emptyText}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-6 md:grid-cols-3">
            {ready.map((entry) => (
              <li
                key={entry.order_number}
                className="grid place-items-center rounded-3xl py-10"
                style={{ background: 'var(--tv-card)', border: '4px solid var(--tv-primary)' }}
              >
                <span className="text-[8rem] font-black leading-none" style={{ color: 'var(--tv-primary)' }}>
                  {entry.daily_number}
                </span>
                {options.showType && (
                  <span
                    className="mt-2 text-3xl font-bold uppercase tracking-widest"
                    style={{ color: 'var(--tv-muted)' }}
                  >
                    {tipo(entry)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {options.showPreparing && (
        <footer className="mt-8 shrink-0 border-t pt-6" style={{ borderColor: 'var(--tv-line)' }}>
          <h2 className="text-2xl font-bold uppercase tracking-wide" style={{ color: 'var(--tv-muted)' }}>
            {options.preparingTitle}
          </h2>
          <PreparingList preparing={preparing} size="lg" />
        </footer>
      )}
    </div>
  );
}

function PreparingList({ preparing, size }: { preparing: QueueEntry[]; size: 'lg' | 'sm' }) {
  return (
    <ul className={`mt-4 flex flex-wrap ${size === 'lg' ? 'gap-4' : 'gap-2'}`}>
      {preparing.length === 0 && (
        <li className={`${size === 'lg' ? 'text-3xl' : 'text-2xl'} font-bold`} style={{ color: 'var(--tv-muted-2)' }}>
          —
        </li>
      )}
      {preparing.map((entry) => (
        <li
          key={entry.order_number}
          className={`rounded-2xl font-black ${size === 'lg' ? 'px-6 py-3 text-4xl' : 'px-4 py-2 text-2xl'}`}
          style={{ background: 'var(--tv-card)', color: 'var(--tv-text)' }}
        >
          {entry.daily_number}
        </li>
      ))}
    </ul>
  );
}

/** A coluna das senhas ao lado dos vídeos. */
export function SenhasPanel({
  ready,
  preparing,
  options,
}: {
  ready: QueueEntry[];
  preparing: QueueEntry[];
  options: SenhasOptions;
}) {
  return (
    <aside
      className="flex h-full w-[30%] min-w-[16rem] max-w-[32rem] shrink-0 flex-col p-6"
      style={{ background: 'var(--tv-bg)' }}
    >
      <h2 className="text-3xl font-black uppercase tracking-widest" style={{ color: 'var(--tv-primary)' }}>
        {options.title}
      </h2>
      <div className="mt-4 min-h-0 flex-1 overflow-hidden">
        {ready.length === 0 ? (
          <p className="pt-6 text-2xl font-bold" style={{ color: 'var(--tv-muted-2)' }}>
            {options.emptyText}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-4">
            {ready.map((entry) => (
              <li
                key={entry.order_number}
                className="grid place-items-center rounded-2xl py-4"
                style={{ background: 'var(--tv-card)', border: '3px solid var(--tv-primary)' }}
              >
                <span className="text-6xl font-black leading-none" style={{ color: 'var(--tv-primary)' }}>
                  {entry.daily_number}
                </span>
                {options.showType && (
                  <span className="mt-1 text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--tv-muted)' }}>
                    {tipo(entry)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {options.showPreparing && (
        <footer className="mt-4 shrink-0 border-t pt-4" style={{ borderColor: 'var(--tv-line)' }}>
          <h3 className="text-lg font-bold uppercase tracking-wide" style={{ color: 'var(--tv-muted)' }}>
            {options.preparingTitle}
          </h3>
          <PreparingList preparing={preparing.slice(0, 12)} size="sm" />
        </footer>
      )}
    </aside>
  );
}

/**
 * A senha acabada de ficar pronta ocupa o ecrã: quem está sentado de costas
 * para a TV vê-a mudar pelo canto do olho. Por cima dos vídeos também.
 */
export function SenhasHighlight({ entry, options }: { entry: QueueEntry; options: SenhasOptions }) {
  return (
    <div role="status" className="absolute inset-0 z-30 grid place-items-center p-8" style={{ background: 'var(--tv-bg, #000)' }}>
      <div className="text-center">
        <p className="text-6xl font-black uppercase tracking-widest" style={{ color: 'var(--tv-text)' }}>
          {options.title}
        </p>
        <p className="text-[18rem] font-black leading-none" style={{ color: 'var(--tv-primary)' }}>
          {entry.daily_number}
        </p>
        {options.showType && (
          <p className="text-6xl font-bold uppercase tracking-widest" style={{ color: 'var(--tv-muted)' }}>
            {tipo(entry)}
          </p>
        )}
      </div>
    </div>
  );
}
