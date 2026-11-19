'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { cleanNuit, formatNuit, isValidNuit, money, parseMoney, shortDate } from '@/lib/escritorio/regras';
import { createClient } from '@/utils/supabase/client';

import { Button, Empty, Field, Message, Section, StoreSelect, inputClass, rpc, type Feedback, type Store } from './ui';

type Employee = {
  id: string; store_id: string | null; full_name: string; job_title: string | null; nuit: string | null; inss_number: string | null;
  id_document: string | null; phone: string | null; hired_on: string | null; left_on: string | null; base_salary_cents: number | null; notes: string | null;
};
type Draft = Omit<Employee, 'base_salary_cents'> & { salary: string };
const empty = (): Draft => ({
  id: '', store_id: null, full_name: '', job_title: null, nuit: null, inss_number: null, id_document: null, phone: null,
  hired_on: null, left_on: null, notes: null, salary: '',
});

const csvCell = (v: string) => (/[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** A ficha de cada trabalhador para o contabilista. Só o dono vê (salário e documentos pessoais). */
export function Pessoal({ stores }: { stores: Store[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [list, setList] = useState<Employee[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('office_employees').select('*').order('full_name');
    if (error) setFeedback({ tone: 'erro', text: error.message });
    setList((data ?? []) as Employee[]);
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  async function save(d: Draft) {
    if (!d.full_name.trim()) return setFeedback({ tone: 'erro', text: 'Falta o nome.' });
    if (d.nuit && !isValidNuit(d.nuit)) return setFeedback({ tone: 'erro', text: 'O NUIT tem 9 dígitos.' });
    const salary = d.salary.trim() ? parseMoney(d.salary) : null;
    if (d.salary.trim() && salary == null) return setFeedback({ tone: 'erro', text: 'Não percebi o salário (ex.: 15.000,00).' });
    const rest: Partial<Draft> = { ...d };
    delete rest.salary;
    const r = await rpc('save_office_employee', {
      p: { ...rest, id: d.id || null, store_id: d.store_id || null, nuit: d.nuit ? cleanNuit(d.nuit) : null, base_salary_cents: salary },
    });
    if (!r.ok) return setFeedback({ tone: 'erro', text: r.error });
    setFeedback({ tone: 'ok', text: 'Ficha guardada.' });
    setDraft(null);
    void load();
  }

  function exportCsv() {
    const rows = (list ?? []).filter((e) => !e.left_on);
    const header = ['Nome', 'Função', 'Loja', 'NUIT', 'N.º INSS', 'Documento de identificação', 'Telefone', 'Admissão', 'Salário base (MT)'];
    const lines = rows.map((e) => [
      e.full_name, e.job_title ?? '', storeName(e.store_id), e.nuit ?? '', e.inss_number ?? '', e.id_document ?? '', e.phone ?? '',
      e.hired_on ?? '', e.base_salary_cents == null ? '' : (e.base_salary_cents / 100).toFixed(2),
    ]);
    const body = `\uFEFF${[header, ...lines].map((l) => l.map(csvCell).join(';')).join('\r\n')}\r\n`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
    link.download = 'pessoal.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const storeName = (id: string | null) => (id ? stores.find((s) => s.id === id)?.short_name ?? '' : 'Empresa');
  const visible = (list ?? []).filter((e) => Boolean(e.left_on) === showLeft);

  return (
    <Section
      title="Pessoal"
      subtitle="Para o contabilista processar salários, INSS e retenções. Só tu vês esta aba."
      actions={<>
        <Button tone="ghost" onClick={() => setShowLeft((v) => !v)}>{showLeft ? 'Ver activos' : 'Ver quem saiu'}</Button>
        <Button tone="ghost" onClick={exportCsv} disabled={!list?.length}>Exportar (CSV)</Button>
        <Button onClick={() => setDraft(empty())}>Novo trabalhador</Button>
      </>}
    >
      <Message feedback={feedback} />
      {draft && (
        <div className="space-y-3 rounded-xl border border-[#e5a93c]/40 bg-[#e5a93c]/[0.05] p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Nome completo"><input className={inputClass} value={draft.full_name} onChange={(e) => setDraft({ ...draft, full_name: e.target.value })} /></Field>
            <Field label="Função"><input className={inputClass} value={draft.job_title ?? ''} onChange={(e) => setDraft({ ...draft, job_title: e.target.value || null })} placeholder="Cozinheiro" /></Field>
            <Field label="Loja"><StoreSelect stores={stores} value={draft.store_id ?? ''} onChange={(v) => setDraft({ ...draft, store_id: v || null })} allowCompany /></Field>
            <Field label="NUIT"><input className={inputClass} inputMode="numeric" value={draft.nuit ?? ''} onChange={(e) => setDraft({ ...draft, nuit: e.target.value || null })} /></Field>
            <Field label="N.º de beneficiário do INSS"><input className={inputClass} value={draft.inss_number ?? ''} onChange={(e) => setDraft({ ...draft, inss_number: e.target.value || null })} /></Field>
            <Field label="BI / documento"><input className={inputClass} value={draft.id_document ?? ''} onChange={(e) => setDraft({ ...draft, id_document: e.target.value || null })} /></Field>
            <Field label="Telefone"><input className={inputClass} value={draft.phone ?? ''} onChange={(e) => setDraft({ ...draft, phone: e.target.value || null })} /></Field>
            <Field label="Data de admissão"><input className={inputClass} type="date" value={draft.hired_on ?? ''} onChange={(e) => setDraft({ ...draft, hired_on: e.target.value || null })} /></Field>
            <Field label="Data de saída" hint="Só se já saiu."><input className={inputClass} type="date" value={draft.left_on ?? ''} onChange={(e) => setDraft({ ...draft, left_on: e.target.value || null })} /></Field>
            <Field label="Salário base (MT)"><input className={inputClass} inputMode="decimal" value={draft.salary} onChange={(e) => setDraft({ ...draft, salary: e.target.value })} /></Field>
            <Field label="Notas" wide><input className={inputClass} value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })} /></Field>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void save(draft)}>Guardar</Button>
            <Button tone="ghost" onClick={() => setDraft(null)}>Cancelar</Button>
          </div>
        </div>
      )}
      {!list ? <p className="text-sm text-[#8b8378]">A carregar…</p> : visible.length === 0 ? <Empty>{showLeft ? 'Ninguém saiu.' : 'Sem trabalhadores registados.'}</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-[#8b8378]">
              <tr><th className="py-2">Nome</th><th>Função</th><th>Loja</th><th>NUIT</th><th>INSS</th><th>Admissão</th><th className="text-right">Salário base</th><th /></tr>
            </thead>
            <tbody className="text-[#E9DFD2]">
              {visible.map((e) => (
                <tr key={e.id} className="border-t border-white/[0.06]">
                  <td className="py-2 font-bold">{e.full_name}</td>
                  <td>{e.job_title ?? '—'}</td>
                  <td>{storeName(e.store_id)}</td>
                  <td>{e.nuit ? formatNuit(e.nuit) : <span className="text-amber-300">em falta</span>}</td>
                  <td>{e.inss_number ?? <span className="text-amber-300">em falta</span>}</td>
                  <td>{shortDate(e.hired_on)}</td>
                  <td className="text-right">{e.base_salary_cents == null ? '—' : money(e.base_salary_cents)}</td>
                  <td className="text-right">
                    <button className="text-[#e5a93c] hover:underline" onClick={() => setDraft({ ...e, salary: e.base_salary_cents == null ? '' : money(e.base_salary_cents) })}>Editar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
