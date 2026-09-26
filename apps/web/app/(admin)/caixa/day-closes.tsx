'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';

import {
  businessDateLabel,
  dayShiftsLabel,
  parseCashDayReport,
  type CashDayReport,
} from '@/lib/cash/day';
import { createClient } from '@/utils/supabase/client';

/** Os últimos fechos do dia — é o que se consulta; o resto está no email e no papel. */
const LIMIT = 20;

type DayCloseRow = {
  id: string;
  store_id: string;
  business_date: string;
  closed_at: string;
  report: CashDayReport | null;
  backfill: boolean;
};

const mt = (value: number) => {
  const absolute = formatMT(Math.abs(value) as Cents);
  return value < 0 ? `-${absolute}` : absolute;
};
const time = (iso: string) =>
  new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Africa/Maputo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));

/**
 * Os fechos do dia (1091) na aba Caixa do painel: um por linha, com os turnos
 * por baixo — quem abriu, quem fechou e a diferença de cada um. Só leitura:
 * o fecho do dia faz-se no POS, depois do último turno.
 */
export function DayClosesSection({
  storeId,
  storeNames,
}: {
  /** Null = todas as lojas a que o perfil tem acesso (a RLS filtra). */
  storeId: string | null;
  storeNames: Record<string, string>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<DayCloseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    let query = supabase
      .from('cash_day_closes')
      .select('id,store_id,business_date,closed_at,report')
      .order('closed_at', { ascending: false })
      .limit(LIMIT);
    if (storeId) query = query.eq('store_id', storeId);
    const { data, error: loadError } = await query;
    if (loadError) {
      setError('Os fechos do dia ainda não estão disponíveis nesta instalação.');
      return;
    }
    setError(null);
    setRows(
      (data ?? []).map((row) => ({
        id: row.id as string,
        store_id: row.store_id as string,
        business_date: row.business_date as string,
        closed_at: row.closed_at as string,
        report: parseCashDayReport(row.report),
        backfill: (row.report as { backfill?: unknown } | null)?.backfill === true,
      })),
    );
  }, [storeId, supabase]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-black text-white">Fechos do dia</h2>
        <p className="text-xs text-[#8F8376]">Últimos {LIMIT} · o fecho do dia faz-se no POS</p>
      </div>
      <div className="mt-3">
        {error ? (
          <p className="py-8 text-center text-sm text-[#8F8376]">{error}</p>
        ) : rows === null ? (
          <p className="py-8 text-center text-sm text-[#8F8376]">A carregar…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-[#8F8376]">Ainda não há fechos do dia.</p>
        ) : (
          rows.map((row) => (
            <details key={row.id} className="group border-b border-white/5 last:border-0">
              <summary className="flex cursor-pointer list-none items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-white">
                    {businessDateLabel(row.business_date)}
                    {!storeId && storeNames[row.store_id] ? ` · ${storeNames[row.store_id]}` : ''}
                    {row.backfill && <span className="ml-2 text-xs font-normal text-[#8F8376]">(anterior ao fecho do dia)</span>}
                  </p>
                  <p className="text-xs text-[#938779]">
                    {row.report
                      ? `${dayShiftsLabel(row.report.shifts_count)} · ${row.report.total_pedidos} pedidos · fechado às ${time(row.closed_at)}${row.report.closed_by_name ? ` por ${row.report.closed_by_name}` : ''}`
                      : 'Relatório ilegível'}
                  </p>
                </div>
                {row.report && (
                  <div className="text-right">
                    <p className="font-bold text-white">{mt(row.report.total_faturado_cents)}</p>
                    <p className={row.report.difference_cents === 0 ? 'text-xs text-[#938779]' : 'text-xs text-amber-300'}>
                      Diferença {mt(row.report.difference_cents)}
                    </p>
                  </div>
                )}
                <span aria-hidden className="text-[#8F8376] transition group-open:rotate-90">›</span>
              </summary>
              {row.report && <DayDetail report={row.report} />}
            </details>
          ))
        )}
      </div>
    </section>
  );
}

function DayDetail({ report }: { report: CashDayReport }) {
  const lines: Array<[string, string]> = [
    ['Dinheiro', mt(report.payments.cash)],
    ['M-Pesa', mt(report.payments.mpesa)],
    ['e-Mola', mt(report.payments.emola)],
    ['Cartão', mt(report.payments.credit_card)],
    ['Sangrias', mt(report.sangria_cents)],
    ['Despesas', mt(report.despesa_cents)],
    ['Na gaveta ao fechar', mt(report.closing_cash_cents)],
    ['Diferença do dia', mt(report.difference_cents)],
  ];
  return (
    <div className="mb-4 space-y-3 rounded-xl bg-black/20 p-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {lines.map(([label, value]) => (
          <div key={label}>
            <p className="text-xs text-[#8F8376]">{label}</p>
            <p className="font-bold text-[#E8DDCF]">{value}</p>
          </div>
        ))}
      </div>
      <ul className="divide-y divide-white/5">
        {report.shifts.map((shift, index) => (
          <li key={shift.session_id || index} className="flex items-center gap-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-bold text-white">
                {index + 1}. {time(shift.opened_at)}–{time(shift.closed_at)}
              </p>
              <p className="text-xs text-[#938779]">
                Abriu {shift.opened_by_name ?? '—'} · Fechou {shift.closed_by_name ?? '—'}
                {shift.difference_reason ? ` · ${shift.difference_reason}` : ''}
              </p>
            </div>
            <div className="text-right">
              <p className="text-white">{mt(shift.total_faturado_cents)}</p>
              <p className={shift.difference_cents === 0 ? 'text-xs text-[#938779]' : 'text-xs text-amber-300'}>
                {mt(shift.difference_cents)}
              </p>
            </div>
            {shift.session_id && (
              <a
                href={`/api/cash-sessions/${shift.session_id}/report`}
                className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-[#F5A623]"
              >
                PDF
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
