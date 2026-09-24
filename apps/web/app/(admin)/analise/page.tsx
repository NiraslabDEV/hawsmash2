'use client';

import { useEffect, useMemo, useState } from 'react';
import { UpsellInsights } from '@/components/admin/upsell-insights';
import { fetchAccountingExport } from '@/lib/admin/export-client';
import type { AccountingLayout, CsvFormat } from '@/lib/admin/accounting-export';
import { cents, formatMT } from '@delivery/core';
import { analysisPeriodStart, maputoDate, nextMaputoDay } from '@/lib/admin/analysis-period';
import { InsightIcon, InsightPanel, InsightEmpty, MetricCard } from '@/components/admin/insights-ui';
import { createClient } from '@/utils/supabase/client';
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

type Period = 'day' | 'week' | 'month' | 'all';
type Tab = 'vendas' | 'aquisicao' | 'pos';
type Store = { id: string; short_name: string };

interface FunnelStep {
  label: string;
  count: number;
  pct: number | null;
}

/** Uma linha do funil por origem (get_funnel_metrics, migration 1066). */
interface SourceRow {
  channel: string;
  source: string;
  medium: string;
  campaign: string | null;
  sessions: number;
  carts: number;
  checkouts: number;
  purchases: number;
  revenue_cents: number;
  pct_cart: number | null;
  pct_conv: number | null;
}

interface AttributionChannelRow {
  channel: string;
  sessions: number;
  orders: number;
  revenue_cents: number;
  conversion_pct: number | null;
}

interface AttributionCampaignRow {
  campaign: string;
  source: string;
  channel: string;
  orders: number;
  revenue_cents: number;
}

interface AttributionReport {
  totals: { orders: number; revenue_cents: number; sessions: number };
  by_channel: AttributionChannelRow[];
  by_source: Array<{ source: string; medium: string; orders: number; revenue_cents: number }>;
  by_campaign: AttributionCampaignRow[];
  discovery: Array<{ channel: string; orders: number; revenue_cents: number }>;
}

/** O dono lê "Instagram", não "organic_social". */
const CHANNEL_LABELS: Record<string, string> = {
  paid_search: 'Pesquisa paga',
  paid_social: 'Redes sociais (pago)',
  organic_search: 'Pesquisa (Google)',
  organic_social: 'Redes sociais',
  ai_assistant: 'Assistentes de IA',
  whatsapp: 'WhatsApp',
  email: 'Email',
  sms: 'SMS',
  qr: 'QR code / cartaz',
  influencer: 'Influenciadores',
  referral: 'Outros sites',
  direct: 'Directo',
  internal: 'Interno',
  balcao: 'Balcão (POS)',
};

const channelLabel = (c: string) => CHANNEL_LABELS[c] ?? c;

interface FunnelMetrics {
  funnel: {
    total_sessions: number;
    step_menu: number;
    step_cart: number;
    step_checkout: number;
    step_payment: number;
    step_purchase: number;
    pct_menu_to_cart: number | null;
    pct_cart_to_checkout: number | null;
    pct_checkout_to_payment: number | null;
    pct_payment_to_purchase: number | null;
    pct_overall: number | null;
  };
  by_source: SourceRow[];
}

interface PreviousPeriod {
  revenue_cents: number;
  total_orders: number;
}

interface DashboardMetrics {
  store_id: string | null;
  revenue_cents: number;
  avg_ticket_cents: number;
  total_orders: number;
  previous: PreviousPeriod | null;
  pickup_vs_delivery: Array<{
    fulfillment_type: string;
    count: number;
    revenue_cents: number;
  }>;
  avg_time_minutes: number;
  top_items: Array<{
    name: string;
    qty: number;
  }>;
  by_method: Array<{
    method: string;
    cents: number;
  }>;
  hourly: Array<{
    hour: number;
    count: number;
  }>;
  top_customers: Array<{
    customer_name: string;
    customer_phone: string;
    order_count: number;
    total_cents: number;
  }>;
  period_buckets: Array<{
    bucket: string;
    revenue_cents: number;
  }>;
}

const formatCents = (value: number) => formatMT(cents(value));

const formatPhone = (phone: string) => {
  if (!phone) return '-';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 9) {
    return `${cleaned.slice(0, 2)} ${cleaned.slice(2, 5)} ${cleaned.slice(5)}`;
  }
  return phone;
};

/** Percentagem de variação, ou null quando não há base para comparar. */
function pctChange(curr: number, prev: number): number | null {
  if (!prev || prev <= 0) return null;
  return Math.round(((curr - prev) / prev) * 100);
}

function TrendTag({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span className={`insight-trend ${up ? '' : 'insight-trend-down'}`}>
      {up ? '↑' : '↓'}
      {Math.abs(pct)}%
    </span>
  );
}

