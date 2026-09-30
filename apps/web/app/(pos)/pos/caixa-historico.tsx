'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatMT, type Cents } from '@delivery/core';
import type { CashSold } from '@delivery/receipt';
import { createClient } from '@/utils/supabase/client';
import { businessDateLabel, dayShiftsLabel } from '@/lib/cash/day';
import {
  dayHeading,
  duration,
  fetchCashHistory,
  groupByDay,
  maputoDay,
  paymentShares,
  type CashHistory,
  type CashPayments,
  type DayCloseRow,
  type ShiftPeople,
  type ShiftRow,
} from '@/lib/cash/history';
import { reprintCashDay } from '@/lib/cash/reprint-day';
import { PosIcon } from './pos-icons';

/**
 * O que já fechou, no balcão: os turnos e os fechos do dia da loja, cada um
 * com a conferência da gaveta, como pagaram e os artigos vendidos — o mesmo
 * que o Caixa do painel mostra (`lib/cash/history`), feito para o dedo.
 *
 * Só se consulta e reimprime o fecho do dia. Com a sessão de quem está no
 * POS: a RLS mostra só esta loja, e a cozinha não chega aqui (CLAUDE §6).
 */

const PAGE = 20;
const POLL_MS = 60_000;
const SOLD_PREVIEW = 8;

const mt = (value: number) => {
  const absolute = formatMT(Math.abs(value) as Cents);
  return value < 0 ? `−${absolute}` : absolute;
};

const hora = (iso: string) =>
  new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Africa/Maputo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));

/** `2026-09-25` → `set`: o mês do dia de negócio, sem passar por fusos. */
function monthShort(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return '';
  return new Intl.DateTimeFormat('pt-PT', { timeZone: 'UTC', month: 'short' })
    .format(new Date(Date.UTC(year, month - 1, day)))
    .replace('.', '');
}

const PAYMENT_METHODS: Array<{ key: keyof CashPayments; label: string; color: string }> = [
  { key: 'cash', label: 'Dinheiro', color: 'var(--gold)' },
  { key: 'mpesa', label: 'M-Pesa', color: '#E5484D' },
  { key: 'emola', label: 'e-Mola', color: '#F97316' },
  { key: 'credit_card', label: 'Cartão', color: '#60A5FA' },
];

export function CaixaHistorico({
  storeId,
  online,
  vista,
  abrirId = null,
}: {
  storeId: string;
  online: boolean;
  vista: 'turnos' | 'dias';
  /** Um turno ou fecho do dia para mostrar já aberto (o que acabou de fechar). */
  abrirId?: string | null;
}) {
  const [supabase] = useState(() => createClient());
  const [history, setHistory] = useState<CashHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(abrirId);

  const load = useCallback(async () => {
    const result = await fetchCashHistory(supabase, { storeId, limit });
    if (!result.ok) {
      setError(/fetch|network|timeout/i.test(result.message)
        ? 'Sem ligação ao servidor. Tenta outra vez.'
        : 'Não foi possível carregar o histórico do caixa.');
      return;
    }
    setError(null);
    setHistory(result.history);
  }, [limit, storeId, supabase]);

  useEffect(() => {
    if (!online) return;
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, online]);

  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id));
  const shifts = history?.shifts ?? [];
  const days = history?.days ?? [];
  const full = vista === 'turnos' ? shifts.length === limit : days.length === limit;

  return (
    <div className="pos-cq flex flex-col gap-4">
      {!online && (
        <p role="alert" className="pos-note pos-note--warn">
          Sem ligação. O histórico precisa de internet — {history ? 'mostra o que já estava carregado.' : 'volta quando a ligação voltar.'}
        </p>
      )}
      {error && history && <p role="alert" className="pos-note pos-note--warn">{error} Os valores são da última consulta.</p>}

      {!history ? (
        <Vazio>{error ?? (online ? 'A carregar o histórico…' : 'Sem histórico carregado.')}</Vazio>
      ) : vista === 'turnos' ? (
        shifts.length === 0 ? (
          <Vazio>Ainda não há turnos fechados nesta loja.</Vazio>
        ) : (
          groupByDay(shifts, (shift) => maputoDay(shift.opened_at)).map((group) => (
            <section key={group.day} className="flex flex-col gap-2">
              <h3 className="pos-eyebrow px-1">{dayHeading(group.day)}</h3>
              {group.items.map((shift) => (
                <TurnoItem
                  key={shift.id}
                  shift={shift}
                  people={history.people.get(shift.id)}
                  open={openId === shift.id}
                  onToggle={() => toggle(shift.id)}
                />
              ))}
            </section>
          ))
        )
      ) : days.length === 0 ? (
        <Vazio>Ainda não há fechos do dia nesta loja. O fecho do dia faz-se em Agora, depois do último turno.</Vazio>
      ) : (
        <div className="flex flex-col gap-2">
          {days.map((day) => (
            <DiaItem key={day.id} day={day} open={openId === day.id} onToggle={() => toggle(day.id)} />
          ))}
        </div>
      )}

      {history && full && (
        <button
          type="button"
          disabled={!online}
          onClick={() => setLimit((value) => value + PAGE)}
          className="pos-btn pos-btn--quiet w-full"
        >
          Ver mais antigos
        </button>
      )}
    </div>
  );
}

