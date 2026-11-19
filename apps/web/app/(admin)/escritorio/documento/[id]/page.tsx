'use client';

import { useEffect, useState } from 'react';

import type { FiscalDocumentPayload } from '@delivery/receipt';
import { methodLabel } from '@delivery/receipt';
import { formatNuit, money, officeError, shortDate } from '@/lib/escritorio/regras';
import { createClient } from '@/utils/supabase/client';

type Doc = Omit<FiscalDocumentPayload, 'template' | 'format_version'> & { voided: boolean };

const TITLE = { FR: 'Factura-Recibo', NC: 'Nota de Crédito' } as const;
const REGIME = { normal: 'Regime normal de IVA', ispc: 'Regime ISPC', isento: 'Isento de IVA' } as const;
const time = (iso: string) => new Intl.DateTimeFormat('pt-PT', { timeZone: 'Africa/Maputo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso));
const percent = (bp: number) => `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2).replace('.', ',')}%`;

/**
 * O documento fiscal em A4, para imprimir ou guardar em PDF pelo browser (ADR 0014). Lê só o que ficou gravado
 * no documento. Uma 2.ª impressão daqui não é 2.ª via oficial: essa sai no talão, com registo.
 */
export default function FiscalDocumentA4({ params }: { params: { id: string } }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void createClient().rpc('get_fiscal_document', { p_id: params.id }).then(({ data, error: e }) => {
      if (e) setError(officeError(e.message));
      else setDoc(data as Doc);
    });
  }, [params.id]);

  if (error) return <p className="p-6 text-sm text-red-300">{error}</p>;
  if (!doc) return <p className="p-6 text-sm text-[#8b8378]">A carregar…</p>;

  const rates = new Map<number, { base: number; vat: number; reason: string | null }>();
  for (const l of doc.lines) {
    const r = rates.get(l.vat_bp) ?? { base: 0, vat: 0, reason: l.exemption_reason };
    r.base += l.base_cents;
    r.vat += l.vat_cents;
    rates.set(l.vat_bp, r);
  }
  const buyerNuit = (doc.buyer.nuit ?? '').trim();

  return (
    <div className="p-4">
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print {
          body * { visibility: hidden !important; }
          .fiscal-a4, .fiscal-a4 * { visibility: visible !important; }
          .fiscal-a4 { position: absolute; left: 0; top: 0; width: 100%; box-shadow: none !important; margin: 0 !important; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="no-print mb-4 flex gap-2">
        <button onClick={() => window.print()} className="rounded-xl bg-[#e5a93c] px-4 py-2 text-sm font-bold text-black">Imprimir / guardar PDF</button>
        {doc.voided && <span className="rounded-xl border border-red-800 px-3 py-2 text-sm text-red-300">Documento anulado por Nota de Crédito</span>}
      </div>

      <article className="fiscal-a4 mx-auto max-w-[210mm] bg-white p-[12mm] text-[10pt] leading-snug text-[#111] shadow-xl" style={{ fontFamily: 'Calibri, "Segoe UI", Arial, sans-serif' }}>
        <header className="flex items-start justify-between gap-8">
          <div>
            <p className="text-[15pt] font-bold">{doc.issuer.name}</p>
            <p>NUIT {formatNuit(doc.issuer.nuit)}</p>
            <p>Sede: {doc.issuer.address}</p>
            {doc.issuer.store_name && <p>Estabelecimento: {[doc.issuer.store_name, doc.issuer.store_address].filter(Boolean).join(' — ')}</p>}
            {doc.issuer.store_phone && <p>Tel. {doc.issuer.store_phone}</p>}
            <p>{REGIME[doc.issuer.regime]}</p>
          </div>
          <div className="min-w-[68mm] border-[1.5px] border-[#111] p-3 text-right">
            <p className="text-[15pt] font-bold uppercase">{TITLE[doc.doc_type]}</p>
            <p className="text-[12pt] font-bold">{doc.full_number}</p>
            <table className="mt-2 w-full text-[9pt]">
              <tbody>
                <tr><td className="text-left text-[#555]">Data de emissão</td><td>{shortDate(doc.issue_date)}</td></tr>
                <tr><td className="text-left text-[#555]">Hora</td><td>{time(doc.emitted_at)}</td></tr>
                {doc.order_numbers?.length ? <tr><td className="text-left text-[#555]">Pedido</td><td>{doc.order_numbers.join(', ')}</td></tr> : null}
                {doc.origin_number && <tr><td className="text-left text-[#555]">{doc.doc_type === 'NC' ? 'Documento de origem' : 'Substitui'}</td><td>{doc.origin_number}</td></tr>}
              </tbody>
            </table>
          </div>
        </header>

        <section className="mt-6 grid grid-cols-2 gap-5">
          <div className="border border-[#999] p-3">
            <p className="text-[8.5pt] font-bold uppercase tracking-wide text-[#555]">Adquirente</p>
            {buyerNuit ? (
              <>
                <p className="font-bold">{doc.buyer.name}</p>
                <p>NUIT {formatNuit(buyerNuit)}</p>
                {doc.buyer.address && <p>{doc.buyer.address}</p>}
              </>
            ) : <p>Consumidor final</p>}
          </div>
          <div className="border border-[#999] p-3">
            <p className="text-[8.5pt] font-bold uppercase tracking-wide text-[#555]">{doc.doc_type === 'NC' ? 'Motivo' : 'Condições'}</p>
            {doc.doc_type === 'NC' ? <p>{doc.reason}</p> : (
              <>
                <p>Moeda: Metical (MT)</p>
                <p>Pagamento: no acto, a pronto</p>
                <p>Bens disponibilizados na data do documento</p>
              </>
            )}
          </div>
        </section>

        <table className="mt-6 w-full border-collapse text-[9.5pt]">
          <thead>
            <tr className="border-y-[1.5px] border-[#111] bg-[#eee] text-left">
              <th className="p-2">#</th><th className="p-2">Descrição</th><th className="p-2 text-right">Qtd</th><th className="p-2 text-right">Preço unit. s/IVA</th>
              <th className="p-2 text-right">Taxa IVA</th><th className="p-2 text-right">Valor IVA</th><th className="p-2 text-right">Valor s/IVA</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l) => (
              <tr key={l.position} className="border-b border-[#ccc]">
                <td className="p-2">{l.position}</td><td className="p-2">{l.description}</td><td className="p-2 text-right">{l.quantity}</td>
                <td className="p-2 text-right">{money(l.unit_price_cents)}</td><td className="p-2 text-right">{percent(l.vat_bp)}</td>
                <td className="p-2 text-right">{money(l.vat_cents)}</td><td className="p-2 text-right">{money(l.base_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="mt-5 grid grid-cols-2 gap-8">
          <div>
            <table className="w-full border-collapse text-[9.5pt]">
              <thead><tr className="bg-[#eee]"><th className="border border-[#999] p-2 text-left">Resumo do IVA</th><th className="border border-[#999] p-2 text-right">Incidência</th><th className="border border-[#999] p-2 text-right">IVA</th></tr></thead>
              <tbody>
                {[...rates.entries()].map(([bp, r]) => (
                  <tr key={bp}>
                    <td className="border border-[#999] p-2">{percent(bp)}{bp === 0 && r.reason ? ` — ${r.reason}` : ''}</td>
                    <td className="border border-[#999] p-2 text-right">{money(r.base)}</td>
                    <td className="border border-[#999] p-2 text-right">{money(r.vat)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {doc.doc_type === 'FR' && (
              <div className="mt-4 border border-[#999] p-3">
                <p className="text-[8.5pt] font-bold uppercase tracking-wide text-[#555]">Recibo</p>
                <p className="flex justify-between"><span>Meio de pagamento</span><span>{methodLabel(doc.payment_method)}</span></p>
                {doc.cash_received_cents != null && <p className="flex justify-between"><span>Valor recebido</span><span>{money(doc.cash_received_cents)}</span></p>}
                {doc.change_cents != null && <p className="flex justify-between"><span>Troco</span><span>{money(doc.change_cents)}</span></p>}
                <p className="flex justify-between font-bold"><span>Valor pago (MT)</span><span>{money(doc.total_cents)}</span></p>
                <p className="mt-1 text-[8.5pt] text-[#555]">Documento que serve de factura e de recibo.</p>
              </div>
            )}
          </div>
          <div>
            <p className="flex justify-between py-1"><span>Total sem IVA</span><span>{money(doc.base_cents)}</span></p>
            <p className="flex justify-between py-1"><span>Total do IVA</span><span>{money(doc.vat_cents)}</span></p>
            <p className="mt-1 flex justify-between border-t-[1.5px] border-[#111] pt-2 text-[13pt] font-bold">
              <span>{doc.doc_type === 'NC' ? 'TOTAL CREDITADO (MT)' : 'TOTAL (MT)'}</span><span>{money(doc.total_cents)}</span>
            </p>
          </div>
        </section>

        <footer className="mt-10 flex items-end justify-between gap-6 border-t border-[#999] pt-3 text-[8.5pt] text-[#333]">
          <div>
            {doc.operator && <p>Operador: {doc.operator}</p>}
            <p>Processado por programa informático {doc.product ?? 'WinTable'}</p>
            {doc.issuer.at_certificate?.trim() && <p>Certificação AT n.º {doc.issuer.at_certificate.trim()}</p>}
          </div>
          <p className="border-[1.5px] border-[#111] px-4 py-2 text-[10pt] font-bold text-[#111]">Código de controlo: {doc.control_code}</p>
        </footer>
      </article>
    </div>
  );
}
