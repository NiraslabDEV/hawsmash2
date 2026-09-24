'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

export const INPUT =
  'mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white placeholder:text-[#6f6a62]';
export const LABEL = 'block text-xs font-bold uppercase tracking-wide text-[#8b8378]';
export const CARD = 'rounded-2xl border border-white/[0.08] p-5';

export type Message = { tone: 'ok' | 'error'; text: string } | null;

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl bg-white/[0.03] px-4 py-3">
      <span>
        <span className="block text-sm font-bold text-white">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-[#8b8378]">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 accent-[#e5a93c]"
      />
    </label>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <span className="mt-1 flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          onChange={(event) => {
            const n = Number(event.target.value);
            if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))));
          }}
          className="w-28 rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white"
        />
        {suffix && <span className="text-sm text-[#8b8378]">{suffix}</span>}
      </span>
      {hint && <span className="mt-1 block text-xs text-[#8b8378]">{hint}</span>}
    </label>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className={CARD}>
      <h2 className="text-lg font-black text-white">{title}</h2>
      {hint && <p className="mt-1 text-sm text-[#8b8378]">{hint}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

export function Choice<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
            option.value === value
              ? 'border-[#e5a93c] bg-[#e5a93c]/15 text-[#e5a93c]'
              : 'border-white/10 text-[#C9BCAC] hover:bg-white/[0.04]'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Banner({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p
      role={message.tone === 'error' ? 'alert' : 'status'}
      className={`rounded-xl border px-4 py-3 text-sm ${
        message.tone === 'ok'
          ? 'border-[#2f6b3f] bg-[#16281c] text-[#a8e0b6]'
          : 'border-[#7a2b2b] bg-[#2a1616] text-[#ffb0b0]'
      }`}
    >
      {message.text}
    </p>
  );
}

/**
 * A TV a sério, em miniatura: um iframe da página da TV (com `?preview=1`,
 * que não conta como TV ligada), escalado para caber e rodado como a TV está
 * montada — uma TV ao alto aparece ao alto.
 */
export function TvPreview({ src, rotation }: { src: string; rotation: 0 | 90 | 180 | 270 }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const alto = rotation === 90 || rotation === 270;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const escala = width > 0 ? width / (alto ? 1080 : 1920) : 0;
  return (
    <div
      ref={box}
      className="relative mx-auto w-full overflow-hidden rounded-xl border border-white/10 bg-black"
      style={{ aspectRatio: alto ? '9 / 16' : '16 / 9', maxWidth: alto ? 320 : undefined }}
    >
      {escala > 0 && (
        <iframe
          title="Pré-visualização da TV"
          src={src}
          className="pointer-events-none absolute left-1/2 top-1/2 border-0"
          style={{
            width: 1920,
            height: 1080,
            transform: `translate(-50%, -50%) scale(${escala}) rotate(${-rotation}deg)`,
          }}
        />
      )}
    </div>
  );
}