/**
 * Um cartão que abre no toque. Abre um de cada vez; se abrir lá em baixo,
 * o ecrã sobe até ele para o que abriu ficar à vista.
 */
function Expansivel({
  open, onToggle, label, header, children,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  header: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open || !ref.current) return;
    const top = ref.current.getBoundingClientRect().top;
    if (top < window.innerHeight * 0.45) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ref.current.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, [open]);

  return (
    <section
      ref={ref}
      data-open={open}
      className="pos-card pos-fold scroll-mt-2 overflow-hidden"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={label}
        onClick={onToggle}
        className="flex min-h-[5.5rem] w-full items-center gap-4 px-4 py-3 text-left transition-colors duration-150 active:bg-white/[0.04]"
      >
        {header}
        <PosIcon
          name="chevronDown"
          size={22}
          className={`shrink-0 text-ink-mute transition-transform duration-200 ${open ? 'rotate-180 text-gold' : ''}`}
        />
      </button>
      {open && <div className="pos-reveal border-t border-white/[0.07] p-4">{children}</div>}
    </section>
  );
}

function TurnoItem({ shift, people, open, onToggle }: {
  shift: ShiftRow;
  people?: ShiftPeople;
  open: boolean;
  onToggle: () => void;
}) {
  const report = shift.report;
  const quem = people?.opened || people?.closed
    ? people.opened === people.closed
      ? `${people.opened} abriu e fechou`
      : `Abriu ${people.opened ?? '—'} · Fechou ${people.closed ?? '—'}`
    : shift.shift_label;

  return (
    <Expansivel
      open={open}
      onToggle={onToggle}
      label={`Turno das ${hora(shift.opened_at)} às ${hora(shift.closed_at)}`}
      header={
        <>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="pos-num text-xl font-extrabold">
                {hora(shift.opened_at)} → {hora(shift.closed_at)}
              </span>
              <span className="text-sm font-semibold text-ink-mute">{duration(shift.opened_at, shift.closed_at)}</span>
            </span>
            <span className="mt-0.5 block truncate text-sm text-ink-mute">
              {quem}
              {report.total_pedidos !== null && ` · ${report.total_pedidos} pedidos`}
              {!shift.day_close_id && <span className="text-amber-300"> · dia por fechar</span>}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="pos-num block text-xl font-extrabold">
              {report.total_faturado_cents !== null ? mt(report.total_faturado_cents) : '—'}
            </span>
            <span className="block text-xs text-ink-mute">facturado</span>
          </span>
          <Diferenca cents={shift.difference_cents} />
        </>
      }
    >
      <div className="pos-split">
        <div className="flex flex-col gap-5">
          <div>
            <h4 className="pos-eyebrow mb-2">Conferência da gaveta</h4>
            <ContaDaGaveta
              total={shift.expected_cash_cents}
              rows={[
                { label: 'Fundo inicial', value: shift.opening_float_cents, sign: '+' },
                { label: 'Vendas em dinheiro', value: report.cash_sales_cents, sign: '+' },
                { label: 'Reforços', value: report.reforco_cents, sign: '+' },
                ...(report.troco_inicial_cents > 0
                  ? [{ label: 'Troco inicial adicional', value: report.troco_inicial_cents, sign: '+' as const }]
                  : []),
                { label: 'Sangrias', value: report.sangria_cents, sign: '−' },
                { label: 'Despesas', value: report.despesa_cents, sign: '−' },
              ]}
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-black/20 px-4 py-3">
                <p className="pos-eyebrow">Contado</p>
                <p className="pos-num mt-1 text-2xl font-extrabold">{mt(shift.counted_cash_cents)}</p>
              </div>
              <div className="rounded-2xl bg-black/20 px-4 py-3">
                <p className="pos-eyebrow">Diferença</p>
                <p className="mt-1.5"><Diferenca cents={shift.difference_cents} grande /></p>
              </div>
            </div>
            {shift.difference_reason && (
              <p className="pos-note pos-note--warn mt-2 !text-sm">Motivo: {shift.difference_reason}</p>
            )}
          </div>
          {report.payments && (
            <div>
              <h4 className="pos-eyebrow mb-2">Como pagaram</h4>
              <ComoPagaram payments={report.payments} />
            </div>
          )}
        </div>
        <div>
          <h4 className="pos-eyebrow mb-2">Artigos vendidos no turno</h4>
          <ArtigosVendidos sold={report.sold} semLista="Este turno fechou antes de o fecho guardar a lista de artigos." />
        </div>
      </div>
    </Expansivel>
  );
}

