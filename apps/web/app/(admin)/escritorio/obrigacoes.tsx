'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  OBLIGATION_TEMPLATES, currentOccurrence, maputoToday, monthName, periodLabel, ruleText, shortDate, type Obligation,
} from '@/lib/escritorio/regras';
import { createClient } from '@/utils/supabase/client';

import { Button, Empty, Field, Message, Pill, Section, StoreSelect, inputClass, rpc, type Feedback, type Role, type Store } from './ui';

type Done = { obligation_id: string; period: string; done_at: string; note: string | null };
type Draft = Omit<Obligation, 'id' | 'active'> & { id: string };

const empty = (): Draft => ({
  id: '', store_id: null, title: '', description: null, recurrence: 'monthly', due_rule: 'day', due_day: null, due_month: null,
  due_date: null, refers_to_previous: true, remind_days: 7, responsible: null,
});
const STATE = {
  atrasado: { tone: 'red', text: 'Atrasado' },
  a_aproximar: { tone: 'amber', text: 'A aproximar' },
  em_dia: { tone: 'grey', text: 'Em dia' },
  feito: { tone: 'green', text: 'Feito' },
} as const;

/** Prazos com aviso antes. O dia de cada prazo é o que o contabilista disser; o sistema só lembra. */
export function Obrigacoes({ stores, role }: { stores: Store[]; role: Role }) {
  const supabase = useMemo(() => createClient(), []);
  const [list, setList] = useState<Obligation[] | null>(null);
  const [done, setDone] = useState<Done[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const today = maputoToday();

  const load = useCallback(async () => {
    const [{ data: obs, error }, { data: ds }] = await Promise.all([
      supabase.from('office_obligations').select('*').eq('active', true).order('title'),
      supabase.from('office_obligation_done').select('*'),
    ]);
    if (error) setFeedback({ tone: 'erro', text: error.message });
    setList((obs ?? []) as Obligation[]);
    setDone((ds ?? []) as Done[]);
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  const rows = (list ?? [])
    .map((ob) => currentOccurrence(ob, new Set(done.filter((d) => d.obligation_id === ob.id).map((d) => d.period)), today))
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.due.localeCompare(b.due));

  async function mark(id: string, period: string, value: boolean) {
    const r = await rpc('mark_office_obligation', { p_id: id, p_period: period, p_done: value, p_note: null });
    setFeedback(r.ok ? { tone: 'ok', text: value ? 'Marcado como feito. O aviso deste período pára.' : 'Desmarcado.' } : { tone: 'erro', text: r.error });
    void load();
  }

  async function save(input: Draft, active = true) {
    const r = await rpc('save_office_obligation', {
      p: { ...input, id: input.id || null, store_id: input.store_id || null, active },
    });
    if (!r.ok) return setFeedback({ tone: 'erro', text: r.error });
    setFeedback({ tone: 'ok', text: active ? 'Obrigação guardada.' : 'Obrigação retirada.' });
    setDraft(null);
    void load();
  }

  const storeName = (id: string | null) => (id ? stores.find((s) => s.id === id)?.short_name ?? '' : 'Empresa');
  const missing = OBLIGATION_TEMPLATES.filter((t) => !(list ?? []).some((o) => o.title === t.title));

  return (
    <Section
      title="Obrigações"
      subtitle="O sistema avisa por email antes de cada prazo. As datas são as que o contabilista indicar."
      actions={role === 'owner' ? <Button onClick={() => setDraft(empty())}>Nova obrigação</Button> : undefined}
    >
      <Message feedback={feedback} />
      {role === 'owner' && missing.length > 0 && !draft && (
        <div className="rounded-xl border border-white/[0.08] p-4">
          <p className="text-sm text-white">Para começar, junta as mais comuns. As que vêm sem dia ficam à espera do prazo que o contabilista indicar.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {missing.map((t) => (
              <Button key={t.title} tone="ghost" onClick={() => setDraft({ ...empty(), ...t })}>+ {t.title}</Button>
            ))}
          </div>
        </div>
      )}
      {draft && <ObligationForm draft={draft} stores={stores} onSave={(d) => void save(d)} onCancel={() => setDraft(null)} />}
      {!list ? <p className="text-sm text-[#8b8378]">A carregar…</p> : rows.length === 0 ? <Empty>Sem obrigações definidas.</Empty> : (
        <div className="space-y-2">
          {rows.map((o) => {
            const st = STATE[o.state];
            return (
              <div key={o.obligation.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.08] p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-white">{o.obligation.title} <Pill tone={st.tone}>{st.text}</Pill></p>
                  <p className="text-xs text-[#8b8378]">
                    {storeName(o.obligation.store_id)} · {ruleText(o.obligation)} · {periodLabel(o.period)} · prazo {shortDate(o.due)}
                    {o.state !== 'feito' && (o.daysLeft < 0 ? ` · há ${-o.daysLeft} dia(s)` : ` · faltam ${o.daysLeft} dia(s)`)}
                    {o.obligation.responsible && ` · ${o.obligation.responsible}`}
                  </p>
                  {o.obligation.description && <p className="mt-1 text-xs text-[#C9BCAC]">{o.obligation.description}</p>}
                </div>
                <div className="flex gap-2">
                  {o.state === 'feito'
                    ? <Button tone="ghost" onClick={() => void mark(o.obligation.id, o.period, false)}>Desfazer</Button>
                    : <Button onClick={() => void mark(o.obligation.id, o.period, true)}>Feito</Button>}
                  {role === 'owner' && (
                    <>
                      <Button tone="ghost" onClick={() => setDraft({ ...o.obligation })}>Editar</Button>
                      <Button tone="danger" onClick={() => void save({ ...o.obligation }, false)}>Retirar</Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function ObligationForm({ draft, stores, onSave, onCancel }: { draft: Draft; stores: Store[]; onSave: (d: Draft) => void; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(draft);
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  return (
    <div className="space-y-3 rounded-xl border border-[#e5a93c]/40 bg-[#e5a93c]/[0.05] p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Obrigação"><input className={inputClass} value={d.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="De quem é"><StoreSelect stores={stores} value={d.store_id ?? ''} onChange={(v) => set({ store_id: v || null })} allowCompany /></Field>
        <Field label="Repete">
          <select className={inputClass} value={d.recurrence} onChange={(e) => set({ recurrence: e.target.value as Draft['recurrence'] })}>
            <option value="monthly">Todos os meses</option>
            <option value="yearly">Todos os anos</option>
            <option value="once">Uma vez</option>
          </select>
        </Field>
        {d.recurrence === 'once' ? (
          <Field label="Data"><input className={inputClass} type="date" value={d.due_date ?? ''} onChange={(e) => set({ due_date: e.target.value || null })} /></Field>
        ) : (
          <>
            <Field label="Prazo">
              <select className={inputClass} value={d.due_rule} onChange={(e) => set({ due_rule: e.target.value as Draft['due_rule'] })}>
                <option value="day">Num dia do mês</option>
                <option value="last_business_day">Último dia útil</option>
              </select>
            </Field>
            {d.due_rule === 'day' && (
              <Field label="Dia" hint="Confirmar com o contabilista.">
                <input className={inputClass} type="number" min={1} max={31} value={d.due_day ?? ''} onChange={(e) => set({ due_day: e.target.value ? Number(e.target.value) : null })} />
              </Field>
            )}
            {d.recurrence === 'yearly' && (
              <Field label="Mês">
                <select className={inputClass} value={d.due_month ?? ''} onChange={(e) => set({ due_month: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">—</option>
                  {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{monthName(i + 1)}</option>)}
                </select>
              </Field>
            )}
            <Field label="Diz respeito a">
              <select className={inputClass} value={d.refers_to_previous ? 'prev' : 'same'} onChange={(e) => set({ refers_to_previous: e.target.value === 'prev' })}>
                <option value="prev">{d.recurrence === 'yearly' ? 'Ao ano anterior' : 'Ao mês anterior (ex.: IVA de Outubro em Novembro)'}</option>
                <option value="same">{d.recurrence === 'yearly' ? 'Ao próprio ano' : 'Ao próprio mês'}</option>
              </select>
            </Field>
          </>
        )}
        <Field label="Avisar com quantos dias"><input className={inputClass} type="number" min={0} max={60} value={d.remind_days} onChange={(e) => set({ remind_days: Number(e.target.value) })} /></Field>
        <Field label="Responsável"><input className={inputClass} value={d.responsible ?? ''} onChange={(e) => set({ responsible: e.target.value || null })} placeholder="Contabilista" /></Field>
        <Field label="Notas" wide><input className={inputClass} value={d.description ?? ''} onChange={(e) => set({ description: e.target.value || null })} /></Field>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => onSave(d)}>Guardar</Button>
        <Button tone="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </div>
  );
}