const PERIOD_LABELS: Record<Period, string> = { day: 'Últimas 24 horas', week: 'Últimos 7 dias', month: 'Últimos 30 dias', all: 'Todo o histórico' };
const chartTooltip = { backgroundColor: '#2a231d', border: '1px solid #796957', borderRadius: 10, color: '#faf6ef', fontSize: 13 };
const card = 'insight-panel';

function ExportContabilidadeCard({ stores, isOwner, selectedStore }: { stores: Store[]; isOwner: boolean; selectedStore: string | null }) {
  const [storeId, setStoreId] = useState(selectedStore ?? 'all');
  const [layout, setLayout] = useState<AccountingLayout>('payments');
  const [format, setFormat] = useState<CsvFormat>('excel');
  const [from, setFrom] = useState(() => `${maputoDate().slice(0, 7)}-01`);
  const [to, setTo] = useState(() => maputoDate());
  const ready = isOwner || stores.length > 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      // até é exclusivo na RPC (created_at < p_to) — soma-se um dia para incluir o próprio dia "até"
      const toExclusive = nextMaputoDay(to);
      const params = new URLSearchParams({
        store_id: storeId, layout, format,
        from: new Date(`${from}T00:00:00+02:00`).toISOString(),
        to: toExclusive,
      });
      const res = await fetchAccountingExport(params);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Não foi possível gerar o ficheiro.');
      }
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${layout === 'orders' ? 'pedidos' : 'pagamentos'}-${from}-a-${to}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao exportar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="exportar" className="insight-export">
      <InsightPanel title="Pronto para a contabilidade" description="Exporte todas as origens da loja e datas escolhidas abaixo, independentemente do filtro de vendas.">
        <form onSubmit={(event) => { event.preventDefault(); void handleExport(); }}>
          <label><span id="export-store-label">Loja</span><select aria-labelledby="export-store-label" value={storeId} onChange={(e) => setStoreId(e.target.value)} disabled={!ready}>
            {isOwner && <option value="all">Todas as lojas</option>}
            {!ready && <option value="all">A carregar lojas…</option>}
            {stores.map((s) => <option key={s.id} value={s.id}>{s.short_name}</option>)}
          </select></label>
          <label>De<input type="date" required value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>Até<input type="date" required value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
          <label><span id="export-content-label">Conteúdo</span><select aria-labelledby="export-content-label" value={layout} onChange={(e) => setLayout(e.target.value as AccountingLayout)}>
            <option value="payments">Pagamentos detalhados</option><option value="orders">Resumo por pedido</option>
          </select></label>
          <label><span id="export-format-label">Formato</span><select aria-labelledby="export-format-label" value={format} onChange={(e) => setFormat(e.target.value as CsvFormat)}>
            <option value="excel">CSV para Excel (; / 123,45)</option><option value="standard">CSV padrão (, / 123.45)</option>
          </select></label>
          <button className="insight-button insight-button-primary" disabled={busy || !ready || !from || !to || from > to}>
            <InsightIcon name="download" />{busy ? 'A gerar…' : 'Descarregar CSV'}
          </button>
        </form>
        <p className="insight-subtitle">{layout === 'payments' ? 'Uma linha por pagamento confirmado ou devolvido. O total do pedido repete-se nos pagamentos mistos; some a coluna de pagamentos.' : 'Uma linha por pedido, com o total da venda e os pagamentos confirmados e devolvidos em colunas separadas.'} Datas pela criação do pedido, em Maputo.</p>
        <details><summary>Importar para WinREST ou outro software</summary>
          <p className="insight-subtitle">Estes CSV servem para conferência e mapeamento. A importação directa depende da versão e do modelo aceite pelo software de destino. O formato WinREST ainda não está validado. A emissão fiscal é feita no software certificado, com os artigos, impostos e dados fiscais confirmados pelo contabilista.</p>
        </details>
        {error && <p role="alert" className="mt-3 text-[#ffb099]">{error}</p>}
      </InsightPanel>
    </div>
  );
}

