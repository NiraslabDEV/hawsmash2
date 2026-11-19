'use client';

import type { ReactNode } from 'react';

import { officeError } from '@/lib/escritorio/regras';
import { createClient } from '@/utils/supabase/client';

/** Peças comuns do Escritório: o mesmo desenho das outras abas do painel (tema escuro + dourado). */

export type Role = 'owner' | 'manager';
export type Store = { id: string; short_name: string };
export type Feedback = { tone: 'ok' | 'erro'; text: string } | null;

export function Section({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-white/[0.08] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-black text-white">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-[#8b8378]">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Message({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return (
    <p
      role="status"
      className={`rounded-xl px-4 py-3 text-sm ${
        feedback.tone === 'ok' ? 'border border-emerald-800 bg-emerald-900/20 text-emerald-300' : 'border border-red-800 bg-red-900/20 text-red-300'
      }`}
    >
      {feedback.text}
    </p>
  );
}

export function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`block ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="text-xs text-[#C9BCAC]">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-[#8b8378]">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-[#5f574e] focus:border-[#e5a93c] focus:outline-none disabled:opacity-50';

export function Button({ children, onClick, tone = 'gold', disabled, type = 'button' }: {
  children: ReactNode; onClick?: () => void; tone?: 'gold' | 'ghost' | 'danger'; disabled?: boolean; type?: 'button' | 'submit';
}) {
  const style = {
    gold: 'bg-[#e5a93c] text-black hover:bg-[#f0b955]',
    ghost: 'border border-white/10 text-[#C9BCAC] hover:bg-white/[0.04]',
    danger: 'border border-red-800 text-red-300 hover:bg-red-900/20',
  }[tone];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`rounded-xl px-4 py-2 text-sm font-bold transition disabled:opacity-50 ${style}`}>
      {children}
    </button>
  );
}

export function Pill({ tone, children }: { tone: 'red' | 'amber' | 'green' | 'grey'; children: ReactNode }) {
  const style = {
    red: 'border-red-800 bg-red-900/20 text-red-300',
    amber: 'border-amber-700 bg-amber-900/20 text-amber-300',
    green: 'border-emerald-800 bg-emerald-900/20 text-emerald-300',
    grey: 'border-white/10 text-[#8b8378]',
  }[tone];
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-bold ${style}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-[#8b8378]">{children}</p>;
}

export function StoreSelect({ stores, value, onChange, allowCompany }: {
  stores: Store[]; value: string; onChange: (value: string) => void; allowCompany?: boolean;
}) {
  return (
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      {allowCompany && <option value="">Empresa (todas as lojas)</option>}
      {stores.map((s) => <option key={s.id} value={s.id}>{s.short_name}</option>)}
    </select>
  );
}

/** RPC com o erro já em português. */
export async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const { data, error } = await createClient().rpc(name, args);
  if (error) return { ok: false, error: officeError(error.message) };
  return { ok: true, data: data as T };
}

/** Sobe um ficheiro para o bucket privado do Escritório. Devolve o caminho ou o erro. */
export async function uploadOfficeFile(path: string, file: File): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: 'O ficheiro passa de 10 MB.' };
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) {
    return { ok: false, error: 'Só fotografias (JPG, PNG, WebP) ou PDF.' };
  }
  const { error } = await createClient().storage.from('office-files').upload(path, file, { upsert: true, contentType: file.type });
  return error ? { ok: false, error: `Não foi possível guardar o ficheiro: ${error.message}` } : { ok: true, path };
}

/** Abre um ficheiro privado por ligação assinada de 5 minutos (nunca URL pública). */
export async function openOfficeFile(path: string): Promise<string | null> {
  const { data, error } = await createClient().storage.from('office-files').createSignedUrl(path, 300);
  if (error || !data?.signedUrl) return error?.message ?? 'Ligação indisponível.';
  window.open(data.signedUrl, '_blank', 'noopener');
  return null;
}

/** Descarrega um ficheiro do mês pela rota do servidor, com a sessão de quem pede. */
export async function downloadMonthFile(year: number, month: number, format: 'csv' | 'xml' | 'compras'): Promise<string | null> {
  const { data } = await createClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return 'A sessão expirou. Volte a entrar no painel.';
  const response = await fetch(`/api/escritorio/export?year=${year}&month=${month}&format=${format}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return body?.error ?? 'Não foi possível gerar o ficheiro.';
  }
  const blob = await response.blob();
  const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? `escritorio-${year}-${month}`;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
  return null;
}
