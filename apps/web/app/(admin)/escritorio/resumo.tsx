'use client';

import { useCallback, useEffect, useState } from 'react';

import { addMonths, money, monthName } from '@/lib/escritorio/regras';

import { Button, Empty, Message, Section, downloadMonthFile, rpc, type Feedback } from './ui';

type StoreMonth = {
  store_id: string; store_name: string; fr_count: number; nc_count: number;
  sales_total_cents: number; sales_base_cents: number; vat_output_cents: number;
  purchases_count: number; purchases_total_cents: number; vat_input_cents: number; vat_balance_cents: number;
  by_method: Record<string, number>;
};
type Summary = { year: number; month: number; stores: StoreMonth[] };
type Period = { year: number; month: number };

const METHOD: Record<string, string> = { cash: 'Numerário', mpesa: 'M-Pesa', emola: 'e-Mola', credit_card: 'Cartão', outro: 'Outro' };

export function PeriodPicker({ period, onPeriod }: { period: Period; onPeriod: (p: Period) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button tone="ghost" onClick={() => onPeriod(addMonths(period.year, period.month, -1))}>‹</Button>
      <span className="min-w-36 text-center font-bold text-white">{monthName(period.month)} de {period.year}</span>
      <Button tone="ghost" onClick={() => onPeriod(addMonths(period.year, period.month, 1))}>›</Button>
    </div>
  );
}

/** O mês por loja: o que se vendeu com factura, o IVA liquidado, o das compras e o saldo, e os ficheiros. */
export function Resumo({ period, onPeriod }: { period: Period; onPeriod: (p: Period) => void }) {
  const [data, setData] = useState<Summary | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(null);
    const r = await rpc<Summary>('office_month_summary', { p_year: period.year, p_month: period.month });
    if (r.ok) setData(r.data);
    else setFeedback({ tone: 'erro', text: r.error });
  }, [period]);
  useEffect(() => { void load(); }, [load]);

  async function download(format: 'csv' | 'xml' | 'compras') {
    setBusy(format);
    setFeedback(null);
    const error = await downloadMonthFile(period.year, period.month, format);
    setBusy(null);
    setFeedback(error ? { tone: 'erro', text: error } : { tone: 'ok', text: 'Ficheiro descarregado. Envia-o ao contabilista.' });
  }

  const total = data?.stores.reduce((t, s) => ({
    sales: t.sales + s.sales_total_cents, out: t.out + s.vat_output_cents, inp: t.inp + s.vat_input_cents, bal: t.bal + s.vat_balance_cents,
  }), { sales: 0, out: 0, inp: 0, bal: 0 });

  return (
    <>
      <Section
        title="Resumo do mês"
        subtitle="Valores com factura emitida, menos as notas de crédito. O IVA a pagar é uma estimativa: quem fecha as contas é o contabilista."
        actions={<PeriodPicker period={period} onPeriod={onPeriod} />}
      >
        <Message feedback={feedback} />
        {!data ? <p className="text-sm text-[#8b8378]">A carregar…</p> : data.stores.length === 0 ? <Empty>Sem lojas.</Empty> : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Vendas facturadas', total!.sales],
                ['IVA liquidado (vendas)', total!.out],
                ['IVA dedutível (compras)', total!.inp],
                [total!.bal >= 0 ? 'IVA a pagar (estimativa)' : 'IVA a recuperar (estimativa)', Math.abs(total!.bal)],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-xl border border-white/[0.08] p-4">
                  <p className="text-xs text-[#8b8378]">{label}</p>
                  <p className="mt-1 text-xl font-black text-white">{money(value as number)} <span className="text-xs font-normal text-[#8b8378]">MT</span></p>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs text-[#8b8378]">
                  <tr><th className="py-2">Loja</th><th>Facturas</th><th>Notas de crédito</th><th className="text-right">Vendas</th><th className="text-right">IVA vendas</th><th className="text-right">Compras</th><th className="text-right">IVA compras</th><th>Por meio</th></tr>
                </thead>
                <tbody className="text-[#E9DFD2]">
                  {data.stores.map((s) => (
                    <tr key={s.store_id} className="border-t border-white/[0.06]">
                      <td className="py-2 font-bold">{s.store_name}</td>
                      <td>{s.fr_count}</td>
                      <td>{s.nc_count}</td>
                      <td className="text-right">{money(s.sales_total_cents)}</td>
                      <td className="text-right">{money(s.vat_output_cents)}</td>
                      <td className="text-right">{money(s.purchases_total_cents)} <span className="text-[#8b8378]">({s.purchases_count})</span></td>
                      <td className="text-right">{money(s.vat_input_cents)}</td>
                      <td className="text-xs text-[#8b8378]">{Object.entries(s.by_method).map(([m, v]) => `${METHOD[m] ?? m} ${money(v)}`).join(' · ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      <Section
        title="Ficheiros para o contabilista"
        subtitle="O ficheiro das facturas é verificado antes de sair: se a cadeia de documentos não bater, não é entregue."
      >
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void download('csv')} disabled={busy !== null}>{busy === 'csv' ? 'A gerar…' : 'Facturas do mês (CSV, e-Declaração)'}</Button>
          <Button tone="ghost" onClick={() => void download('xml')} disabled={busy !== null}>{busy === 'xml' ? 'A gerar…' : 'SAF-T (XML)'}</Button>
          <Button tone="ghost" onClick={() => void download('compras')} disabled={busy !== null}>{busy === 'compras' ? 'A gerar…' : 'Compras do mês (CSV)'}</Button>
        </div>
        <p className="text-xs text-[#8b8378]">
          As colunas do ficheiro de facturas são provisórias até a AT enviar o modelo oficial. O ficheiro das facturas é só do dono.
        </p>
      </Section>
    </>
  );
}
