'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  PURCHASE_CATEGORIES, cleanNuit, formatNuit, isValidNuit, maputoToday, money, parseMoney, shortDate, storagePath, vatInsideTotal,
} from '@/lib/escritorio/regras';
import { createClient } from '@/utils/supabase/client';

import { PeriodPicker } from './resumo';
import { Button, Empty, Field, Message, Pill, Section, inputClass, openOfficeFile, rpc, uploadOfficeFile, type Feedback, type Store } from './ui';

type Purchase = {
  id: string; store_id: string; supplier_name: string; supplier_nuit: string | null; invoice_number: string; invoice_date: string;
  category: string; total_cents: number; vat_cents: number; deductible: boolean; file_path: string | null; notes: string | null;
  status: 'active' | 'voided'; void_reason: string | null;
};
type Period = { year: number; month: number };

const blank = (storeId: string) => ({
  id: '', store_id: storeId, supplier_name: '', supplier_nuit: '', invoice_number: '', invoice_date: maputoToday(), category: 'mercadoria',
  total: '', vat: '', vatMode: '16' as '16' | '0' | 'manual', deductible: true, notes: '', file: null as File | null, file_path: '',
});

/** As facturas dos fornecedores do mês, com a foto, para o IVA a deduzir. */
export function Compras({ stores, period, onPeriod }: { stores: Store[]; period: Period; onPeriod: (p: Period) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Purchase[] | null>(null);
  const [form, setForm] = useState<ReturnType<typeof blank> | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const from = `${period.year}-${String(period.month).padStart(2, '0')}-01`;
    const next = period.month === 12 ? `${period.year + 1}-01-01` : `${period.year}-${String(period.month + 1).padStart(2, '0')}-01`;
    const { data, error } = await supabase.from('supplier_invoices').select('*')
      .gte('invoice_date', from).lt('invoice_date', next).order('invoice_date', { ascending: false });
    if (error) setFeedback({ tone: 'erro', text: error.message });
    setRows((data ?? []) as Purchase[]);
  }, [supabase, period]);
  useEffect(() => { void load(); }, [load]);

  const totalCents = form ? parseMoney(form.total) : null;
  const vatCents = form && totalCents != null
    ? form.vatMode === 'manual' ? parseMoney(form.vat) ?? 0 : vatInsideTotal(totalCents, form.vatMode === '16' ? 1600 : 0)
    : null;

  async function save() {
    if (!form) return;
    if (!form.store_id) return setFeedback({ tone: 'erro', text: 'Escolhe a loja.' });
    if (!form.supplier_name.trim() || !form.invoice_number.trim()) return setFeedback({ tone: 'erro', text: 'Falta o fornecedor ou o número da factura.' });
    if (form.supplier_nuit.trim() && !isValidNuit(form.supplier_nuit)) return setFeedback({ tone: 'erro', text: 'O NUIT do fornecedor tem 9 dígitos.' });
    if (totalCents == null || totalCents <= 0) return setFeedback({ tone: 'erro', text: 'Escreve o total da factura (ex.: 1.160,00).' });
    if (vatCents == null || vatCents >= totalCents) return setFeedback({ tone: 'erro', text: 'O IVA tem de ser menor do que o total.' });
    setBusy(true);
    setFeedback(null);
    let filePath = form.file_path;
    if (form.file) {
      const up = await uploadOfficeFile(storagePath('purchases', crypto.randomUUID(), form.file.name), form.file);
      if (!up.ok) { setBusy(false); return setFeedback({ tone: 'erro', text: up.error }); }
      filePath = up.path;
    }
    const r = await rpc('save_supplier_invoice', {
      p: {
        ...(form.id ? { id: form.id } : {}), store_id: form.store_id, supplier_name: form.supplier_name,
        supplier_nuit: form.supplier_nuit.trim() ? cleanNuit(form.supplier_nuit) : null, invoice_number: form.invoice_number,
        invoice_date: form.invoice_date, category: form.category, total_cents: totalCents, vat_cents: vatCents,
        deductible: form.deductible, notes: form.notes, file_path: filePath || null,
      },
    });
    setBusy(false);
    if (!r.ok) return setFeedback({ tone: 'erro', text: r.error });
    setFeedback({ tone: 'ok', text: form.id ? 'Compra actualizada.' : 'Compra registada.' });
    setForm(null);
    void load();
  }

  async function voidRow(row: Purchase) {
    const reason = window.prompt(`Porque anulas a compra ${row.invoice_number} de ${row.supplier_name}?`);
    if (!reason?.trim()) return;
    const r = await rpc('void_supplier_invoice', { p_id: row.id, p_reason: reason });
    setFeedback(r.ok ? { tone: 'ok', text: 'Compra anulada (fica no histórico).' } : { tone: 'erro', text: r.error });
    void load();
  }

  const active = (rows ?? []).filter((r) => r.status === 'active');
  const vatTotal = active.filter((r) => r.deductible).reduce((t, r) => t + r.vat_cents, 0);
  const storeName = (id: string) => stores.find((s) => s.id === id)?.short_name ?? '';

  return (
    <Section
      title="Compras com IVA"
      subtitle="Regista cada factura de fornecedor com a fotografia. O IVA das dedutíveis entra no resumo do mês."
      actions={<><PeriodPicker period={period} onPeriod={onPeriod} /><Button onClick={() => setForm(blank(stores[0]?.id ?? ''))}>Nova compra</Button></>}
    >
      <Message feedback={feedback} />
      {form && (
        <div className="space-y-3 rounded-xl border border-[#e5a93c]/40 bg-[#e5a93c]/[0.05] p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Loja">
              <select className={inputClass} value={form.store_id} onChange={(e) => setForm({ ...form, store_id: e.target.value })} disabled={Boolean(form.id)}>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.short_name}</option>)}
              </select>
            </Field>
            <Field label="Fornecedor"><input className={inputClass} value={form.supplier_name} onChange={(e) => setForm({ ...form, supplier_name: e.target.value })} /></Field>
            <Field label="NUIT do fornecedor"><input className={inputClass} inputMode="numeric" value={form.supplier_nuit} onChange={(e) => setForm({ ...form, supplier_nuit: e.target.value })} /></Field>
            <Field label="N.º da factura"><input className={inputClass} value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} /></Field>
            <Field label="Data da factura"><input className={inputClass} type="date" max={maputoToday()} value={form.invoice_date} onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} /></Field>
            <Field label="Categoria">
              <select className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {Object.entries(PURCHASE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Total com IVA (MT)"><input className={inputClass} inputMode="decimal" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} placeholder="1.160,00" /></Field>
            <Field label="IVA" hint={vatCents != null ? `IVA: ${money(vatCents)} MT` : undefined}>
              <div className="flex gap-2">
                <select className={inputClass} value={form.vatMode} onChange={(e) => setForm({ ...form, vatMode: e.target.value as '16' | '0' | 'manual' })}>
                  <option value="16">16 % incluído</option>
                  <option value="0">Sem IVA</option>
                  <option value="manual">Escrever o valor</option>
                </select>
                {form.vatMode === 'manual' && <input className={inputClass} inputMode="decimal" value={form.vat} onChange={(e) => setForm({ ...form, vat: e.target.value })} placeholder="160,00" />}
              </div>
            </Field>
            <Field label="Fotografia ou PDF" hint={form.file_path && !form.file ? 'Já tem ficheiro. Escolhe outro para substituir.' : 'Até 10 MB.'} wide>
              <input className={inputClass} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment"
                onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })} />
            </Field>
            <Field label="Notas" wide><input className={inputClass} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-[#C9BCAC]">
            <input type="checkbox" checked={form.deductible} onChange={(e) => setForm({ ...form, deductible: e.target.checked })} />
            IVA dedutível (confirmar com o contabilista em despesas como renda ou viaturas)
          </label>
          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={busy}>{busy ? 'A guardar…' : 'Guardar'}</Button>
            <Button tone="ghost" onClick={() => setForm(null)} disabled={busy}>Cancelar</Button>
          </div>
        </div>
      )}
      {!rows ? <p className="text-sm text-[#8b8378]">A carregar…</p> : rows.length === 0 ? <Empty>Sem compras registadas neste mês.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs text-[#8b8378]">
              <tr><th className="py-2">Data</th><th>Loja</th><th>Fornecedor</th><th>Factura</th><th>Categoria</th><th className="text-right">Total</th><th className="text-right">IVA</th><th /></tr>
            </thead>
            <tbody className="text-[#E9DFD2]">
              {rows.map((row) => (
                <tr key={row.id} className={`border-t border-white/[0.06] ${row.status === 'voided' ? 'opacity-50' : ''}`}>
                  <td className="py-2">{shortDate(row.invoice_date)}</td>
                  <td>{storeName(row.store_id)}</td>
                  <td>{row.supplier_name}{row.supplier_nuit && <span className="block text-[11px] text-[#8b8378]">NUIT {formatNuit(row.supplier_nuit)}</span>}</td>
                  <td>{row.invoice_number}</td>
                  <td>{PURCHASE_CATEGORIES[row.category] ?? row.category}{!row.deductible && <span className="block text-[11px] text-[#8b8378]">IVA não dedutível</span>}</td>
                  <td className="text-right">{money(row.total_cents)}</td>
                  <td className="text-right">{money(row.vat_cents)}</td>
                  <td className="whitespace-nowrap text-right">
                    {row.status === 'voided' ? <Pill tone="grey">Anulada</Pill> : (
                      <>
                        {row.file_path && <button className="mr-3 text-[#e5a93c] hover:underline" onClick={() => void openOfficeFile(row.file_path!)}>Ver</button>}
                        <button className="mr-3 text-[#e5a93c] hover:underline" onClick={() => setForm({
                          ...blank(row.store_id), id: row.id, supplier_name: row.supplier_name, supplier_nuit: row.supplier_nuit ?? '',
                          invoice_number: row.invoice_number, invoice_date: row.invoice_date, category: row.category,
                          total: money(row.total_cents), vat: money(row.vat_cents), vatMode: 'manual', deductible: row.deductible,
                          notes: row.notes ?? '', file_path: row.file_path ?? '',
                        })}>Editar</button>
                        <button className="text-red-300 hover:underline" onClick={() => void voidRow(row)}>Anular</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-[#8b8378]">{active.length} compra(s) · IVA dedutível do mês: <b className="text-white">{money(vatTotal)} MT</b></p>
        </div>
      )}
    </Section>
  );
}
