'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { businessDateLabel, dayShiftsLabel } from '@/lib/cash/day';
import {
  fetchCashHistory,
  groupByDay,
  type CashHistory as History,
  type DayCloseRow,
  type ShiftPeople,
  type ShiftRow,
} from '@/lib/cash/history';
import { createClient } from '@/utils/supabase/client';
import { downloadStaffFile } from '@/lib/admin/staff-fetch';
import { reprintCashDay } from '@/lib/cash/reprint-day';
import { reprintCashSession } from '@/lib/cash/reprint-session';

import {
  Card,
  DifferenceBadge,
  DrawerMath,
  EmptyState,
  PaymentSplit,
  SoldItems,
  Stat,
  dayHeading,
  duration,
  maputoDay,
  mt,
  time,
} from './ui';

/**
 * O histórico do caixa de uma loja: os turnos fechados e os fechos do dia
 * (1091), cada um aberto com o dinheiro, a conferência da gaveta e os artigos
 * vendidos que o fecho congelou (1095). Só se consulta, descarrega e
 * reimprime — abrir, movimentar e fechar é no cartão do turno actual.
 * A leitura é a mesma do POS (`lib/cash/history`).
 */

const PAGE = 30;

export function CashHistory({
  storeId,
  storeNames,
  refreshKey,
}: {
  /** Null = todas as lojas a que o perfil tem acesso (a RLS filtra). */
  storeId: string | null;
  storeNames: Record<string, string>;
  /** Muda quando o turno actual fecha, para o histórico apanhar o fecho novo. */
  refreshKey: number;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<'shifts' | 'days'>('shifts');
  const [history, setHistory] = useState<History | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchCashHistory(supabase, { storeId, limit });
    if (!result.ok) {
      setError(`Não foi possível carregar os turnos: ${result.message}`);
      return;
    }
    setError(null);
    setHistory(result.history);
  }, [limit, storeId, supabase]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load, refreshKey]);

  const shifts = history?.shifts ?? null;
  const days = history?.days ?? null;
  const people = history?.people;

  const pendingShifts = (shifts ?? []).filter((shift) => !shift.day_close_id).length;
  const showStore = !storeId;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Histórico do caixa" className="flex rounded-xl bg-black/30 p-1">
          <TabButton active={tab === 'shifts'} onClick={() => setTab('shifts')}>
            Turnos fechados
            {pendingShifts > 0 && <span className="ml-2 rounded-full bg-amber-500/20 px-1.5 text-[11px] text-amber-300">{pendingShifts} por fechar o dia</span>}
          </TabButton>
          <TabButton active={tab === 'days'} onClick={() => setTab('days')}>Fechos do dia</TabButton>
        </div>
        <p className="text-xs text-[#8F8376]">
          {tab === 'shifts' ? 'Toca num turno para ver a gaveta e os artigos vendidos.' : 'O fecho do dia faz-se no POS, depois do último turno.'}
        </p>
      </div>

      <div className="mt-5">
        {error ? (
          <EmptyState>{error}</EmptyState>
        ) : !shifts || !days ? (
          <EmptyState>A carregar…</EmptyState>
        ) : tab === 'shifts' ? (
          shifts.length === 0 ? <EmptyState>Ainda não há turnos fechados.</EmptyState> : (
            <GroupedByDay items={shifts} dayOf={(shift) => maputoDay(shift.opened_at)}>
              {(shift) => (
                <ShiftItem
                  key={shift.id}
                  shift={shift}
                  people={people?.get(shift.id)}
                  storeName={showStore ? storeNames[shift.store_id] : undefined}
                />
              )}
            </GroupedByDay>
          )
        ) : days.length === 0 ? (
          <EmptyState>Ainda não há fechos do dia.</EmptyState>
        ) : (
          <div className="space-y-2">
            {days.map((day) => (
              <DayItem key={day.id} day={day} storeName={showStore ? storeNames[day.store_id] : undefined} />
            ))}
          </div>
        )}
      </div>

      {((tab === 'shifts' && shifts?.length === limit) || (tab === 'days' && days?.length === limit)) && (
        <button type="button" onClick={() => setLimit((value) => value + PAGE)} className="mt-4 w-full rounded-xl border border-white/10 py-3 text-sm font-bold text-[#C9BCAC] hover:bg-white/[0.04]">
          Ver mais antigos
        </button>
      )}
    </Card>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`min-h-10 rounded-lg px-4 text-sm font-black transition ${active ? 'bg-[#F5A623] text-[#24150D]' : 'text-[#A99C8C] hover:text-white'}`}
    >
      {children}
    </button>
  );
}