function DiaItem({ day, open, onToggle }: { day: DayCloseRow; open: boolean; onToggle: () => void }) {
  const [supabase] = useState(() => createClient());
  const [reprinting, setReprinting] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const report = day.report;

  async function reprint() {
    if (reprinting) return;
    setReprinting(true);
    const result = await reprintCashDay(supabase, day.id);
    setReprinting(false);
    setNotice(result.ok
      ? { ok: true, text: 'Reimpresso · sai na impressora do balcão, marcado REIMPRESSÃO.' }
      : { ok: false, text: result.message });
  }

  return (
    <Expansivel
      open={open}
      onToggle={onToggle}
      label={`Fecho do dia ${businessDateLabel(day.business_date)}`}
      header={
        <>
          <span className="grid h-14 w-14 shrink-0 place-items-center content-center rounded-2xl bg-[color:var(--pos-accent-soft)] text-center leading-none">
            <span className="pos-num text-2xl font-extrabold text-gold">{day.business_date.slice(8, 10)}</span>
            <span className="mt-0.5 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-dim">{monthShort(day.business_date)}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-bold">
              {dayHeading(day.business_date)} · {businessDateLabel(day.business_date)}
              {day.backfill && <span className="ml-2 text-sm font-normal text-ink-mute">(anterior ao fecho do dia)</span>}
            </span>
            <span className="mt-0.5 block truncate text-sm text-ink-mute">
              {report
                ? `${dayShiftsLabel(report.shifts_count)} · ${report.total_pedidos} pedidos · fechado às ${hora(day.closed_at)}${report.closed_by_name ? ` por ${report.closed_by_name}` : ''}`
                : 'Relatório ilegível'}
            </span>
          </span>
          {report && (
            <>
              <span className="shrink-0 text-right">
                <span className="pos-num block text-xl font-extrabold">{mt(report.total_faturado_cents)}</span>
                <span className="block text-xs text-ink-mute">facturado</span>
              </span>
              <Diferenca cents={report.difference_cents} />
            </>
          )}
        </>
      }
    >
      {!report ? (
        <p className="py-4 text-center text-ink-mute">Não foi possível ler este fecho do dia.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="pos-quad">
            <Numero label="Facturado" value={mt(report.total_faturado_cents)} destaque />
            <Numero
              label="Pedidos"
              value={String(report.total_pedidos)}
              hint={report.total_pedidos > 0 ? `ticket médio ${mt(Math.round(report.total_faturado_cents / report.total_pedidos))}` : undefined}
            />
            <Numero label="Na gaveta ao fechar" value={mt(report.closing_cash_cents)} />
            <Numero
              label="Sangrias · despesas"
              value={mt(report.sangria_cents + report.despesa_cents)}
              hint={`${mt(report.sangria_cents)} · ${mt(report.despesa_cents)}`}
            />
          </div>

          <div className="pos-split">
            <div className="flex flex-col gap-5">
              <div>
                <h4 className="pos-eyebrow mb-2">Como pagaram</h4>
                <ComoPagaram payments={report.payments} />
              </div>
              <div>
                <h4 className="pos-eyebrow mb-2">Turnos do dia</h4>
                <ol className="flex flex-col gap-1.5">
                  {report.shifts.map((shift, index) => (
                    <li key={shift.session_id || index} className="flex items-center gap-3 rounded-2xl bg-black/20 px-3 py-2.5">
                      <span className="pos-num grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-bold">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">
                          <span className="pos-num">{hora(shift.opened_at)} → {hora(shift.closed_at)}</span>
                          <span className="text-sm font-normal text-ink-mute"> · {shift.total_pedidos} pedidos</span>
                        </span>
                        <span className="block truncate text-sm text-ink-mute">
                          Abriu {shift.opened_by_name ?? '—'} · Fechou {shift.closed_by_name ?? '—'}
                          {shift.difference_reason ? ` · ${shift.difference_reason}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="pos-num block font-bold">{mt(shift.total_faturado_cents)}</span>
                        {shift.difference_cents !== 0 && (
                          <span className={`pos-num block text-xs font-semibold ${shift.difference_cents < 0 ? 'text-red-300' : 'text-amber-300'}`}>
                            {shift.difference_cents < 0 ? 'Falta' : 'Sobra'} {mt(Math.abs(shift.difference_cents))}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={reprinting}
                  onClick={() => void reprint()}
                  className="pos-btn pos-btn--accent-outline w-full"
                >
                  <PosIcon name="printer" size={20} />
                  {reprinting ? 'A enviar…' : 'Reimprimir fecho do dia'}
                </button>
                {notice && (
                  <p role="status" className={`pos-note ${notice.ok ? 'pos-note--ok' : 'pos-note--danger'} !text-sm`}>
                    {notice.text}
                  </p>
                )}
              </div>
            </div>
            <div>
              <h4 className="pos-eyebrow mb-2">Artigos vendidos no dia</h4>
              <ArtigosVendidos sold={report.sold} semLista="Este fecho é anterior à lista de artigos — a reimpressão já a traz." />
            </div>
          </div>
        </div>
      )}
    </Expansivel>
  );
}

/** A conta da gaveta, linha a linha, até ao esperado. */
function ContaDaGaveta({ rows, total }: {
  rows: Array<{ label: string; value: number; sign: '+' | '−' }>;
  total: number;
}) {
  return (
    <div className="pos-well px-4 py-3">
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-3">
            <span className="text-ink-dim">
              <span className={`mr-2 inline-block w-3 text-center font-extrabold ${row.sign === '+' ? 'text-emerald-300' : 'text-red-300'}`}>
                {row.sign}
              </span>
              {row.label}
            </span>
            <span className={`pos-num font-bold ${row.value === 0 ? 'text-ink-mute opacity-60' : ''}`}>{mt(row.value)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
        <span className="font-bold">= Esperado</span>
        <span className="pos-num text-2xl font-extrabold text-gold">{mt(total)}</span>
      </div>
    </div>
  );
}

/** Contado contra esperado: verde quando bate, âmbar quando sobra, vermelho quando falta. */
function Diferenca({ cents, grande = false }: { cents: number; grande?: boolean }) {
  const tamanho = grande ? 'px-3.5 py-1.5 text-base' : 'px-3 py-1.5 text-sm';
  if (cents === 0) {
    return <span className={`inline-block shrink-0 rounded-full bg-emerald-500/15 font-bold text-emerald-300 ${tamanho}`}>Certo</span>;
  }
  return (
    <span className={`pos-num inline-block shrink-0 whitespace-nowrap rounded-full font-bold ${tamanho} ${cents < 0 ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300'}`}>
      {cents < 0 ? 'Falta' : 'Sobra'} {mt(Math.abs(cents))}
    </span>
  );
}

/** A divisão por meio de pagamento: uma barra e, por baixo, cada meio com valor e %. */
function ComoPagaram({ payments }: { payments: CashPayments }) {
  const shares = paymentShares(payments);
  const total = PAYMENT_METHODS.reduce((sum, method) => sum + payments[method.key], 0);
  return (
    <div className="pos-cq">
      <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-white/[0.06]">
        {total > 0 && PAYMENT_METHODS.map((method) => payments[method.key] > 0 && (
          <span key={method.key} style={{ width: `${(payments[method.key] / total) * 100}%`, background: method.color }} />
        ))}
      </div>
      <dl className="pos-quad mt-3">
        {PAYMENT_METHODS.map((method) => (
          <div key={method.key} className="min-w-0 rounded-2xl bg-black/20 px-3 py-2.5">
            <dt className="flex items-center gap-1.5 text-sm text-ink-mute">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: method.color }} />
              {method.label}
              {total > 0 && <span className="pos-num ml-auto text-xs">{shares[method.key]}%</span>}
            </dt>
            <dd className={`pos-num mt-0.5 truncate text-lg font-extrabold ${payments[method.key] === 0 ? 'text-ink-mute' : ''}`}>
              {mt(payments[method.key])}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Os artigos vendidos, do mais vendido para o menos, com a barra da quantidade. */
function ArtigosVendidos({ sold, semLista }: { sold: CashSold | null | undefined; semLista: string }) {
  const [todos, setTodos] = useState(false);
  if (!sold) return <Vazio>{semLista}</Vazio>;
  if (sold.items.length === 0) return <Vazio>Nenhum artigo vendido.</Vazio>;

  const units = sold.items.reduce((sum, item) => sum + item.qty, 0);
  const maxQty = Math.max(...sold.items.map((item) => item.qty));
  const visible = todos ? sold.items : sold.items.slice(0, SOLD_PREVIEW);

  return (
    <div>
      <p className="text-sm text-ink-mute">
        <strong className="pos-num text-ink">{units}</strong> unidades ·{' '}
        <strong className="pos-num text-ink">{sold.items.length}</strong> artigos diferentes
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {visible.map((item) => (
          <li key={`${item.name}|${item.variant ?? ''}`} className="relative overflow-hidden rounded-xl">
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 rounded-xl bg-[color:var(--pos-accent-soft)]"
              style={{ width: `${(item.qty / maxQty) * 100}%` }}
            />
            <span className="relative flex min-h-12 items-center gap-3 px-3">
              <span className="pos-num w-10 shrink-0 text-lg font-extrabold text-gold">{item.qty}×</span>
              <span className="min-w-0 flex-1 truncate font-semibold">
                {item.name}
                {item.variant && <span className="font-normal text-ink-mute"> · {item.variant}</span>}
              </span>
              <span className="pos-num shrink-0 font-bold">{mt(item.total_cents)}</span>
            </span>
          </li>
        ))}
      </ul>
      {sold.items.length > SOLD_PREVIEW && (
        <button type="button" onClick={() => setTodos((value) => !value)} className="pos-btn pos-btn--quiet mt-2 !min-h-12 w-full">
          <PosIcon name={todos ? 'chevronUp' : 'chevronDown'} size={18} />
          {todos ? 'Mostrar menos' : `Ver os ${sold.items.length} artigos`}
        </button>
      )}
      <dl className="mt-3 flex flex-col gap-1 border-t border-white/[0.07] pt-3">
        <Total label="Artigos" value={sold.items_total_cents} />
        {sold.delivery_fees_cents > 0 && <Total label="Taxas de entrega" value={sold.delivery_fees_cents} />}
        {sold.discounts_cents > 0 && <Total label="Descontos" value={-sold.discounts_cents} />}
      </dl>
    </div>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-mute">{label}</dt>
      <dd className="pos-num font-bold">{mt(value)}</dd>
    </div>
  );
}

function Numero({ label, value, hint, destaque = false }: { label: string; value: string; hint?: string; destaque?: boolean }) {
  return (
    <div className="min-w-0 rounded-2xl bg-black/20 px-4 py-3">
      <p className="pos-eyebrow">{label}</p>
      <p className={`pos-num mt-1 truncate text-2xl font-extrabold ${destaque ? 'text-gold' : ''}`}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-ink-mute">{hint}</p>}
    </div>
  );
}

function Vazio({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border border-white/[0.07] bg-bg2 px-4 py-8 text-center text-ink-mute">{children}</p>
  );
}
