'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

const COLORS = ['#F5A623', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

type Period = 'day' | 'week' | 'month' | 'all';

interface FunnelStep {
  label: string;
  count: number;
  pct: number | null;
}

interface SourceRow {
  source: string;
  sessions: number;
  purchases: number;
  revenue_cents: number;
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
    step_checkout: number;
    step_payment: number;
    step_purchase: number;
    pct_menu_to_checkout: number | null;
    pct_checkout_to_payment: number | null;
    pct_payment_to_purchase: number | null;
    pct_overall: number | null;
  };
  by_source: SourceRow[];
}

interface DashboardMetrics {
  revenue_cents: number;
  avg_ticket_cents: number;
  total_orders: number;
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

const formatCents = (cents: number) => {
  return `MT ${(cents / 100).toLocaleString('pt-MZ', { minimumFractionDigits: 0 })}`;
};

const formatPhone = (phone: string) => {
  if (!phone) return '-';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 9) {
    return `${cleaned.slice(0, 2)} ${cleaned.slice(2, 5)} ${cleaned.slice(5)}`;
  }
  return phone;
};

type ExportStore = { id: string; short_name: string };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Início do período escolhido, no formato que a RPC de atribuição espera. */
function periodStartIso(period: Period): string | null {
  const now = new Date();
  if (period === 'day') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  if (period === 'week') return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  return '2020-01-01T00:00:00.000Z'; // 'all' — antes de existir a primeira venda
}

function firstOfMonthIso() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