function GroupedByDay<T>({ items, dayOf, children }: { items: T[]; dayOf: (item: T) => string; children: (item: T) => React.ReactNode }) {
  return (
    <div className="space-y-5">
      {groupByDay(items, dayOf).map((group) => (
        <div key={group.day}>
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-[#8F8376]">{dayHeading(group.day)}</p>
          <div className="space-y-2">{group.items.map(children)}</div>
        </div>
      ))}
    </div>
  );
}

function ShiftItem({ shift, people, storeName }: {
  shift: ShiftRow;
  people?: ShiftPeople;
  storeName?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [reprinting, setReprinting] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const report = shift.report;

  async function reprint() {
    if (reprinting) return;
    setReprinting(true);
    const result = await reprintCashSession(supabase, shift.id);
    setReprinting(false);
    setNotice(result.ok
      ? { ok: true, text: 'Na fila da impressora do balcão da loja, marcado REIMPRESSÃO.' }
      : { ok: false, text: result.message });
  }

  return (
    <details className="group rounded-xl border border-white/10 bg-black/20 open:border-[#F5A623]/30 open:bg-black/30">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 p-4">
        <div className="min-w-0 flex-1">
          <p className="font-black text-white">
            {time(shift.opened_at)} → {time(shift.closed_at)}
            <span className="ml-2 text-xs font-bold text-[#8F8376]">{duration(shift.opened_at, shift.closed_at)}</span>
            {storeName && <span className="ml-2 rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] font-bold text-[#C9BCAC]">{storeName}</span>}
          </p>
          <p className="mt-0.5 truncate text-xs text-[#938779]">
            {people?.opened || people?.closed
              ? `Abriu ${people.opened ?? '—'} · Fechou ${people.closed ?? '—'}`
              : shift.shift_label}
            {report.total_pedidos !== null && ` · ${report.total_pedidos} pedidos`}
            {!shift.day_close_id && <span className="text-amber-300"> · dia por fechar</span>}
          </p>
        </div>
        <div className="text-right">
          <p className="font-black text-white">{report.total_faturado_cents !== null ? mt(report.total_faturado_cents) : '—'}</p>
          <p className="text-[11px] text-[#8F8376]">facturado</p>
        </div>
        <DifferenceBadge cents={shift.difference_cents} />
        <span aria-hidden className="text-lg text-[#8F8376] transition group-open:rotate-90">›</span>
      </summary>

      <div className="grid gap-5 border-t border-white/10 p-4 lg:grid-cols-2">
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-xs font-black uppercase tracking-wider text-[#8F8376]">Conferência da gaveta</p>
            <DrawerMath
              totalLabel="Esperado"
              total={shift.expected_cash_cents}
              rows={[
                { label: 'Fundo inicial', value: shift.opening_float_cents, sign: '+' },
                { label: 'Vendas em dinheiro', value: report.cash_sales_cents, sign: '+' },
                { label: 'Reforços', value: report.reforco_cents, sign: '+' },
                ...(report.troco_inicial_cents > 0 ? [{ label: 'Troco inicial adicional', value: report.troco_inicial_cents, sign: '+' as const }] : []),
                { label: 'Sangrias', value: report.sangria_cents, sign: '−' },
                { label: 'Despesas', value: report.despesa_cents, sign: '−' },
              ]}
            />
            <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-white/10 p-4">
              <Stat label="Contado" value={mt(shift.counted_cash_cents)} />
              <Stat label="Diferença" value={<DifferenceBadge cents={shift.difference_cents} />} />
            </div>
            {shift.difference_reason && (
              <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">Motivo: {shift.difference_reason}</p>
            )}
          </div>
          {report.payments && (
            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-wider text-[#8F8376]">Como pagaram</p>
              <PaymentSplit payments={report.payments} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => { void downloadStaffFile(`/api/cash-sessions/${shift.id}/report`, 'fecho.pdf').catch(() => undefined); }}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-[#F5A623] hover:bg-white/[0.06]"
            >
              Descarregar PDF do turno
            </button>
            <button
              type="button"
              disabled={reprinting}
              onClick={() => void reprint()}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-[#F5A623] hover:bg-white/[0.06] disabled:opacity-50"
            >
              {reprinting ? 'A enviar…' : 'Reimprimir fecho do turno'}
            </button>
            {notice && <p role="status" className={`text-xs ${notice.ok ? 'text-emerald-300' : 'text-red-300'}`}>{notice.text}</p>}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-[#8F8376]">Artigos vendidos no turno</p>
          <SoldItems sold={report.sold} emptyHint="Este turno fechou antes de o fecho guardar a lista de artigos." />
        </div>
      </div>
    </details>
  );
}

function DayItem({ day, storeName }: { day: DayCloseRow; storeName?: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [reprinting, setReprinting] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const report = day.report;

  async function reprint() {
    if (reprinting) return;
    setReprinting(true);
    const result = await reprintCashDay(supabase, day.id);
    setReprinting(false);
    setNotice(result.ok
      ? { ok: true, text: 'Na fila da impressora do balcão da loja, marcado REIMPRESSÃO.' }
      : { ok: false, text: result.message });
  }

  return (
    <details className="group rounded-xl border border-white/10 bg-black/20 open:border-[#F5A623]/30 open:bg-black/30">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 p-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#F5A623]/10 text-center leading-none">
          <span className="text-lg font-black text-[#F5A623]">{day.business_date.slice(8, 10)}</span>
          <span className="text-[10px] font-bold uppercase text-[#C9BCAC]">{businessDateLabel(day.business_date).slice(3, 5)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-black text-white">
            {dayHeading(day.business_date)} · {businessDateLabel(day.business_date)}
            {storeName && <span className="ml-2 rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] font-bold text-[#C9BCAC]">{storeName}</span>}
            {day.backfill && <span className="ml-2 text-xs font-normal text-[#8F8376]">(anterior ao fecho do dia)</span>}
          </p>
          <p className="mt-0.5 truncate text-xs text-[#938779]">
            {report
              ? `${dayShiftsLabel(report.shifts_count)} · ${report.total_pedidos} pedidos · fechado às ${time(day.closed_at)}${report.closed_by_name ? ` por ${report.closed_by_name}` : ''}`
              : 'Relatório ilegível'}
          </p>
        </div>
        {report && (
          <>
            <div className="text-right">
              <p className="font-black text-white">{mt(report.total_faturado_cents)}</p>
              <p className="text-[11px] text-[#8F8376]">facturado</p>
            </div>
            <DifferenceBadge cents={report.difference_cents} />
          </>
        )}
        <span aria-hidden className="text-lg text-[#8F8376] transition group-open:rotate-90">›</span>
      </summary>

      {report && (
        <div className="border-t border-white/10 p-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Facturado" value={mt(report.total_faturado_cents)} accent />
            <Stat label="Pedidos" value={report.total_pedidos} hint={report.total_pedidos > 0 ? `ticket médio ${mt(Math.round(report.total_faturado_cents / report.total_pedidos))}` : undefined} />
            <Stat label="Na gaveta ao fechar" value={mt(report.closing_cash_cents)} />
            <Stat label="Sangrias · despesas" value={mt(report.sangria_cents + report.despesa_cents)} hint={`${mt(report.sangria_cents)} · ${mt(report.despesa_cents)}`} />
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wider text-[#8F8376]">Como pagaram</p>
                <PaymentSplit payments={report.payments} />
              </div>
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wider text-[#8F8376]">Turnos do dia</p>
                <ol className="space-y-2">
                  {report.shifts.map((shift, index) => (
                    <li key={shift.session_id || index} className="flex items-center gap-3 rounded-lg bg-white/[0.03] px-3 py-2 text-sm">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-black text-white">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-white">{time(shift.opened_at)} → {time(shift.closed_at)} <span className="text-xs font-normal text-[#8F8376]">· {shift.total_pedidos} pedidos</span></p>
                        <p className="truncate text-xs text-[#938779]">
                          Abriu {shift.opened_by_name ?? '—'} · Fechou {shift.closed_by_name ?? '—'}
                          {shift.difference_reason ? ` · ${shift.difference_reason}` : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-white">{mt(shift.total_faturado_cents)}</p>
                        {shift.difference_cents !== 0 && <p className={`text-xs ${shift.difference_cents < 0 ? 'text-red-300' : 'text-amber-300'}`}>{mt(shift.difference_cents)}</p>}
                      </div>
                      {shift.session_id && (
                        <button
                          type="button"
                          onClick={() => { void downloadStaffFile(`/api/cash-sessions/${shift.session_id}/report`, 'fecho.pdf').catch(() => undefined); }}
                          className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-bold text-[#F5A623]"
                        >
                          PDF
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={reprinting}
                  onClick={() => void reprint()}
                  className="rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-[#F5A623] hover:bg-white/[0.06] disabled:opacity-50"
                >
                  {reprinting ? 'A enviar…' : 'Reimprimir fecho do dia'}
                </button>
                {notice && <p role="status" className={`text-xs ${notice.ok ? 'text-emerald-300' : 'text-red-300'}`}>{notice.text}</p>}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-wider text-[#8F8376]">Artigos vendidos no dia</p>
              <SoldItems sold={report.sold} emptyHint="Este fecho é anterior à lista de artigos — a reimpressão já a traz." />
            </div>
          </div>
        </div>
      )}
    </details>
  );
}
