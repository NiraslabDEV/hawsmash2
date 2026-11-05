'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMT, type Cents } from '@delivery/core';

import { InsightEmpty, InsightPanel, MetricCard } from '@/components/admin/insights-ui';
import { GarconsHistorico } from './garcons-historico';
import { waiterAdminErrorMessage } from '@/lib/garcom/admin';
import {
  deltaPct,
  fillDays,
  fillHours,
  formatMinutes,
  highlights,
  itemsPerOrder,
  originShare,
  PERIOD_LABEL,
  periodRange,
  RANK_IS_MONEY,
  RANK_LABEL,
  rankWaiters,
  type Highlight,
  type MetricsPeriod,
  type MetricsReport,
  type RankKey,
  type WaiterMetrics,
} from '@/lib/garcom/metricas';
import { createClient } from '@/utils/supabase/client';

const money = (c: number) => formatMT(c as Cents);
const numero = (n: number) => n.toLocaleString('pt-PT');
const GOLD = '#f2c572';
const chartTooltip = { backgroundColor: '#2a231d', border: '1px solid #796957', borderRadius: 10, color: '#faf6ef', fontSize: 13 };
const RANK_KEYS: RankKey[] = ['orders', 'revenue_cents', 'avg_ticket_cents', 'items', 'tables', 'extras_cents', 'served'];
const PERIODS: MetricsPeriod[] = ['today', '7d', '30d', 'month', 'all'];

type Store = { id: string; short_name: string };