export default function AnalisePage() {
  const [period, setPeriod] = useState<Period>('week');
  const [tab, setTab] = useState<Tab>('vendas');
  const [origin, setOrigin] = useState<'all' | 'online' | 'pos'>('all');
  const salesOrigin = tab === 'pos' ? 'pos' : origin;

  const [stores, setStores] = useState<Store[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [myStoreIds, setMyStoreIds] = useState<string[]>([]);
  // undefined = ainda não decidido (à espera de saber o papel do utilizador)
  const [storeId, setStoreId] = useState<string | null | undefined>(undefined);

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [funnel, setFunnel] = useState<FunnelMetrics | null>(null);
  const [attribution, setAttribution] = useState<AttributionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [acquisitionError, setAcquisitionError] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // DECISÃO: resolver o acesso antes das métricas; uma loja em falta nunca
  // é convertida numa consulta consolidada de gerente.
  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void (async () => {
      try {
        setSetupError(null);
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) throw new Error('Sessão indisponível. Volte a entrar no painel.');
        const [profile, storeRows, myStores] = await Promise.all([
          supabase.from('staff_profiles').select('role').eq('user_id', user.id).maybeSingle(),
          supabase.from('stores').select('id,short_name').eq('active', true).order('sort'),
          supabase.from('staff_stores').select('store_id').eq('user_id', user.id),
        ]);
        if (profile.error || storeRows.error || myStores.error) throw new Error('Não foi possível carregar as lojas. Tente novamente.');
        if (!active) return;
        const owner = profile.data?.role === 'owner';
        const rows = (storeRows.data ?? []) as Store[];
        const ids = ((myStores.data ?? []) as { store_id: string }[]).map((r) => r.store_id).filter((id) => rows.some((row) => row.id === id));
        if (!owner && !ids.length) throw new Error('Não tem uma loja activa atribuída. Contacte o responsável pelo painel.');
        setIsOwner(owner); setMyStoreIds(ids); setStores(rows);
        setStoreId((current) => current !== undefined && (owner || (current && ids.includes(current))) ? current : owner ? null : ids[0]);
      } catch (e) {
        if (active) { setSetupError(e instanceof Error ? e.message : 'Não foi possível carregar o acesso às lojas.'); setLoading(false); }
      }
    })();
    return () => { active = false; };
  }, [attempt]);

  const storeOptions = useMemo(() => {
    if (isOwner) return [{ id: null as string | null, label: 'Todas' }, ...stores.map((s) => ({ id: s.id, label: s.short_name }))];
    return stores.filter((s) => myStoreIds.includes(s.id)).map((s) => ({ id: s.id as string | null, label: s.short_name }));
  }, [isOwner, myStoreIds, stores]);

  useEffect(() => {
    if (storeId === undefined) return; // ainda a carregar o papel do utilizador

    let active = true;
    async function fetchMetrics() {
      const supabase = createClient();
      setLoading(true);
      setError(null);

      try {
        const from = analysisPeriodStart(period);
        const [{ data, error: err }, { data: fData, error: fErr }, attr] = await Promise.all([
          supabase.rpc('get_sales_metrics', { p_period: period, p_store_id: storeId, p_origin: salesOrigin }),
          supabase.rpc('get_funnel_metrics', { p_from: from, p_store_id: storeId }),
          supabase.rpc('get_attribution_report', { p_from: from, p_store_id: storeId }),
        ]);

        if (!active) return;
        if (err || !data) {
          setMetrics(null);
          setError('Não foi possível carregar as vendas. Tente novamente.');
        } else {
          setMetrics(data as DashboardMetrics);
        }

        // Uma falha de marketing mostra um aviso sem esconder as vendas.
        setAcquisitionError(Boolean(fErr || attr.error));
        setFunnel(fErr ? null : (fData as FunnelMetrics));
        setAttribution(attr.error ? null : (attr.data as AttributionReport));
      } catch {
        if (!active) return;
        setMetrics(null); setFunnel(null); setAttribution(null);
        setError('Não foi possível carregar os dados. Verifique a ligação e tente novamente.');
        setAcquisitionError(true);
      } finally { if (active) setLoading(false); }
    }

    void fetchMetrics();
    return () => { active = false; };
  }, [period, storeId, attempt, salesOrigin]);

  const fulfillmentLabels: Record<string, string> = {
    pickup: 'Levantamento',
    delivery: 'Entrega', counter: 'Balcão', dine_in: 'Na mesa',
  };

  const methodLabels: Record<string, string> = {
    mpesa: 'M-Pesa',
    emola: 'e-Mola',
    credit_card: 'Cartão', card: 'Cartão',
    cash: 'Dinheiro',
  };

  const revenueTrend = metrics?.previous ? pctChange(metrics.revenue_cents, metrics.previous.revenue_cents) : null;
  const ordersTrend = metrics?.previous ? pctChange(metrics.total_orders, metrics.previous.total_orders) : null;

  const topItem = metrics?.top_items[0] ?? null;
  const topCustomer = metrics?.top_customers[0] ?? null;
  const peakHour = metrics?.hourly.reduce<{ hour: number; count: number } | null>(
    (max, row) => (row.count > (max?.count ?? -1) ? row : max),
    null,
  );

  const methodData = (metrics?.by_method ?? []).map((item) => ({
    name: methodLabels[item.method] || item.method,
    valor: item.cents,
  }));

  const hourlyData = Array.from({ length: 24 }, (_, hour) => ({
    hour: `${hour}:00`,
    pedidos: metrics?.hourly.find((h) => h.hour === hour)?.count || 0,
  }));

  const periodData = (metrics?.period_buckets ?? []).map((item) => ({
    data: new Date(item.bucket).toLocaleDateString('pt-PT', {
      timeZone: 'Africa/Maputo', day: '2-digit',
      month: 'short',
      ...(period === 'day' && { hour: '2-digit', minute: '2-digit' }),
    }),
    revenue: item.revenue_cents,
  }));

  return (
    <div className="insights">
      <header className="insight-header">
        <div><p className="insight-eyebrow">Visão do negócio</p><h1>Análise</h1>
          <p className="insight-subtitle">{tab === 'pos' ? 'O desempenho das vendas criadas no POS, incluindo entregas e levantamentos.' : tab === 'vendas' ? 'Os números que ajudam a decidir o próximo passo.' : 'Do primeiro contacto à compra online. Sem vendas do POS.'}</p>
        </div>
        {tab === 'vendas' && metrics && !loading && !error && !setupError && <a className="insight-button" href="#exportar"><InsightIcon name="download" />Exportar relatório</a>}
      </header>
      <div className="insight-toolbar">
        <div className="insight-filter"><span className="insight-filter-label">Loja</span>
          <div className="insight-segment" role="group" aria-label="Filtrar por loja">
            {storeOptions.map((opt) => <button key={opt.id ?? 'all'} aria-pressed={storeId === opt.id} onClick={() => setStoreId(opt.id)}>{opt.label}</button>)}
          </div>
        </div>
        <div className="insight-filter"><span className="insight-filter-label">Período</span>
          <div className="insight-segment" role="group" aria-label="Filtrar por período">
            {(['day', 'week', 'month', 'all'] as Period[]).map((p) => <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)}>{({ day: '24h', week: '7 dias', month: '30 dias', all: 'Tudo' })[p]}</button>)}
          </div>
        </div>
      </div>
      <nav className="insight-tabs" aria-label="Vistas da análise">
        {([['vendas', 'Vendas'], ['aquisicao', 'Aquisição'], ['pos', 'POS']] as [Tab, string][]).map(([value, label]) =>
          <button key={value} aria-pressed={tab === value} aria-controls="analysis-content" onClick={() => setTab(value)}><InsightIcon name={value === 'aquisicao' ? 'globe' : 'chart'} />{label}</button>)}
      </nav>
      {tab === 'vendas' && <div className="insight-filter mb-4"><span className="insight-filter-label">Origem do pedido</span><div className="insight-segment" role="group" aria-label="Filtrar por origem">{([['all','Todos'],['online','Online'],['pos','POS']] as const).map(([value,label]) => <button key={value} aria-pressed={origin === value} onClick={() => setOrigin(value)}>{label}</button>)}</div></div>}
      {tab === 'aquisicao' && <p className="insight-subtitle mb-4">Apenas o percurso online. Pedidos feitos no site e pagos ao balcão continuam aqui. Vendas criadas no POS têm a sua própria vista.</p>}
      <div className="insight-context"><span>{PERIOD_LABELS[period]} · {storeOptions.find((s) => s.id === storeId)?.label ?? 'A carregar lojas'}</span><span>Hora de Maputo · Valores em MT</span></div>
      <div id="analysis-content" className="contents" aria-busy={loading}>
      {setupError ? <div className="insight-notice" role="alert"><strong>Não foi possível abrir a análise</strong><p>{setupError}</p><button className="insight-button" onClick={() => setAttempt((n) => n + 1)}>Tentar novamente</button></div> : loading ? <div className="insight-loading" role="status"><div className="insight-loading-bars" aria-hidden="true"><span /><span /><span /></div>A carregar {tab === 'aquisicao' ? 'aquisição' : 'vendas'}…</div> : <>
      {tab !== 'aquisicao' && error && <div className="insight-notice" role="alert"><strong>As vendas estão indisponíveis</strong><p>{error}</p><button className="insight-button" onClick={() => setAttempt((n) => n + 1)}>Tentar novamente</button></div>}
      {tab !== 'aquisicao' && metrics && (
        <>
          <div className="insight-grid">
            <MetricCard featured label="Facturação" value={formatCents(metrics.revenue_cents)} icon="chart" detail={revenueTrend !== null ? <><TrendTag pct={revenueTrend} />vs. período anterior</> : 'Vendas confirmadas no período'} />
            <MetricCard label="Pedidos" value={metrics.total_orders.toLocaleString('pt-PT')} icon="orders" detail={ordersTrend !== null ? <><TrendTag pct={ordersTrend} />vs. período anterior</> : 'Pedidos confirmados'} />
            <MetricCard label="Valor médio por pedido" value={formatCents(metrics.avg_ticket_cents)} icon="ticket" detail="Facturação por pedido confirmado" />
            <MetricCard label="Tempo médio de entrega" value={metrics.avg_time_minutes ? `${metrics.avg_time_minutes.toFixed(0)} min` : '—'} icon="clock" detail={metrics.avg_time_minutes ? 'Média das entregas concluídas' : 'Sem entregas concluídas no período'} />
          </div>
          <div className="insight-chart-grid">
            <InsightPanel title="Evolução da facturação" description="Receita de pedidos confirmados ao longo do período" aside={<span className="insight-badge">{PERIOD_LABELS[period]}</span>}>
              {periodData.length ? <>
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={periodData} margin={{ top: 12, right: 12, left: 0, bottom: 4 }} accessibilityLayer>
                    <defs><linearGradient id="revenue-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f2c572" stopOpacity={0.24} /><stop offset="100%" stopColor="#f2c572" stopOpacity={0.01} /></linearGradient></defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="#443a30" />
                    <XAxis dataKey="data" stroke="#c6b9a8" fontSize={11} tickLine={false} axisLine={false} minTickGap={35} dy={8} />
                    <YAxis stroke="#c6b9a8" fontSize={11} tickLine={false} axisLine={false} width={80} tickFormatter={(v: number) => formatCents(Math.round(v))} />
                    <Tooltip contentStyle={chartTooltip} labelStyle={{ color: '#faf6ef' }} formatter={(v) => [formatCents(Number(v)), 'Facturação']} />
                    <Area type="linear" dataKey="revenue" stroke="#f2c572" fill="url(#revenue-fill)" strokeWidth={2.5} dot={{ r: 3, fill: '#f2c572', strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
                <details><summary>Ver valores do gráfico</summary><div className="insight-table-scroll" tabIndex={0} role="region" aria-label="Valores da facturação"><table><caption className="sr-only">Facturação por data</caption><thead><tr><th scope="col" className="text-left">Data</th><th scope="col" className="text-right">Facturação</th></tr></thead><tbody>{periodData.map((r, i) => <tr key={i}><td>{r.data}</td><td className="text-right">{formatCents(r.revenue)}</td></tr>)}</tbody></table></div></details>
              </> : <InsightEmpty title="Ainda não há vendas neste período">Experimente outro período ou outra loja.</InsightEmpty>}
            </InsightPanel>
            <InsightPanel title="Ritmo do dia" description="Pedidos por hora · Africa/Maputo" aside={<InsightIcon name="clock" />}>
              {metrics.total_orders > 0 ? <>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={hourlyData} margin={{ top: 12, right: 8, left: -24, bottom: 4 }} accessibilityLayer>
                    <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="#443a30" />
                    <XAxis dataKey="hour" stroke="#c6b9a8" fontSize={11} interval={5} tickLine={false} axisLine={false} dy={8} />
                    <YAxis stroke="#c6b9a8" fontSize={11} allowDecimals={false} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: '#ffffff08' }} contentStyle={chartTooltip} labelStyle={{ color: '#faf6ef' }} formatter={(v) => [v, 'Pedidos']} />
                    <Bar dataKey="pedidos" fill="#8ecab8" radius={[4,4,0,0]} maxBarSize={18} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
                <details><summary>Ver pedidos por hora</summary><div className="insight-table-scroll" tabIndex={0} role="region" aria-label="Pedidos por hora"><table><caption className="sr-only">Pedidos por hora de Maputo</caption><thead><tr><th scope="col" className="text-left">Hora</th><th scope="col" className="text-right">Pedidos</th></tr></thead><tbody>{hourlyData.map((r) => <tr key={r.hour}><td>{r.hour}</td><td className="text-right">{r.pedidos}</td></tr>)}</tbody></table></div></details>
              </> : <InsightEmpty title="Sem pedidos para analisar" />}
            </InsightPanel>
          </div>
          <InsightPanel title="Destaques do período" description="Uma leitura rápida do que mais se destacou">
            <div className="insight-highlights">
              <div className="insight-highlight"><small>01 / Produto mais vendido</small><strong>{topItem?.name ?? 'Sem produtos vendidos'}</strong><p>{topItem ? `${topItem.qty} unidades vendidas` : 'Os produtos aparecem após a primeira venda.'}</p></div>
              <div className="insight-highlight"><small>02 / Cliente com maior facturação</small><strong>{topCustomer?.customer_name ?? 'Sem clientes no período'}</strong><p>{topCustomer ? formatCents(topCustomer.total_cents) : 'Ainda não há dados para comparar.'}</p></div>
              <div className="insight-highlight"><small>03 / Hora com mais pedidos</small><strong>{peakHour && peakHour.count > 0 ? `${peakHour.hour}h00` : 'Sem hora de pico'}</strong><p>{peakHour && peakHour.count > 0 ? `${peakHour.count} pedidos nesta hora` : 'Ainda não há pedidos no período.'}</p></div>
            </div>
          </InsightPanel>
          <div className="insight-two-col">
            <InsightPanel title="Como chegam os pedidos" description="Distribuição por tipo de serviço">
              {metrics.pickup_vs_delivery.length ? <div className="insight-rows">{metrics.pickup_vs_delivery.map((r) => <div key={r.fulfillment_type}>
                <div className="insight-row-label"><strong>{fulfillmentLabels[r.fulfillment_type] ?? r.fulfillment_type}</strong><strong>{formatCents(r.revenue_cents)}</strong></div>
                <div className="insight-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, r.count / Math.max(metrics.total_orders, 1) * 100)}%` }} /></div>
                <p className="insight-subtitle">{r.count} pedidos</p>
              </div>)}</div> : <InsightEmpty title="Sem pedidos neste período" />}
            </InsightPanel>
            <InsightPanel title="Métodos de pagamento" description="Facturação por forma de pagamento">
              {methodData.length ? <div className="insight-rows">{methodData.map((r) => <div key={r.name}>
                <div className="insight-row-label"><span>{r.name}</span><strong>{formatCents(r.valor)}</strong></div>
                <div className="insight-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, r.valor / Math.max(...methodData.map((m) => m.valor), 1) * 100)}%`, background: '#8ecab8' }} /></div>
              </div>)}</div> : <InsightEmpty title="Sem pagamentos no período" />}
            </InsightPanel>
          </div>

          {/* Tabelas */}
          <div className="insight-two-col">
            {/* Top itens */}
            <div className={card}>
              <h2 className="text-lg font-bold text-[#f2c572] mb-4">Produtos mais vendidos</h2>
              <div className="insight-table-scroll" tabIndex={0} role="region" aria-label="Tabela de análise">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.08]">
                      <th scope="col" className="text-left py-2 px-4 text-[#C9BCAC] text-sm font-medium">Posição</th>
                      <th scope="col" className="text-left py-2 px-4 text-[#C9BCAC] text-sm font-medium">Item</th>
                      <th scope="col" className="text-right py-2 px-4 text-[#C9BCAC] text-sm font-medium">Qtd</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.top_items.length === 0 && <tr><td colSpan={3}>Sem produtos vendidos neste período.</td></tr>}
                    {metrics.top_items.map((item, index) => (
                      <tr key={index} className="border-b border-white/[0.04]">
                        <td className="py-3 px-4 text-[#F3E4CE]">{index + 1}º</td>
                        <td className="py-3 px-4 text-[#F3E4CE]">{item.name}</td>
                        <td className="py-3 px-4 text-right text-[#f2c572] font-bold">{item.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Top clientes */}
            <div className={card}>
              <h2 className="text-lg font-bold text-[#f2c572] mb-4">Clientes com maior facturação</h2>
              <div className="insight-table-scroll" tabIndex={0} role="region" aria-label="Tabela de análise">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.08]">
                      <th scope="col" className="text-left py-2 px-4 text-[#C9BCAC] text-sm font-medium">Cliente</th>
                      <th scope="col" className="text-left py-2 px-4 text-[#C9BCAC] text-sm font-medium">Telefone</th>
                      <th scope="col" className="text-right py-2 px-4 text-[#C9BCAC] text-sm font-medium">Pedidos</th>
                      <th scope="col" className="text-right py-2 px-4 text-[#C9BCAC] text-sm font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.top_customers.length === 0 && <tr><td colSpan={4}>Sem clientes neste período.</td></tr>}
                    {metrics.top_customers.map((customer, index) => (
                      <tr key={index} className="border-b border-white/[0.04]">
                        <td className="py-3 px-4 text-[#F3E4CE]">{customer.customer_name}</td>
                        <td className="py-3 px-4 text-[#F3E4CE]">{formatPhone(customer.customer_phone)}</td>
                        <td className="py-3 px-4 text-right text-[#F3E4CE]">{customer.order_count}</td>
                        <td className="py-3 px-4 text-right text-[#f2c572] font-bold">
                          {formatCents(customer.total_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <ExportContabilidadeCard key={storeId ?? 'all'} stores={stores.filter((s) => isOwner || myStoreIds.includes(s.id))} isOwner={isOwner} selectedStore={storeId ?? null} />
        </>
      )}

      {tab === 'aquisicao' && (
        <>
          {acquisitionError && <div className="insight-notice" role="alert"><strong>Alguns dados de aquisição estão indisponíveis</strong><p>Não foi possível carregar todos os relatórios. Os dados disponíveis continuam abaixo.</p><button className="insight-button" onClick={() => setAttempt((n) => n + 1)}>Tentar novamente</button></div>}
          {(funnel || attribution) && <div className="insight-grid">
            <MetricCard featured label="Sessões no site" value={funnel ? funnel.funnel.total_sessions.toLocaleString('pt-PT') : '—'} detail="Sessões únicas no período" icon="globe" />
            <MetricCard label="Conversão do funil" value={funnel?.funnel.pct_overall != null ? `${funnel.funnel.pct_overall.toLocaleString('pt-PT')}%` : '—'} detail="Sessões que chegaram à compra" icon="chart" />
            <MetricCard label="Pedidos atribuídos" value={attribution ? attribution.totals.orders.toLocaleString('pt-PT') : '—'} detail="Pedidos online confirmados" icon="orders" />
            <MetricCard label="Receita atribuída" value={attribution ? formatCents(attribution.totals.revenue_cents) : '—'} detail="Receita de pedidos online confirmados" icon="ticket" />
          </div>}
          {!funnel && !attribution && !acquisitionError && <InsightEmpty title="Ainda não há dados de aquisição">As visitas e compras aparecerão aqui quando houver actividade.</InsightEmpty>}
          {/* Funil de conversão first-party */}
          {(funnel || attribution) && (
            <div className="insight-two-col">
              {funnel && (
              <div className={card}>
                <h2 className="text-lg font-bold text-[#f2c572] mb-1">Funil de conversão</h2>
                <p className="text-[#C9BCAC] text-xs mb-4">
                  Sessões únicas · Taxa global: {funnel.funnel.pct_overall != null ? `${funnel.funnel.pct_overall.toLocaleString('pt-PT')}%` : '—'}
                </p>
                {(() => {
                  const f = funnel.funnel;
                  const steps: FunnelStep[] = [
                    { label: 'Viram o cardápio',    count: f.step_menu,     pct: null },
                    { label: 'Puseram no carrinho', count: f.step_cart,     pct: f.pct_menu_to_cart },
                    // Pode passar de 100%: quem volta com o carrinho guardado
                    // faz checkout sem add_to_cart nessa sessão (RASTREIO.md §6.5).
                    { label: 'Iniciaram checkout',  count: f.step_checkout, pct: f.pct_cart_to_checkout },
                    { label: 'Escolheram pagamento',count: f.step_payment,  pct: f.pct_checkout_to_payment },
                    { label: 'Compraram',           count: f.step_purchase, pct: f.pct_payment_to_purchase },
                  ];
                  const max = Math.max(...steps.map((step) => step.count), 1);
                  return (
                    <div className="insight-rows">
                      {steps.map((step, i) => (
                        <div key={i}>
                          <div className="insight-funnel-label">
                            <span className="text-[#F3E4CE]"><span className="insight-badge mr-2">0{i + 1}</span>{step.label}</span>
                            <span className="text-[#f2c572] font-bold">
                              {step.count.toLocaleString()}
                              {step.pct != null && (
                                <span className="insight-funnel-rate">{step.pct.toLocaleString('pt-PT')}% da etapa anterior</span>
                              )}
                            </span>
                          </div>
                          <div className="h-2 rounded bg-white/[0.08]">
                            <div
                              className="h-2 rounded bg-[#f2c572]"
                              style={{ width: `${Math.round((step.count / max) * 100)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
              )}

              {/* Origem das vendas — atribuição multi-fonte (migration 1029) */}
              <div className={card}>
                <h2 className="text-lg font-bold text-[#f2c572] mb-1">Origem das vendas</h2>
                <p className="text-[#C9BCAC] text-xs mb-4">
                  Último toque com origem · receita de pedidos reais, não do pixel
                </p>
                {!attribution || attribution.by_channel.length === 0 ? (
                  <p className="text-[#C9BCAC] text-sm">{attribution ? 'Sem dados de origem ainda.' : 'O relatório de origem está indisponível.'}</p>
                ) : (
                  <div className="insight-table-scroll" tabIndex={0} role="region" aria-label="Tabela de análise">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/[0.08]">
                          <th scope="col" className="text-left py-2 px-3 text-[#C9BCAC] font-medium">Canal</th>
                          <th scope="col" className="text-right py-2 px-3 text-[#C9BCAC] font-medium">Sessões</th>
                          <th scope="col" className="text-right py-2 px-3 text-[#C9BCAC] font-medium">Pedidos</th>
                          <th scope="col" className="text-right py-2 px-3 text-[#C9BCAC] font-medium">Conv.</th>
                          <th scope="col" className="text-right py-2 px-3 text-[#C9BCAC] font-medium">Facturado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attribution.by_channel.map((row) => (
                          <tr key={row.channel} className="border-b border-white/[0.04]">
                            <td className="py-2 px-3 text-[#F3E4CE]">{channelLabel(row.channel)}</td>
                            <td className="py-2 px-3 text-right text-[#F3E4CE]">{row.sessions.toLocaleString()}</td>
                            <td className="py-2 px-3 text-right text-[#F3E4CE]">{row.orders.toLocaleString()}</td>
                            <td className="py-2 px-3 text-right text-[#C9BCAC]">
                              {row.conversion_pct != null ? `${row.conversion_pct.toLocaleString('pt-PT')}%` : '—'}
                            </td>
                            <td className="py-2 px-3 text-right text-[#f2c572] font-bold">
                              {formatCents(row.revenue_cents)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Funil por origem — de onde vêm as sessões e até onde chegam */}
          {funnel && (
            <div className={card}>
              <h2 className="text-lg font-bold text-[#f2c572] mb-1">Funil por origem</h2>
              <p className="text-[#C9BCAC] text-xs mb-4">
                Sessões por fonte e campanha · quantas chegam ao carrinho e à compra. Compare as etapas para identificar onde investigar perdas de conversão.
              </p>
              {funnel.by_source.length === 0 ? (
                <p className="text-[#C9BCAC] text-sm">Sem sessões neste período.</p>
              ) : (
                <div className="insight-table-scroll" tabIndex={0} role="region" aria-label="Tabela de análise">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.08]">
                        <th scope="col" className="text-left py-2 px-3 text-[#C9BCAC] font-medium">Canal</th>
                        <th scope="col" className="text-left py-2 px-3 text-[#C9BCAC] font-medium">Fonte / meio</th>
                        <th scope="col" className="text-left py-2 px-3 text-[#C9BCAC] font-medium">Campanha</th>
                        <th scope="col" className="text-right py-2 px-3 text-[#C9BCAC] font-medium">Sessões</th>
                        <th scope="col" className="text-right py-2 px-3 text-[#C9BCAC] font-medium">Carrinho</th>
                        <th scope="col" className="text-right py-2 px-3 text-[#C9BCAC] font-medium">Compras</th>
                        <th scope="col" className="text-right py-2 px-3 text-[#C9BCAC] font-medium">Facturado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {funnel.by_source.map((row, i) => (
                        <tr key={`${row.channel}-${row.source}-${row.campaign}-${i}`} className="border-b border-white/[0.04]">
                          <td className="py-2 px-3 text-[#F3E4CE]">{channelLabel(row.channel)}</td>
                          <td className="py-2 px-3 text-[#C9BCAC]">{row.source} / {row.medium}</td>
                          <td className="py-2 px-3 text-[#C9BCAC]">{row.campaign ?? '—'}</td>
                          <td className="py-2 px-3 text-right text-[#F3E4CE]">{row.sessions.toLocaleString()}</td>
                          <td className="py-2 px-3 text-right text-[#F3E4CE]">
                            {row.carts.toLocaleString()}
                            {row.pct_cart != null && (
                              <span className="text-[#C9BCAC] ml-1">({row.pct_cart}%)</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right text-[#F3E4CE]">{row.purchases.toLocaleString()}</td>
                          <td className="py-2 px-3 text-right text-[#f2c572] font-bold">
                            {formatCents(row.revenue_cents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Campanhas e primeiro toque */}
          {attribution && (attribution.by_campaign.length > 0 || attribution.discovery.length > 0) && (
            <div className="insight-two-col">
              <div className={card}>
                <h2 className="text-lg font-bold text-[#f2c572] mb-1">Campanhas</h2>
                <p className="text-[#C9BCAC] text-xs mb-4">Receita de pedidos atribuídos a cada campanha</p>
                {attribution.by_campaign.length === 0 ? (
                  <p className="text-[#C9BCAC] text-sm">Nenhum pedido veio de uma campanha marcada com utm_campaign.</p>
                ) : (
                  <div className="insight-table-scroll" tabIndex={0} role="region" aria-label="Tabela de análise">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/[0.08]">
                          <th scope="col" className="text-left py-2 px-3 text-[#C9BCAC] font-medium">Campanha</th>
                          <th scope="col" className="text-left py-2 px-3 text-[#C9BCAC] font-medium">Fonte</th>
                          <th scope="col" className="text-right py-2 px-3 text-[#C9BCAC] font-medium">Pedidos</th>
                          <th scope="col" className="text-right py-2 px-3 text-[#C9BCAC] font-medium">Facturado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {attribution.by_campaign.map((row, i) => (
                          <tr key={`${row.campaign}-${i}`} className="border-b border-white/[0.04]">
                            <td className="py-2 px-3 text-[#F3E4CE]">{row.campaign}</td>
                            <td className="py-2 px-3 text-[#C9BCAC]">{row.source}</td>
                            <td className="py-2 px-3 text-right text-[#F3E4CE]">{row.orders.toLocaleString()}</td>
                            <td className="py-2 px-3 text-right text-[#f2c572] font-bold">
                              {formatCents(row.revenue_cents)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className={card}>
                <h2 className="text-lg font-bold text-[#f2c572] mb-1">Primeiro contacto com a marca</h2>
                <p className="text-[#C9BCAC] text-xs mb-4">
                  Primeiro toque · o canal que apresentou a marca, mesmo que a venda tenha fechado noutro
                </p>
                {attribution.discovery.length === 0 ? (
                  <p className="text-[#C9BCAC] text-sm">Sem dados de primeiro toque ainda.</p>
                ) : (
                  <div className="space-y-3">
                    {(() => {
                      const max = Math.max(...attribution.discovery.map((d) => d.revenue_cents), 1);
                      return attribution.discovery.map((d) => (
                        <div key={d.channel}>
                          <div className="insight-funnel-label">
                            <span className="text-[#F3E4CE]">{channelLabel(d.channel)}</span>
                            <span className="text-[#f2c572] font-bold">
                              {formatCents(d.revenue_cents)}
                              <span className="text-[#C9BCAC] font-normal ml-2">{d.orders} ped.</span>
                            </span>
                          </div>
                          <div className="h-2 rounded bg-white/[0.08]">
                            <div
                              className="h-2 rounded bg-[#f2c572]"
                              style={{ width: `${Math.round((d.revenue_cents / max) * 100)}%` }}
                            />
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
      </>}
      {!loading && !setupError && storeId !== undefined && <UpsellInsights period={period} storeId={storeId} origin={tab === 'aquisicao' ? 'online' : salesOrigin} />}
      </div>
    </div>
  );
}