function ExportContabilidadeCard() {
  const [stores, setStores] = useState<ExportStore[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [storeId, setStoreId] = useState('all');
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const [{ data: profile }, { data: storeRows }] = await Promise.all([
        user
          ? supabase.from('staff_profiles').select('role').eq('user_id', user.id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from('stores').select('id,short_name').eq('active', true).order('sort'),
      ]);
      const owner = profile?.role === 'owner';
      setIsOwner(owner);
      const list = (storeRows ?? []) as ExportStore[];
      setStores(list);
      if (!owner && list.length > 0) setStoreId(list[0].id);
    })();
  }, []);

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      // até é exclusivo na RPC (created_at < p_to) — soma-se um dia para incluir o próprio dia "até"
      const toExclusive = new Date(`${to}T00:00:00`);
      toExclusive.setDate(toExclusive.getDate() + 1);
      const params = new URLSearchParams({
        store_id: storeId,
        from: new Date(`${from}T00:00:00`).toISOString(),
        to: toExclusive.toISOString(),
      });
      const res = await fetch(`/api/reports/export-sales?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Não foi possível gerar o ficheiro.');
      }
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `vendas-${from}-a-${to}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao exportar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-6">
      <h2 className="text-lg font-bold text-[#F5A623] mb-1">Exportar para o contabilista</h2>
      <p className="text-[#C9BCAC] text-xs mb-4">
        CSV com uma linha por pagamento confirmado (data, loja, pedido, forma de pagamento, valor) —
        o formato final para a facturação fiscal fica a cargo do software certificado do contabilista.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-[#C9BCAC] mb-1">Loja</label>
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            className="bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-[#F3E4CE]"
          >
            {isOwner && <option value="all">Todas as lojas</option>}
            {stores.map((s) => <option key={s.id} value={s.id}>{s.short_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-[#C9BCAC] mb-1">De</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-[#F3E4CE]"
          />
        </div>
        <div>
          <label className="block text-xs text-[#C9BCAC] mb-1">Até</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="bg-white/[0.06] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-[#F3E4CE]"
          />
        </div>
        <button
          onClick={handleExport}
          disabled={busy}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-[#F5A623] text-[#2A1710] hover:brightness-110 disabled:opacity-50"
        >
          {busy ? 'A gerar…' : 'Descarregar CSV'}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}

export default function AnalisePage() {
  const [period, setPeriod] = useState<Period>('week');
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [funnel, setFunnel] = useState<FunnelMetrics | null>(null);
  const [attribution, setAttribution] = useState<AttributionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMetrics() {
      const supabase = createClient();
      setLoading(true);
      setError(null);

      const [{ data, error: err }, { data: fData, error: fErr }, attr] = await Promise.all([
        supabase.rpc('get_dashboard_metrics', { p_period: period }),
        supabase.rpc('get_funnel_metrics'),
        supabase.rpc('get_attribution_report', { p_from: periodStartIso(period) }),
      ]);

      if (err || fErr) {
        setError((err ?? fErr)!.message);
      } else {
        setMetrics(data as DashboardMetrics);
        setFunnel(fData as FunnelMetrics);
      }

      // A atribuição é leitura de marketing: se falhar (um manager sem acesso
      // consolidado, por exemplo) esconde-se o cartão em vez de derrubar a
      // página inteira de operação.
      setAttribution(attr.error ? null : (attr.data as AttributionReport));
      setLoading(false);
    }

    fetchMetrics();
  }, [period]);

  const fulfillmentLabels = {
    pickup: 'Levantamento',
    delivery: 'Entrega',
  };

  const methodLabels = {
    mpesa: 'M-Pesa',
    emola: 'e-Mola',
    credit_card: 'Cartão',
    cash: 'Dinheiro',
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-10 text-center">
        <div className="text-[#F5A623]">A carregar métricas...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-10 text-center">
        <div className="text-red-400">Erro: {error}</div>
      </div>
    );
  }

  if (!metrics) {
    return null;
  }

  // Preparar dados para gráficos
  const pickupDeliveryData = metrics.pickup_vs_delivery.map((item) => ({
    name: fulfillmentLabels[item.fulfillment_type as keyof typeof fulfillmentLabels] || item.fulfillment_type,
    Pedidos: item.count,
    Faturação: item.revenue_cents / 100,
  }));

  const methodData = metrics.by_method.map((item) => ({
    name: methodLabels[item.method as keyof typeof methodLabels] || item.method,
    valor: item.cents / 100,
  }));

  const hourlyData = Array.from({ length: 24 }, (_, hour) => ({
    hour: `${hour}:00`,
    pedidos: metrics.hourly.find((h) => h.hour === hour)?.count || 0,
  }));

  const periodData = metrics.period_buckets.map((item) => ({
    data: new Date(item.bucket).toLocaleDateString('pt-PT', {
      day: '2-digit',
      month: 'short',
      ...(period === 'day' && { hour: '2-digit', minute: '2-digit' }),
    }),
    faturação: item.revenue_cents / 100,
  }));

  return (
    <div className="space-y-6">
      {/* Header com filtros */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white tracking-tight">Análise</h1>
        <div className="flex gap-2">
          {(['day', 'week', 'month', 'all'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                period === p
                  ? 'bg-[#F5A623] text-[#2A1710]'
                  : 'bg-white/[0.08] text-[#F3E4CE] hover:bg-white/[0.12]'
              }`}
            >
              {p === 'day' && '24h'}
              {p === 'week' && '7 dias'}
              {p === 'month' && '30 dias'}
              {p === 'all' && 'Tudo'}
            </button>
          ))}
        </div>
      </div>

      <ExportContabilidadeCard />

      {/* Cards de métricas principais */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-6">
          <div className="text-[#C9BCAC] text-sm mb-2">Faturação Total</div>
          <div className="text-3xl font-bold text-[#F5A623]">{formatCents(metrics.revenue_cents)}</div>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-6">
          <div className="text-[#C9BCAC] text-sm mb-2">Ticket Médio</div>
          <div className="text-3xl font-bold text-[#F5A623]">{formatCents(metrics.avg_ticket_cents)}</div>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-6">
          <div className="text-[#C9BCAC] text-sm mb-2">Total de Pedidos</div>
          <div className="text-3xl font-bold text-[#F5A623]">{metrics.total_orders}</div>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-6">
          <div className="text-[#C9BCAC] text-sm mb-2">Tempo Médio Entrega</div>
          <div className="text-3xl font-bold text-[#F5A623]">
            {metrics.avg_time_minutes ? `${metrics.avg_time_minutes.toFixed(1)} min` : '-'}
          </div>
        </div>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Faturação ao longo do tempo */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-6">
          <h2 className="text-lg font-bold text-[#F5A623] mb-4">Faturação ao Longo do Tempo</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={periodData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="data" stroke="#C9BCAC" fontSize={12} />
              <YAxis stroke="#C9BCAC" fontSize={12} tickFormatter={(v) => `MT${v}`} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#231610',
                  border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#F3E4CE' }}
                formatter={(value) => [`MT ${Number(value).toFixed(0)}`, 'Faturação']}
              />
              <Legend />
              <Line type="monotone" dataKey="faturação" stroke="#F5A623" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Levantamento vs Entrega */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-6">
          <h2 className="text-lg font-bold text-[#F5A623] mb-4">Levantamento vs Entrega</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={pickupDeliveryData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="name" stroke="#C9BCAC" fontSize={12} />
              <YAxis stroke="#C9BCAC" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#231610',
                  border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#F3E4CE' }}
                formatter={(value, name) => [
                  name === 'Faturação' ? `MT ${Number(value).toFixed(0)}` : value,
                  name,
                ]}
              />
              <Legend />
              <Bar dataKey="Pedidos" fill="#F5A623" />
              <Bar dataKey="Faturação" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Heatmap de horários de pico */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-6">
          <h2 className="text-lg font-bold text-[#F5A623] mb-4">Horários de Pico</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={hourlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="hour" stroke="#C9BCAC" fontSize={12} interval={2} />
              <YAxis stroke="#C9BCAC" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#231610',
                  border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#F3E4CE' }}
                formatter={(value) => [value, 'Pedidos']}
              />
              <Bar dataKey="pedidos" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Métodos de pagamento */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-6">
          <h2 className="text-lg font-bold text-[#F5A623] mb-4">Faturação por Método de Pagamento</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={methodData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={(entry) => {
                  const e = entry as { name?: string; valor?: number };
                  return `${e.name} (MT${(e.valor || 0).toFixed(0)})`;
                }}
                outerRadius={80}
                fill="#8884d8"
                dataKey="valor"
              >
                {methodData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#231610',
                  border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#F3E4CE' }}
                formatter={(value) => [`MT ${Number(value).toFixed(0)}`, 'Faturação']}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Funil de conversão first-party */}
      {funnel && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Funil por etapa */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-6">
            <h2 className="text-lg font-bold text-[#F5A623] mb-1">Funil de Conversão</h2>
            <p className="text-[#C9BCAC] text-xs mb-4">
              Sessões únicas · Taxa global: {funnel.funnel.pct_overall != null ? `${funnel.funnel.pct_overall}%` : '—'}
            </p>
            {(() => {
              const f = funnel.funnel;
              const steps: FunnelStep[] = [
                { label: 'Viram o cardápio',    count: f.step_menu,     pct: null },
                { label: 'Iniciaram checkout',  count: f.step_checkout, pct: f.pct_menu_to_checkout },
                { label: 'Escolheram pagamento',count: f.step_payment,  pct: f.pct_checkout_to_payment },
                { label: 'Compraram',           count: f.step_purchase, pct: f.pct_payment_to_purchase },
              ];
              const max = f.step_menu || 1;
              return (
                <div className="space-y-3">
                  {steps.map((step, i) => (
                    <div key={i}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-[#F3E4CE]">{step.label}</span>
                        <span className="text-[#F5A623] font-bold">
                          {step.count.toLocaleString()}
                          {step.pct != null && (
                            <span className="text-[#C9BCAC] font-normal ml-2">↑{step.pct}%</span>
                          )}
                        </span>
                      </div>
                      <div className="h-2 rounded bg-white/[0.08]">
                        <div
                          className="h-2 rounded bg-[#F5A623]"
                          style={{ width: `${Math.round((step.count / max) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Origem das vendas — atribuição multi-fonte (migration 1029) */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-6">
            <h2 className="text-lg font-bold text-[#F5A623] mb-1">Origem das Vendas</h2>
            <p className="text-[#C9BCAC] text-xs mb-4">
              Último toque com origem · receita de pedidos reais, não do pixel
            </p>
            {!attribution || attribution.by_channel.length === 0 ? (
              <p className="text-[#C9BCAC] text-sm">Sem dados de origem ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.08]">
                      <th className="text-left py-2 px-3 text-[#C9BCAC] font-medium">Canal</th>
                      <th className="text-right py-2 px-3 text-[#C9BCAC] font-medium">Sessões</th>
                      <th className="text-right py-2 px-3 text-[#C9BCAC] font-medium">Pedidos</th>
                      <th className="text-right py-2 px-3 text-[#C9BCAC] font-medium">Conv.</th>
                      <th className="text-right py-2 px-3 text-[#C9BCAC] font-medium">Faturado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attribution.by_channel.map((row) => (
                      <tr key={row.channel} className="border-b border-white/[0.04]">
                        <td className="py-2 px-3 text-[#F3E4CE]">{channelLabel(row.channel)}</td>
                        <td className="py-2 px-3 text-right text-[#F3E4CE]">{row.sessions.toLocaleString()}</td>
                        <td className="py-2 px-3 text-right text-[#F3E4CE]">{row.orders.toLocaleString()}</td>
                        <td className="py-2 px-3 text-right text-[#C9BCAC]">
                          {row.conversion_pct != null ? `${row.conversion_pct}%` : '—'}
                        </td>
                        <td className="py-2 px-3 text-right text-[#F5A623] font-bold">
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

      {/* Campanhas e primeiro toque */}
      {attribution && (attribution.by_campaign.length > 0 || attribution.discovery.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-6">
            <h2 className="text-lg font-bold text-[#F5A623] mb-1">Campanhas</h2>
            <p className="text-[#C9BCAC] text-xs mb-4">Quanto é que cada campanha pôs no caixa</p>
            {attribution.by_campaign.length === 0 ? (
              <p className="text-[#C9BCAC] text-sm">Nenhum pedido veio de uma campanha marcada com utm_campaign.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.08]">
                      <th className="text-left py-2 px-3 text-[#C9BCAC] font-medium">Campanha</th>
                      <th className="text-left py-2 px-3 text-[#C9BCAC] font-medium">Fonte</th>
                      <th className="text-right py-2 px-3 text-[#C9BCAC] font-medium">Pedidos</th>
                      <th className="text-right py-2 px-3 text-[#C9BCAC] font-medium">Faturado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attribution.by_campaign.slice(0, 10).map((row, i) => (
                      <tr key={`${row.campaign}-${i}`} className="border-b border-white/[0.04]">
                        <td className="py-2 px-3 text-[#F3E4CE]">{row.campaign}</td>
                        <td className="py-2 px-3 text-[#C9BCAC]">{row.source}</td>
                        <td className="py-2 px-3 text-right text-[#F3E4CE]">{row.orders.toLocaleString()}</td>
                        <td className="py-2 px-3 text-right text-[#F5A623] font-bold">
                          {formatCents(row.revenue_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-6">
            <h2 className="text-lg font-bold text-[#F5A623] mb-1">Quem Descobriu o Cliente</h2>
            <p className="text-[#C9BCAC] text-xs mb-4">
              Primeiro toque · o canal que apresentou a marca, mesmo que a venda tenha fechado noutro
            </p>
            {attribution.discovery.length === 0 ? (
              <p className="text-[#C9BCAC] text-sm">Sem dados de primeiro toque ainda.</p>
            ) : (
              <div className="space-y-3">
                {(() => {
                  const max = Math.max(...attribution.discovery.map((d) => d.revenue_cents), 1);
                  return attribution.discovery.slice(0, 8).map((d) => (
                    <div key={d.channel}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-[#F3E4CE]">{channelLabel(d.channel)}</span>
                        <span className="text-[#F5A623] font-bold">
                          {formatCents(d.revenue_cents)}
                          <span className="text-[#C9BCAC] font-normal ml-2">{d.orders} ped.</span>
                        </span>
                      </div>
                      <div className="h-2 rounded bg-white/[0.08]">
                        <div
                          className="h-2 rounded bg-[#F5A623]"
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

      {/* Tabelas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top itens */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-6">
          <h2 className="text-lg font-bold text-[#F5A623] mb-4">Top 10 Itens Mais Vendidos</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  <th className="text-left py-2 px-4 text-[#C9BCAC] text-sm font-medium">Posição</th>
                  <th className="text-left py-2 px-4 text-[#C9BCAC] text-sm font-medium">Item</th>
                  <th className="text-right py-2 px-4 text-[#C9BCAC] text-sm font-medium">Qtd</th>
                </tr>
              </thead>
              <tbody>
                {metrics.top_items.map((item, index) => (
                  <tr key={index} className="border-b border-white/[0.04]">
                    <td className="py-3 px-4 text-[#F3E4CE]">{index + 1}º</td>
                    <td className="py-3 px-4 text-[#F3E4CE]">{item.name}</td>
                    <td className="py-3 px-4 text-right text-[#F5A623] font-bold">{item.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top clientes */}
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-6">
          <h2 className="text-lg font-bold text-[#F5A623] mb-4">Top 10 Clientes</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.08]">
                  <th className="text-left py-2 px-4 text-[#C9BCAC] text-sm font-medium">Cliente</th>
                  <th className="text-left py-2 px-4 text-[#C9BCAC] text-sm font-medium">Telefone</th>
                  <th className="text-right py-2 px-4 text-[#C9BCAC] text-sm font-medium">Pedidos</th>
                  <th className="text-right py-2 px-4 text-[#C9BCAC] text-sm font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {metrics.top_customers.map((customer, index) => (
                  <tr key={index} className="border-b border-white/[0.04]">
                    <td className="py-3 px-4 text-[#F3E4CE]">{customer.customer_name}</td>
                    <td className="py-3 px-4 text-[#F3E4CE]">{formatPhone(customer.customer_phone)}</td>
                    <td className="py-3 px-4 text-right text-[#F3E4CE]">{customer.order_count}</td>
                    <td className="py-3 px-4 text-right text-[#F5A623] font-bold">
                      {formatCents(customer.total_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}