function Trend({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  return (
    <span className={`insight-trend ${pct >= 0 ? '' : 'insight-trend-down'}`}>
      {pct >= 0 ? '↑' : '↓'}
      {Math.abs(pct)}%
    </span>
  );
}

function valorDoRanking(w: WaiterMetrics, key: RankKey): string {
  return RANK_IS_MONEY[key] ? money(w[key]) : numero(w[key]);
}

function valorDoDestaque(h: Highlight): string {
  if (h.kind === 'money') return money(h.value);
  if (h.kind === 'minutes') return formatMinutes(h.value);
  return `${numero(h.value)} pedidos`;
}

/**
 * O desempenho dos garçons (1123): quem tirou mais pedidos, quem vendeu mais, e
 * tudo o que dá para medir de cada um. Tocar num garçom filtra o resto da página
 * por ele. A conta é toda de `get_waiter_metrics`; aqui só se desenha.
 */
export function GarconsDesempenho() {
  const supabase = useMemo(() => createClient(), []);
  const [stores, setStores] = useState<Store[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  // undefined = ainda a saber o perfil; null = todas as lojas (só o dono).
  const [storeId, setStoreId] = useState<string | null | undefined>(undefined);
  const [period, setPeriod] = useState<MetricsPeriod>('7d');
  const [rankKey, setRankKey] = useState<RankKey>('orders');
  const [waiterId, setWaiterId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      let dono = false;
      if (session) {
        const { data: perfil } = await supabase.from('staff_profiles').select('role').eq('user_id', session.user.id).maybeSingle();
        dono = perfil?.role === 'owner';
      }
      const { data } = await supabase.from('stores').select('id,short_name').eq('active', true).order('sort');
      const lista = (data ?? []) as Store[];
      setStores(lista);
      setIsOwner(dono);
      setStoreId(dono ? null : (lista[0]?.id ?? null));
    })();
  }, [supabase]);

  const range = useMemo(() => periodRange(period), [period]);

  const ler = async (from: string | null, to: string | null, waiter: string | null): Promise<MetricsReport> => {
    const { data, error } = await supabase.rpc('get_waiter_metrics', {
      p_store_id: storeId,
      p_from: from,
      p_to: to,
      p_waiter_id: waiter,
    });
    if (error) throw new Error(waiterAdminErrorMessage(error.message));
    return data as MetricsReport;
  };

  const pronto = storeId !== undefined;
  const equipa = useQuery({
    queryKey: ['garcons-metricas', storeId, range.from, null],
    enabled: pronto,
    refetchInterval: 60_000,
    queryFn: () => ler(range.from, range.to, null),
  });
  const detalhe = useQuery({
    queryKey: ['garcons-metricas', storeId, range.from, waiterId],
    enabled: pronto && Boolean(waiterId),
    queryFn: () => ler(range.from, range.to, waiterId),
  });
  const anterior = useQuery({
    queryKey: ['garcons-metricas-anterior', storeId, range.previous?.from, waiterId],
    enabled: pronto && Boolean(range.previous),
    queryFn: () => ler(range.previous!.from, range.previous!.to, waiterId),
  });

  const waiters = useMemo(() => equipa.data?.waiters ?? [], [equipa.data]);
  const selecionado = waiters.find((w) => w.id === waiterId) ?? null;
  // Um garçom que saiu da lista (outra loja, desactivado sem pedidos) larga o filtro.
  const relatorio = selecionado ? (detalhe.data ?? null) : (equipa.data ?? null);
  const ordenados = useMemo(() => rankWaiters(waiters, rankKey), [waiters, rankKey]);
  const destaques = useMemo(() => highlights(waiters), [waiters]);
  const dias = useMemo(() => (relatorio ? fillDays(relatorio.by_day, range) : []), [relatorio, range]);
  const horas = useMemo(() => (relatorio ? fillHours(relatorio.by_hour) : []), [relatorio]);

  const t = relatorio?.totals;
  const antes = anterior.data?.totals;
  const nomeDaLoja = storeId === null ? 'Todas as lojas' : (stores.find((s) => s.id === storeId)?.short_name ?? '');
  const maiorDoRanking = Math.max(...ordenados.map((w) => w[rankKey]), 0);
  const erro = equipa.error ?? detalhe.error;

  return (
    <>
      <div className="insight-toolbar">
        {stores.length > 1 && (
          <div className="insight-filter">
            <span className="insight-filter-label">Loja</span>
            <div className="insight-segment" role="group" aria-label="Filtrar por loja">
              {isOwner && (
                <button aria-pressed={storeId === null} onClick={() => { setStoreId(null); setWaiterId(null); }}>
                  Todas
                </button>
              )}
              {stores.map((s) => (
                <button key={s.id} aria-pressed={storeId === s.id} onClick={() => { setStoreId(s.id); setWaiterId(null); }}>
                  {s.short_name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="insight-filter">
          <span className="insight-filter-label">Período</span>
          <div className="insight-segment" role="group" aria-label="Filtrar por período">
            {PERIODS.map((p) => (
              <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)}>
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="insight-context">
        <span>
          {PERIOD_LABEL[period]} · {nomeDaLoja}
          {selecionado && (
            <>
              {' · '}
              <b className="text-[#f2c572]">{selecionado.full_name}</b>{' '}
              <button className="underline" onClick={() => setWaiterId(null)}>
                ver a equipa toda
              </button>
            </>
          )}
        </span>
        <span>Hora de Maputo · Valores em MT</span>
      </div>

      {erro && <p className="insight-notice">{(erro as Error).message}</p>}

      {t && (
        <div className="insight-grid">
          <MetricCard
            featured
            label="Pedidos"
            icon="orders"
            value={numero(t.orders)}
            detail={<><Trend pct={deltaPct(t.orders, antes?.orders)} /> {t.cancelled_orders > 0 ? `+ ${t.cancelled_orders} ${t.cancelled_orders === 1 ? 'cancelado' : 'cancelados'}, que não contam` : 'Lançados pelo telemóvel'}</>}
          />
          <MetricCard
            label="Vendas"
            icon="chart"
            value={money(t.revenue_cents)}
            detail={<><Trend pct={deltaPct(t.revenue_cents, antes?.revenue_cents)} /> {money(t.open_cents)} por cobrar</>}
          />
          <MetricCard
            label="Ticket médio"
            icon="ticket"
            value={money(t.avg_ticket_cents)}
            detail={<><Trend pct={deltaPct(t.avg_ticket_cents, antes?.avg_ticket_cents)} /> {itemsPerOrder(t).toLocaleString('pt-PT')} {itemsPerOrder(t) === 1 ? 'artigo' : 'artigos'} por pedido</>}
          />
          <MetricCard
            label="Extras vendidos"
            icon="arrow"
            value={money(t.extras_cents)}
            detail={`${numero(t.tables)} mesas · ${money(t.removed_cents)} retirados`}
          />
        </div>
      )}

      {!selecionado && destaques.length > 0 && (
        <InsightPanel title="Destaques do período" description="Ticket e rapidez só contam a partir de 5 pedidos">
          <div className="insight-highlights">
            {destaques.map((h) => (
              <div key={h.label} className="insight-highlight">
                <small>{h.label}</small>
                <strong>{h.waiter.full_name}</strong>
                <p>{valorDoDestaque(h)}</p>
              </div>
            ))}
          </div>
        </InsightPanel>
      )}

      <InsightPanel
        title="Ranking dos garçons"
        description="Toca num garçom para ver os números e o histórico dele"
        aside={
          <div className="insight-segment" role="group" aria-label="Ordenar o ranking">
            {RANK_KEYS.slice(0, 4).map((key) => (
              <button key={key} aria-pressed={rankKey === key} onClick={() => setRankKey(key)}>
                {RANK_LABEL[key]}
              </button>
            ))}
          </div>
        }
      >
        {equipa.isLoading || !pronto ? (
          <p className="insight-subtitle">A carregar…</p>
        ) : ordenados.length === 0 ? (
          <InsightEmpty title="Ainda não há garçons nesta loja">Cria-os no separador Equipa.</InsightEmpty>
        ) : (
          <ol className="space-y-1">
            {ordenados.map((w, i) => (
              <li key={w.id}>
                <button
                  onClick={() => setWaiterId(w.id === waiterId ? null : w.id)}
                  aria-pressed={w.id === waiterId}
                  title={`${w.full_name}: ${valorDoRanking(w, rankKey)}`}
                  className={`grid w-full grid-cols-[2rem_minmax(0,9rem)_1fr_auto] items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-white/[0.05] ${
                    w.id === waiterId ? 'bg-white/[0.08]' : ''
                  }`}
                >
                  <span className="text-sm font-bold text-[#c6b9a8]">{i + 1}.º</span>
                  <span className="min-w-0 truncate text-sm font-semibold text-white">
                    {w.full_name}
                    {!w.active && <span className="ml-1 text-xs font-normal text-[#c6b9a8]">(inactivo)</span>}
                  </span>
                  <span className="h-2 rounded-full bg-white/[0.06]">
                    <span
                      className="block h-2 rounded-full"
                      style={{ width: `${maiorDoRanking > 0 ? (w[rankKey] / maiorDoRanking) * 100 : 0}%`, background: GOLD }}
                    />
                  </span>
                  <span className="text-right text-sm font-semibold tabular-nums text-white">{valorDoRanking(w, rankKey)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </InsightPanel>

      {selecionado && pronto && (
        <GarconsHistorico
          storeId={storeId ?? null}
          waiterId={selecionado.id}
          nome={selecionado.full_name}
          from={range.from}
          to={range.to}
        />
      )}

      {ordenados.length > 0 && <TabelaCompleta waiters={ordenados} rankKey={rankKey} setRankKey={setRankKey} mostrarLoja={storeId === null} />}

      {relatorio && (
        <div className="insight-chart-grid">
          <InsightPanel title="Vendas por dia" description={selecionado ? `De ${selecionado.full_name}` : 'De todos os garçons'}>
            {dias.some((d) => d.orders > 0) ? (
              <>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={dias} margin={{ top: 12, right: 8, left: 0, bottom: 4 }} accessibilityLayer>
                    <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="#443a30" />
                    <XAxis dataKey="day" stroke="#c6b9a8" fontSize={11} tickLine={false} axisLine={false} minTickGap={24} dy={8} tickFormatter={(d: string) => `${d.slice(8)}/${d.slice(5, 7)}`} />
                    <YAxis stroke="#c6b9a8" fontSize={11} tickLine={false} axisLine={false} width={72} tickFormatter={(v: number) => money(Math.round(v))} />
                    <Tooltip cursor={{ fill: '#ffffff08' }} contentStyle={chartTooltip} labelStyle={{ color: '#faf6ef' }} formatter={(v) => [money(Number(v)), 'Vendas']} />
                    <Bar dataKey="revenue_cents" fill={GOLD} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                <details>
                  <summary>Ver valores do gráfico</summary>
                  <div className="insight-table-scroll" tabIndex={0} role="region" aria-label="Vendas por dia">
                    <table>
                      <caption className="sr-only">Pedidos e vendas por dia</caption>
                      <thead><tr><th scope="col" className="text-left">Dia</th><th scope="col" className="text-right">Pedidos</th><th scope="col" className="text-right">Vendas</th></tr></thead>
                      <tbody>{dias.map((d) => <tr key={d.day}><td>{d.day}</td><td className="text-right">{d.orders}</td><td className="text-right">{money(d.revenue_cents)}</td></tr>)}</tbody>
                    </table>
                  </div>
                </details>
              </>
            ) : (
              <InsightEmpty title="Sem pedidos neste período" />
            )}
          </InsightPanel>

          <InsightPanel title="Pedidos por hora" description="Quando a sala aperta · Africa/Maputo">
            {horas.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={horas} margin={{ top: 12, right: 8, left: -24, bottom: 4 }} accessibilityLayer>
                    <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="#443a30" />
                    <XAxis dataKey="hour" stroke="#c6b9a8" fontSize={11} tickLine={false} axisLine={false} dy={8} />
                    <YAxis stroke="#c6b9a8" fontSize={11} allowDecimals={false} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: '#ffffff08' }} contentStyle={chartTooltip} labelStyle={{ color: '#faf6ef' }} formatter={(v) => [v, 'Pedidos']} />
                    <Bar dataKey="orders" fill={GOLD} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                <details>
                  <summary>Ver pedidos por hora</summary>
                  <div className="insight-table-scroll" tabIndex={0} role="region" aria-label="Pedidos por hora">
                    <table>
                      <caption className="sr-only">Pedidos por hora de Maputo</caption>
                      <thead><tr><th scope="col" className="text-left">Hora</th><th scope="col" className="text-right">Pedidos</th></tr></thead>
                      <tbody>{horas.map((h) => <tr key={h.hour}><td>{h.hour}</td><td className="text-right">{h.orders}</td></tr>)}</tbody>
                    </table>
                  </div>
                </details>
              </>
            ) : (
              <InsightEmpty title="Sem pedidos neste período" />
            )}
          </InsightPanel>

          <InsightPanel title="Artigos mais vendidos" description={selecionado ? `Por ${selecionado.full_name}` : 'Pelos garçons'}>
            {relatorio.top_items.length > 0 ? (
              <ul className="space-y-2">
                {relatorio.top_items.map((item) => (
                  <li key={item.name} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-white">
                      <b className="tabular-nums text-[#f2c572]">{item.qty}×</b> {item.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-[#c6b9a8]">{money(item.revenue_cents)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <InsightEmpty title="Sem artigos neste período" />
            )}
          </InsightPanel>

          {equipa.data && <OrigemDaSala report={equipa.data} />}
        </div>
      )}
    </>
  );
}

/** Todos os números de cada garçom, numa tabela que se ordena pelos títulos. */
function TabelaCompleta({
  waiters,
  rankKey,
  setRankKey,
  mostrarLoja,
}: {
  waiters: WaiterMetrics[];
  rankKey: RankKey;
  setRankKey: (k: RankKey) => void;
  mostrarLoja: boolean;
}) {
  const Titulo = ({ k }: { k: RankKey }) => (
    <th scope="col" className="whitespace-nowrap px-3 py-2 text-right" aria-sort={rankKey === k ? 'descending' : 'none'}>
      <button className={rankKey === k ? 'font-bold text-[#f2c572]' : 'hover:text-white'} onClick={() => setRankKey(k)}>
        {RANK_LABEL[k]}{rankKey === k ? ' ↓' : ''}
      </button>
    </th>
  );
  const Fixo = ({ children }: { children: string }) => (
    <th scope="col" className="whitespace-nowrap px-3 py-2 text-right">{children}</th>
  );
  const Celula = ({ children }: { children: React.ReactNode }) => (
    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{children}</td>
  );

  return (
    <InsightPanel title="Todos os números" description="Toca num título para ordenar. Servidos conta quem levou à mesa, mesmo que outro tenha lançado.">
      <div className="insight-table-scroll" tabIndex={0} role="region" aria-label="Números por garçom">
        <table className="w-full min-w-[60rem] text-sm text-white">
          <caption className="sr-only">Métricas de cada garçom no período</caption>
          <thead className="text-xs text-[#c6b9a8]">
            <tr className="border-b border-white/[0.08]">
              <th scope="col" className="px-3 py-2 text-left">Garçom</th>
              {RANK_KEYS.map((k) => <Titulo key={k} k={k} />)}
              <Fixo>Art./pedido</Fixo>
              <Fixo>Até servir</Fixo>
              <Fixo>Por cobrar</Fixo>
              <Fixo>Retirados</Fixo>
              <Fixo>Cancelados</Fixo>
              <Fixo>Dias</Fixo>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {waiters.map((w) => (
              <tr key={w.id}>
                <th scope="row" className="whitespace-nowrap px-3 py-2 text-left font-semibold">
                  {w.full_name}
                  {mostrarLoja && <span className="ml-2 text-xs font-normal text-[#c6b9a8]">{w.store_short_name}</span>}
                </th>
                {RANK_KEYS.map((k) => <Celula key={k}>{valorDoRanking(w, k)}</Celula>)}
                <Celula>{itemsPerOrder(w).toLocaleString('pt-PT')}</Celula>
                <Celula>{formatMinutes(w.median_minutes_to_serve)}</Celula>
                <Celula>{money(w.open_cents)}</Celula>
                <Celula>{w.removed_events > 0 ? `${w.removed_events} · ${money(w.removed_cents)}` : '0'}</Celula>
                <Celula>{w.cancelled_orders}</Celula>
                <Celula>{w.active_days}</Celula>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </InsightPanel>
  );
}

/** Quanto dos pedidos de mesa passa pelos garçons, face ao balcão e ao QR. */
function OrigemDaSala({ report }: { report: MetricsReport }) {
  const origem = report.table_origin;
  const fatias = originShare(origem);
  const linhas = [
    { label: 'Garçons', pct: fatias.waiter, ...origem.waiter },
    { label: 'Balcão', pct: fatias.counter, ...origem.counter },
    { label: 'QR na mesa', pct: fatias.qr, ...origem.qr },
  ];
  const vazio = linhas.every((l) => l.orders === 0);
  return (
    <InsightPanel title="De onde vêm os pedidos de mesa" description="Toda a sala da loja, neste período">
      {vazio ? (
        <InsightEmpty title="Sem pedidos de mesa neste período" />
      ) : (
        <ul className="space-y-4">
          {linhas.map((l) => (
            <li key={l.label} className="space-y-1">
              <p className="flex items-baseline justify-between gap-3 text-sm text-white">
                <span>{l.label}</span>
                <span className="tabular-nums text-[#c6b9a8]">
                  <b className="text-white">{l.pct}%</b> · {numero(l.orders)} pedidos · {money(l.revenue_cents)}
                </span>
              </p>
              <span className="block h-2 rounded-full bg-white/[0.06]">
                <span className="block h-2 rounded-full" style={{ width: `${l.pct}%`, background: GOLD }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </InsightPanel>
  );
}
