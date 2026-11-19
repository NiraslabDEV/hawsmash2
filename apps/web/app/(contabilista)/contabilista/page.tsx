'use client';

import { useEffect, useState } from 'react';

import { formatNuit, money, monthName, officeError } from '@/lib/escritorio/regras';
import { createClient } from '@/utils/supabase/client';

type StoreMonth = {
  store_id: string; store_name: string; fr_count: number; nc_count: number; sales_total_cents: number;
  vat_output_cents: number; purchases_count: number; vat_input_cents: number; vat_balance_cents: number;
};
type Portal = {
  label: string;
  expires_at: string;
  company: { name: string; nuit: string; address: string; regime: string; active: boolean; at_certificate: string } | null;
  months: Array<{ year: number; month: number; stores: StoreMonth[] }>;
};

/**
 * Portal do contabilista (ADR 0014). O token vem depois do "#" no endereço: o browser não o manda ao servidor da
 * página. Vai só no corpo dos pedidos à BD e à rota de descarga. Só leitura: resumo e ficheiros do mês.
 */
export default function ContabilistaPage() {
  const [token, setToken] = useState<string | null>(null);
  const [portal, setPortal] = useState<Portal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const t = window.location.hash.slice(1);
    if (!/^[0-9a-f]{48}$/.test(t)) {
      setError('Endereço incompleto. Abra o endereço completo que a empresa lhe enviou.');
      return;
    }
    setToken(t);
    void createClient().rpc('accountant_portal', { p_token: t }).then(({ data, error: e }) => {
      if (e) setError(officeError(e.message));
      else setPortal(data as Portal);
    });
  }, []);

  async function download(year: number, month: number, format: 'csv' | 'xml' | 'compras') {
    if (!token) return;
    const key = `${year}-${month}-${format}`;
    setBusy(key);
    setError(null);
    const response = await fetch('/api/contabilista/export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, year, month, format }),
    });
    setBusy(null);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Não foi possível gerar o ficheiro.');
      return;
    }
    const blob = await response.blob();
    const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? `${year}-${month}.${format === 'xml' ? 'xml' : 'csv'}`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <header>
        <p className="text-xs uppercase tracking-widest text-[#e5a93c]">Acesso do contabilista</p>
        <h1 className="mt-1 text-2xl font-black text-white">{portal?.company?.name || 'Empresa'}</h1>
        {portal?.company?.nuit && <p className="text-sm text-[#8b8378]">NUIT {formatNuit(portal.company.nuit)} · {portal.company.address}</p>}
      </header>

      {error && <p className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-300">{error}</p>}
      {!portal && !error && <p className="text-sm text-[#8b8378]">A carregar…</p>}

      {portal && (
        <>
          {!portal.company?.active && (
            <p className="rounded-xl border border-amber-700 bg-amber-900/20 px-4 py-3 text-sm text-amber-300">
              A facturação desta empresa ainda está desligada: os meses sem documentos aparecem a zero.
            </p>
          )}
          {portal.months.map((m) => {
            const t = m.stores.reduce((a, s) => ({
              fr: a.fr + s.fr_count, nc: a.nc + s.nc_count, sales: a.sales + s.sales_total_cents,
              out: a.out + s.vat_output_cents, inp: a.inp + s.vat_input_cents, bal: a.bal + s.vat_balance_cents,
            }), { fr: 0, nc: 0, sales: 0, out: 0, inp: 0, bal: 0 });
            return (
              <section key={`${m.year}-${m.month}`} className="space-y-3 rounded-2xl border border-white/[0.08] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-black text-white">{monthName(m.month)} de {m.year}</h2>
                    <p className="text-sm text-[#8b8378]">
                      {t.fr} factura(s) · {t.nc} nota(s) de crédito · vendas {money(t.sales)} MT · IVA liquidado {money(t.out)} · IVA das compras {money(t.inp)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(['csv', 'xml', 'compras'] as const).map((f) => (
                      <button key={f} onClick={() => void download(m.year, m.month, f)} disabled={busy !== null}
                        className={`rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50 ${f === 'csv' ? 'bg-[#e5a93c] text-black' : 'border border-white/10 text-[#C9BCAC]'}`}>
                        {busy === `${m.year}-${m.month}-${f}` ? 'A gerar…' : f === 'csv' ? 'Facturas (CSV)' : f === 'xml' ? 'SAF-T (XML)' : 'Compras (CSV)'}
                      </button>
                    ))}
                  </div>
                </div>
                {m.stores.length > 1 && (
                  <table className="w-full text-sm">
                    <tbody>
                      {m.stores.map((s) => (
                        <tr key={s.store_id} className="border-t border-white/[0.06]">
                          <td className="py-1.5 font-bold">{s.store_name}</td>
                          <td className="text-right">{money(s.sales_total_cents)}</td>
                          <td className="text-right text-[#8b8378]">IVA {money(s.vat_output_cents)}</td>
                          <td className="text-right text-[#8b8378]">compras IVA {money(s.vat_input_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            );
          })}
          <p className="text-xs text-[#8b8378]">
            Acesso «{portal.label}», válido até {new Date(portal.expires_at).toLocaleDateString('pt-PT')}. Cada descarga fica registada na empresa.
          </p>
        </>
      )}
    </main>
  );
}
