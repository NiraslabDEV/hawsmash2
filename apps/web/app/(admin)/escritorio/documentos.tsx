'use client';

import { useCallback, useEffect, useState } from 'react';

import { checkFiscalBuyer, formatNuit, money, shortDate } from '@/lib/escritorio/regras';

import { Button, Empty, Field, Message, Pill, Section, inputClass, rpc, type Feedback, type Role, type Store } from './ui';

type Row = {
  id: string; store_id: string; doc_type: 'FR' | 'NC'; full_number: string; issue_date: string; emitted_at: string;
  buyer_name: string | null; buyer_nuit: string | null; total_cents: number; vat_cents: number; origin_number: string | null;
  payment_method: string | null; voided: boolean; order_ids: string[] | null;
};
const PAGE = 30;

/** Facturas e notas de crédito: pesquisar, abrir em A4, 2.ª via no talão e reemitir com NUIT. */
export function Documentos({ stores, role }: { stores: Store[]; role: Role }) {
  const [storeId, setStoreId] = useState('');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ total: number; rows: Row[] } | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [reissue, setReissue] = useState<Row | null>(null);

  const load = useCallback(async () => {
    const r = await rpc<{ total: number; rows: Row[] }>('list_fiscal_documents', {
      p_store_id: storeId || null, p_from: from || null, p_to: to || null, p_search: search.trim() || null,
      p_type: type || null, p_limit: PAGE, p_offset: page * PAGE,
    });
    if (r.ok) setData(r.data);
    else setFeedback({ tone: 'erro', text: r.error });
  }, [storeId, type, search, from, to, page]);
  useEffect(() => { void load(); }, [load]);

  async function reprint(row: Row) {
    const r = await rpc('reprint_fiscal_document', { p_id: row.id });
    setFeedback(r.ok ? { tone: 'ok', text: `2.ª via de ${row.full_number} enviada para a impressora da loja.` } : { tone: 'erro', text: r.error });
  }

  const storeName = (id: string) => stores.find((s) => s.id === id)?.short_name ?? '';

  return (
    <Section title="Facturas e notas de crédito" subtitle="Um documento emitido não se altera nem se apaga. Corrige-se com uma Nota de Crédito.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <select className={inputClass} value={storeId} onChange={(e) => { setStoreId(e.target.value); setPage(0); }}>
          <option value="">Todas as lojas</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.short_name}</option>)}
        </select>
        <select className={inputClass} value={type} onChange={(e) => { setType(e.target.value); setPage(0); }}>
          <option value="">Facturas e notas de crédito</option>
          <option value="FR">Só Facturas-Recibo</option>
          <option value="NC">Só Notas de Crédito</option>
        </select>
        <input className={inputClass} type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} aria-label="Desde" />
        <input className={inputClass} type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} aria-label="Até" />
        <input className={inputClass} placeholder="Número, NUIT ou nome" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
      </div>
      <Message feedback={feedback} />
      {reissue && (
        <ReissueForm row={reissue} onDone={(text) => { setReissue(null); setFeedback({ tone: 'ok', text }); void load(); }} onCancel={() => setReissue(null)} />
      )}
      {!data ? <p className="text-sm text-[#8b8378]">A carregar…</p> : data.rows.length === 0 ? (
        <Empty>Sem documentos neste filtro. Com a facturação desligada, não há documentos fiscais.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs text-[#8b8378]">
              <tr><th className="py-2">Documento</th><th>Data</th><th>Loja</th><th>Adquirente</th><th className="text-right">Total (MT)</th><th>Estado</th><th /></tr>
            </thead>
            <tbody className="text-[#E9DFD2]">
              {data.rows.map((row) => (
                <tr key={row.id} className="border-t border-white/[0.06]">
                  <td className="py-2 font-bold">{row.full_number}{row.origin_number && <span className="block text-[11px] font-normal text-[#8b8378]">ref. {row.origin_number}</span>}</td>
                  <td>{shortDate(row.issue_date)}</td>
                  <td>{storeName(row.store_id)}</td>
                  <td>{row.buyer_nuit ? <>{row.buyer_name}<span className="block text-[11px] text-[#8b8378]">NUIT {formatNuit(row.buyer_nuit)}</span></> : 'Consumidor final'}</td>
                  <td className="text-right">{row.doc_type === 'NC' ? '-' : ''}{money(row.total_cents)}</td>
                  <td>{row.doc_type === 'NC' ? <Pill tone="grey">Nota de crédito</Pill> : row.voided ? <Pill tone="red">Anulada</Pill> : <Pill tone="green">Em vigor</Pill>}</td>
                  <td className="whitespace-nowrap text-right">
                    <a className="mr-3 text-[#e5a93c] hover:underline" href={`/escritorio/documento/${row.id}`} target="_blank" rel="noopener">A4</a>
                    <button className="mr-3 text-[#e5a93c] hover:underline" onClick={() => void reprint(row)}>2.ª via</button>
                    {row.doc_type === 'FR' && !row.voided && (row.order_ids?.length ?? 0) > 0 && (
                      <button className="text-[#e5a93c] hover:underline" onClick={() => setReissue(row)}>NUIT</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex items-center justify-between text-xs text-[#8b8378]">
            <span>{data.total} documento(s)</span>
            <div className="flex gap-2">
              <Button tone="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anteriores</Button>
              <Button tone="ghost" disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage((p) => p + 1)}>Seguintes</Button>
            </div>
          </div>
        </div>
      )}
      {role === 'manager' && <p className="text-xs text-[#8b8378]">Vês só as lojas onde és gerente.</p>}
    </Section>
  );
}

/** Cliente pede NUIT depois: Nota de Crédito do original e Factura-Recibo nova com os dados certos. */
function ReissueForm({ row, onDone, onCancel }: { row: Row; onDone: (text: string) => void; onCancel: () => void }) {
  const [buyer, setBuyer] = useState({ nuit: '', name: '', address: '' });
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const check = checkFiscalBuyer(buyer);
    if (!check.ok) return setFeedback({ tone: 'erro', text: check.error });
    setBusy(true);
    const r = await rpc<{ full_number: string }>('fiscal_reissue', {
      p_order_id: row.order_ids![0], p_nuit: check.buyer.nuit, p_name: check.buyer.name, p_address: check.buyer.address || null,
    });
    setBusy(false);
    if (!r.ok) return setFeedback({ tone: 'erro', text: r.error });
    onDone(`${row.full_number} anulada por Nota de Crédito e reemitida como ${r.data.full_number}, com o NUIT ${formatNuit(check.buyer.nuit)}.`);
  }

  return (
    <div className="space-y-3 rounded-xl border border-[#e5a93c]/40 bg-[#e5a93c]/[0.05] p-4">
      <p className="text-sm text-white">
        Reemitir <b>{row.full_number}</b> com NUIT: sai uma Nota de Crédito do documento actual e uma Factura-Recibo nova, as duas impressas na loja.
      </p>
      <Message feedback={feedback} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="NUIT"><input className={inputClass} inputMode="numeric" value={buyer.nuit} onChange={(e) => setBuyer({ ...buyer, nuit: e.target.value })} placeholder="400 000 000" /></Field>
        <Field label="Nome ou empresa"><input className={inputClass} value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} /></Field>
        <Field label="Morada"><input className={inputClass} value={buyer.address} onChange={(e) => setBuyer({ ...buyer, address: e.target.value })} /></Field>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => void submit()} disabled={busy}>{busy ? 'A reemitir…' : 'Reemitir'}</Button>
        <Button tone="ghost" onClick={onCancel} disabled={busy}>Cancelar</Button>
      </div>
    </div>
  );
}
