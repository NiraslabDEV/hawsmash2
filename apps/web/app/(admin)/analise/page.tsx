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

export default function AnalisePage() {
  const [period, setPeriod] = useState<Period>('week');
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [funnel, setFunnel] = useState<FunnelMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMetrics() {
      const supabase = createClient();
      setLoading(true);
      setError(null);

      const [{ data, error: err }, { data: fData, error: fErr }] = await Promise.all([
        supabase.rpc('get_dashboard_metrics', { p_period: period }),
        supabase.rpc('get_funnel_metrics'),
      ]);

      if (err || fErr) {
        setError((err ?? fErr)!.message);
      } else {
        setMetrics(data as DashboardMetrics);
        setFunnel(fData as FunnelMetrics);
      }
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

          {/* Origem (UTM source) */}
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] p-6">
            <h2 className="text-lg font-bold text-[#F5A623] mb-1">Origem do Tráfego</h2>
            <p className="text-[#C9BCAC] text-xs mb-4">Sessões por utm_source · ROAS aproximado</p>
            {funnel.by_source.length === 0 ? (
              <p className="text-[#C9BCAC] text-sm">Sem dados de origem ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.08]">
                      <th className="text-left py-2 px-3 text-[#C9BCAC] font-medium">Origem</th>
                      <th className="text-right py-2 px-3 text-[#C9BCAC] font-medium">Sessões</th>
                      <th className="text-right py-2 px-3 text-[#C9BCAC] font-medium">Compras</th>
                      <th className="text-right py-2 px-3 text-[#C9BCAC] font-medium">Faturado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {funnel.by_source.map((row, i) => (
                      <tr key={i} className="border-b border-white/[0.04]">
                        <td className="py-2 px-3 text-[#F3E4CE] capitalize">{row.source}</td>
                        <td className="py-2 px-3 text-right text-[#F3E4CE]">{row.sessions.toLocaleString()}</td>
                        <td className="py-2 px-3 text-right text-[#F3E4CE]">{row.purchases.toLocaleString()}</td>
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