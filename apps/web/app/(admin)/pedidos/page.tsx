'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { formatMT, type Cents } from '@delivery/core';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { pt } from 'date-fns/locale';

type Order = {
  id: string;
  order_number: string;
  status: string;
  flow: string;
  fulfillment_type: string;
  delivery_zone_id: string | null;
  address: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  scheduled_for: string | null;
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  payment_method: string;
  payment_proof_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  items: Array<{ id: string; menu_item_id: string; name: string; qty: number; unit_price_cents: number; station: string; notes: string | null }>;
};

type Stats = {
  total_faturado: number;
  ativos: number;
  aguarda_pagamento: number;
  em_preparo: number;
  prontos: number;
  faturado_hoje: number;
  pedidos_hoje: number;
  cancelados_hoje: number;
  entregues_hoje: number;
  // deltas vs ontem (migration 0022)
  faturado_ontem?: number;
  pedidos_ontem?: number;
  cancelados_ontem?: number;
  avg_rating: number | null;
  avg_rating_hoje?: number | null;
  avg_rating_ontem?: number | null;
  status_counts?: Record<string, number>;
};

type DeviceStatus = {
  devices: Array<{ id: string; kind: string; last_seen_at: string; online: boolean }>;
  threshold_seconds: number;
};

const FATURADO_HIDDEN_KEY = 'pedidos_faturado_hidden';
const PAGE_SIZE = 10;
const money = (c: number) => formatMT(c as Cents);
const GLASS = 'rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)]';

// abas de status (filtro único no get_orders)
const TABS: { key: string; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'awaiting_approval', label: 'Novos' },
  { key: 'paid', label: 'Pagos' },
  { key: 'approved', label: 'Aceitos' },
  { key: 'in_preparation', label: 'Em preparo' },
  { key: 'ready', label: 'Prontos' },
  { key: 'delivered', label: 'Entregues' },
  { key: 'cancelled', label: 'Cancelados' },
];

// cor (dot) por status — estilo iFood
const STATUS_META: Record<string, { dot: string; text: string; label: string }> = {
  awaiting_approval: { dot: 'bg-amber-400', text: 'text-amber-400', label: 'Novo' },
  awaiting_payment: { dot: 'bg-blue-400', text: 'text-blue-400', label: 'A pagar' },
  paid: { dot: 'bg-blue-400', text: 'text-blue-400', label: 'Pago' },
  approved: { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'Aceito' },
  in_preparation: { dot: 'bg-orange-400', text: 'text-orange-400', label: 'Em preparo' },
  ready: { dot: 'bg-purple-400', text: 'text-purple-400', label: 'Pronto' },
  delivered: { dot: 'bg-green-500', text: 'text-green-500', label: 'Entregue' },
  cancelled: { dot: 'bg-red-500', text: 'text-red-500', label: 'Cancelado' },
  payment_failed: { dot: 'bg-red-500', text: 'text-red-400', label: 'Falhou' },
};
const statusMeta = (s: string) => STATUS_META[s] ?? { dot: 'bg-gray-500', text: 'text-gray-400', label: s };

// % de variação vs ontem — null quando não há base de comparação (sem inventar)
function pctDelta(hoje: number, ontem: number | undefined): number | null {
  if (ontem == null || ontem === 0) return null;
  return Math.round(((hoje - ontem) / ontem) * 100);
}

export default function PedidosPage() {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [proofUrls, setProofUrls] = useState<Record<string, string>>({});
  const [showDenyModal, setShowDenyModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [denyReason, setDenyReason] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [hideFaturado, setHideFaturado] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') setHideFaturado(window.localStorage.getItem(FATURADO_HIDDEN_KEY) === '1');
  }, []);
  const toggleHideFaturado = () => {
    setHideFaturado((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') window.localStorage.setItem(FATURADO_HIDDEN_KEY, next ? '1' : '0');
      return next;
    });
  };

  // auto-dismiss do toast
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 3000);
    return () => clearTimeout(t);
  }, [message]);

  const fetchStats = useCallback(async () => {
    const { data } = await supabase.rpc('get_order_stats');
    if (data) setStats(data);
  }, [supabase]);

  const fetchDeviceStatus = useCallback(async () => {
    const { data } = await supabase.rpc('get_device_status');
    if (data) setDeviceStatus(data);
  }, [supabase]);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const filters: Record<string, unknown> = { limit: 100 };
      if (search) filters.search = search;
      if (statusFilter !== 'all') filters.status = statusFilter;
      const { data, error } = await supabase.rpc('get_orders', { p_filters: filters });
      if (!error && data) setOrders(data.orders || []);
    } finally {
      setLoading(false);
    }
  }, [supabase, search, statusFilter]);

  useEffect(() => { fetchStats(); fetchDeviceStatus(); }, [fetchStats, fetchDeviceStatus]);
  useEffect(() => { const i = setInterval(fetchDeviceStatus, 60000); return () => clearInterval(i); }, [fetchDeviceStatus]);
  useEffect(() => { fetchOrders(); }, [fetchOrders]);
  useEffect(() => { setPage(1); }, [search, statusFilter]); // reset paginação ao filtrar

  const refreshData = async () => { await Promise.all([fetchStats(), fetchOrders(), fetchDeviceStatus()]); };

  const loadProof = useCallback(async (order: Order) => {
    if (!order.payment_proof_path || proofUrls[order.id]) return;
    const { data, error } = await supabase.storage.from('payment-proofs').createSignedUrl(order.payment_proof_path, 3600);
    if (error || !data) { setMessage({ type: 'error', text: 'Erro ao abrir comprovativo' }); return; }
    setProofUrls((prev) => ({ ...prev, [order.id]: data.signedUrl }));
  }, [supabase, proofUrls]);

  const toggleExpand = (order: Order) => {
    if (expandedId === order.id) setExpandedId(null);
    else { setExpandedId(order.id); loadProof(order); }
  };

  const advance = async (order: Order, event: string, reason?: string) => {
    const { data, error } = await supabase.rpc('advance_order', { p_order_id: order.id, p_event: event, ...(reason ? { p_reason: reason } : {}) });
    if (error) { setMessage({ type: 'error', text: error.message }); return false; }
    if (event === 'APPROVE') {
      fetch('/api/conversions/fire', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: order.id, totalCents: order.total_cents }) }).catch(() => {});
    }
    if (event === 'APPROVE' && order.customer_email) {
      fetch('/api/emails/send-approval-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: order.customer_email, customerName: order.customer_name, orderNumber: order.order_number, totalCents: order.total_cents, paymentMethod: order.payment_method }) }).catch(console.error);
    }
    if (event === 'CANCEL' && order.customer_email) {
      fetch('/api/emails/send-rejection-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: order.customer_email, customerName: order.customer_name, orderNumber: order.order_number, reason, paymentMethod: order.payment_method }) }).catch(console.error);
    }
    setMessage({ type: 'success', text: data?.message || 'Pedido atualizado!' });
    await refreshData();
    return true;
  };

  const handleDeny = async () => {
    if (!selectedOrder || !denyReason.trim()) return;
    const ok = await advance(selectedOrder, 'CANCEL', denyReason);
    if (ok) { setShowDenyModal(false); setSelectedOrder(null); setDenyReason(''); }
  };

  const formatDate = (s: string | null) => (s ? format(parseISO(s), "dd/MM 'às' HH:mm", { locale: pt }) : 'Agora');
  // quando o pedido ENTROU (created_at) em relativo: "há 5 minutos"
  const relativeTime = (s: string) => formatDistanceToNow(parseISO(s), { locale: pt, addSuffix: true });

  const nextAction = (order: Order): { event: string; label: string; color: string } | null => {
    switch (order.status) {
      case 'approved':
      case 'paid': return { event: 'START_PREPARATION', label: 'Iniciar preparo', color: 'bg-orange-600 hover:bg-orange-500' };
      case 'in_preparation': return { event: 'MARK_READY', label: 'Marcar pronto', color: 'bg-purple-600 hover:bg-purple-500' };
      case 'ready': return { event: 'DELIVER', label: order.fulfillment_type === 'delivery' ? 'Enviar' : 'Entregue', color: 'bg-green-600 hover:bg-green-500' };
      default: return null;
    }
  };
  const isActive = (s: string) => ['approved', 'paid', 'in_preparation', 'ready'].includes(s);

  const printer = deviceStatus?.devices.find((d) => d.kind === 'printer');
  const printerOnline = !!printer?.online;

  // contagem por aba (real, vinda do RPC)
  const counts = stats?.status_counts ?? {};
  const tabCount = (key: string): number | null => {
    if (!stats) return null;
    if (key === 'all') return Object.values(counts).reduce((a, b) => a + (b || 0), 0);
    return counts[key] ?? 0;
  };

  // paginação local sobre o array carregado
  const totalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageOrders = orders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const fromIdx = orders.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const toIdx = Math.min(currentPage * PAGE_SIZE, orders.length);

  const ActionButtons = ({ order }: { order: Order }) => {
    const action = nextAction(order);
    return (
      <div className="flex flex-wrap gap-2">
        {order.status === 'awaiting_approval' && (
          <>
            <button onClick={() => advance(order, 'APPROVE')} className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-xl hover:bg-emerald-500 transition-all">Aprovar</button>
            <button onClick={() => { setSelectedOrder(order); setShowDenyModal(true); }} className="px-3 py-1.5 text-xs font-semibold bg-white/[0.06] text-red-400 rounded-xl hover:bg-red-900/20 transition-all">Negar</button>
          </>
        )}
        {action && (
          <button onClick={() => advance(order, action.event)} className={`px-3 py-1.5 text-xs font-semibold text-white rounded-xl transition-all ${action.color}`}>{action.label}</button>
        )}
        {isActive(order.status) && (
          <button onClick={() => { setSelectedOrder(order); setShowDenyModal(true); }} className="px-3 py-1.5 text-xs font-semibold bg-white/[0.06] text-red-400 rounded-xl hover:bg-red-900/20 transition-all">Cancelar</button>
        )}
      </div>
    );
  };

  const StatusPill = ({ status }: { status: string }) => {
    const m = statusMeta(status);
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${m.text}`}>
        <span className={`w-2 h-2 rounded-full ${m.dot} ${status === 'in_preparation' ? 'animate-pulse' : ''}`} />{m.label}
      </span>
    );
  };

  // deltas calculados
  const dFaturado = stats ? pctDelta(stats.faturado_hoje, stats.faturado_ontem) : null;
  const dPedidos = stats ? pctDelta(stats.pedidos_hoje, stats.pedidos_ontem) : null;
  const dCancelados = stats ? pctDelta(stats.cancelados_hoje, stats.cancelados_ontem) : null;
  const dRating = stats && stats.avg_rating_hoje != null && stats.avg_rating_ontem != null
    ? Math.round((stats.avg_rating_hoje - stats.avg_rating_ontem) * 10) / 10
    : null;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-white tracking-tight">Pedidos</h1>

      {/* Banner da impressora — só se existir e estiver offline */}
      {printer && !printerOnline && (
        <div className="flex items-center justify-between gap-4 rounded-2xl bg-[#F5A623]/[0.06] backdrop-blur-[12px] border border-[#F5A623]/25 shadow-[0_0_24px_rgba(245,166,35,0.08)] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-[#F5A623] animate-pulse" />
            <div>
              <p className="font-semibold text-[#F5A623]">Impressora Offline</p>
              <p className="text-sm text-[#C9BCAC]">Verifique a conexão da impressora (print-bridge).</p>
            </div>
          </div>
          <button onClick={fetchDeviceStatus} className="shrink-0 rounded-xl border border-[#F5A623]/30 bg-[#F5A623]/15 px-4 py-2 text-sm font-semibold text-[#F5A623] hover:bg-[#F5A623]/25 transition-all">Reconectar</button>
        </div>
      )}

      {/* KPIs */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiCard label="Total faturado (hoje)" value={hideFaturado ? '••••' : money(stats.faturado_hoje)} accentBorder="border-t-[#22C55E]/60"
            delta={<Delta pct={dFaturado} goodUp />}
            action={<button onClick={toggleHideFaturado} className="text-[#8A7A69] hover:text-[#F5A623] transition-colors" title="Ocultar/mostrar">{hideFaturado ? '🙈' : '👁'}</button>} />
          <KpiCard label="Pedidos (hoje)" value={String(stats.pedidos_hoje)} accentBorder="border-t-[#22C55E]/60" delta={<Delta pct={dPedidos} goodUp />} />
          <KpiCard label="Em preparo" value={String(stats.em_preparo)} accentBorder="border-t-[#F59E0B]/60" delta={<span className="text-xs font-medium text-[#F59E0B]">● Em andamento</span>} />
          <KpiCard label="Prontos" value={String(stats.prontos)} accentBorder="border-t-[#8B5CF6]/60" delta={<span className="text-xs font-medium text-[#8B5CF6]">● Aguardando coleta</span>} />
          <KpiCard label="Cancelados" value={String(stats.cancelados_hoje)} accentBorder="border-t-[#EF4444]/60" delta={<Delta pct={dCancelados} goodUp={false} />} />
          <KpiCard label="Avaliação média" value={stats.avg_rating != null ? `${stats.avg_rating} ⭐` : '—'} accentBorder="border-t-amber-400/60"
            delta={dRating != null
              ? <span className={`text-xs font-medium ${dRating > 0 ? 'text-[#22C55E]' : dRating < 0 ? 'text-[#EF4444]' : 'text-[#8A7A69]'}`}>{dRating > 0 ? '▲' : dRating < 0 ? '▼' : '•'} {Math.abs(dRating).toFixed(1).replace('.', ',')} vs ontem</span>
              : <span className="text-xs font-medium text-[#8A7A69]">feedback dos clientes</span>} />
        </div>
      )}

      {/* Barra de filtros */}
      <div className={`${GLASS} p-3 flex flex-wrap items-center gap-3`}>
        <div className="flex-1 min-w-[200px] flex items-center gap-2 bg-black/20 border border-white/[0.08] rounded-xl px-3 py-2.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8A7A69" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar pedido, cliente, telefone…"
            className="bg-transparent text-sm text-white placeholder-[#8A7A69] focus:outline-none w-full" />
        </div>
        <div className="flex items-center gap-2 bg-black/20 border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-[#C9BCAC]">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
          <span className="capitalize">{format(new Date(), "'Hoje,' dd/MM/yyyy", { locale: pt })}</span>
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-black/20 border border-white/[0.08] rounded-xl px-3 py-2.5 text-sm text-[#C9BCAC] focus:outline-none focus:border-[#F5A623]/40 cursor-pointer">
          {TABS.map((t) => <option key={t.key} value={t.key} className="bg-[#231610] text-white">{t.key === 'all' ? 'Todos os status' : t.label}</option>)}
        </select>
      </div>

      {/* Abas de status com contagem */}
      <div className="flex gap-1 flex-wrap">
        {TABS.map((t) => {
          const active = statusFilter === t.key;
          const c = tabCount(t.key);
          return (
            <button key={t.key} onClick={() => setStatusFilter(t.key)}
              className={`px-3 py-1.5 rounded-xl text-sm transition-all ${
                active ? 'bg-[#F5A623]/15 border border-[#F5A623]/30 text-[#F5A623] font-semibold' : 'text-[#C9BCAC] hover:bg-white/[0.06] hover:text-white'
              }`}>
              {t.label}
              {c != null && (
                <span className={`ml-1.5 text-[11px] rounded-full px-1.5 ${active ? 'bg-[#F5A623] text-[#2A1710]' : 'bg-white/[0.08] text-[#8A7A69]'}`}>{c}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tabela (desktop) */}
      <div className={`hidden md:block ${GLASS} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-white/[0.03] border-b border-white/[0.06]">
              <tr className="text-left text-[11px] uppercase tracking-wide text-[#8A7A69] font-medium">
                <th className="px-4 py-3">Pedido</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Endereço</th>
                <th className="px-4 py-3">Horário</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-[#C9BCAC]">A carregar pedidos…</td></tr>
              ) : pageOrders.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-[#C9BCAC]">Nenhum pedido encontrado</td></tr>
              ) : (
                pageOrders.map((order) => {
                  const expanded = expandedId === order.id;
                  return (
                    <Fragment key={order.id}>
                      <tr className={`border-b border-white/[0.04] transition-colors ${expanded ? 'bg-[#F5A623]/[0.03]' : 'hover:bg-white/[0.04]'}`}>
                        <td className="px-4 py-3"><div className="font-mono font-bold text-white">{order.order_number}</div><div className="text-[11px] text-[#8A7A69]">{order.flow === 'digital' ? 'Pago online' : 'Manual'}</div></td>
                        <td className="px-4 py-3"><div className="font-medium text-white">{order.customer_name}</div><div className="text-[11px] text-[#C9BCAC]">{order.customer_phone}</div></td>
                        <td className="px-4 py-3"><TypeBadge type={order.fulfillment_type} />{order.payment_proof_path && <div className="text-[11px] text-[#F5A623] mt-1">📎 comprovativo</div>}</td>
                        <td className="px-4 py-3 text-sm text-[#C9BCAC] max-w-[220px] truncate">{order.fulfillment_type === 'delivery' ? (order.address || '—') : 'Levantamento no balcão'}</td>
                        <td className="px-4 py-3">
                          <div className="text-sm text-[#F3E4CE]">{formatDate(order.scheduled_for)}</div>
                          <div className="text-[11px] text-[#8A7A69]" title={`Pedido feito: ${format(parseISO(order.created_at), "dd/MM 'às' HH:mm", { locale: pt })}`}>{relativeTime(order.created_at)}</div>
                        </td>
                        <td className="px-4 py-3"><div className="font-bold text-white">{money(order.total_cents)}</div><div className="mt-0.5"><PayBadge method={order.payment_method} /></div></td>
                        <td className="px-4 py-3"><StatusPill status={order.status} /></td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <ActionButtons order={order} />
                            <button onClick={() => toggleExpand(order)} className="px-3 py-1.5 text-xs font-medium rounded-xl border border-white/[0.08] text-[#C9BCAC] hover:bg-white/[0.06] hover:text-white transition-all whitespace-nowrap">
                              {expanded ? 'Ocultar' : 'Ver detalhes'}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-white/[0.02] border-b border-white/[0.06]"><td colSpan={8} className="px-6 py-4"><OrderDetail order={order} proofUrl={proofUrls[order.id]} actions={<ActionButtons order={order} />} /></td></tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {/* Paginação */}
        {!loading && orders.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06] text-sm text-[#8A7A69]">
            <span>Exibindo {fromIdx} a {toIdx} de {orders.length} pedidos</span>
            <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />
          </div>
        )}
      </div>

      {/* Cards (mobile) */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="text-center text-[#C9BCAC] py-8">A carregar pedidos…</div>
        ) : pageOrders.length === 0 ? (
          <div className="text-center text-[#C9BCAC] py-8">Nenhum pedido encontrado</div>
        ) : (
          <>
            {pageOrders.map((order) => (
              <div key={order.id} className={`${GLASS} p-4`}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-mono font-bold text-white">{order.order_number}</div>
                    <div className="text-sm text-white">{order.customer_name}</div>
                    <div className="text-[11px] text-[#8A7A69]">{order.customer_phone}</div>
                  </div>
                  <StatusPill status={order.status} />
                </div>
                <div className="flex items-center justify-between text-sm mb-3">
                  <span className="text-[#C9BCAC] flex items-center gap-1.5 flex-wrap"><TypeBadge type={order.fulfillment_type} /> · {formatDate(order.scheduled_for)} <span className="text-[11px] text-[#8A7A69]">· {relativeTime(order.created_at)}</span></span>
                  <span className="font-bold text-white">{money(order.total_cents)}</span>
                </div>
                <ActionButtons order={order} />
                <button onClick={() => toggleExpand(order)} className="mt-3 text-xs text-[#F5A623] font-medium">
                  {expandedId === order.id ? 'Ocultar detalhes' : 'Ver detalhes'}
                </button>
                {expandedId === order.id && <div className="mt-3 border-t border-white/[0.06] pt-3"><OrderDetail order={order} proofUrl={proofUrls[order.id]} actions={null} /></div>}
              </div>
            ))}
            {orders.length > PAGE_SIZE && (
              <div className="flex items-center justify-between text-sm text-[#8A7A69] pt-1">
                <span>{fromIdx}–{toIdx} de {orders.length}</span>
                <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal Negar/Cancelar */}
      {showDenyModal && selectedOrder && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-[4px] flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/[0.10] bg-white/[0.06] backdrop-blur-[20px] shadow-[0_20px_60px_rgba(0,0,0,0.6),0_0_40px_rgba(245,166,35,0.08)] p-6 space-y-4">
            <h3 className="text-lg font-bold text-white">{selectedOrder.status === 'awaiting_approval' ? 'Negar' : 'Cancelar'} pedido {selectedOrder.order_number}</h3>
            <div className="space-y-1 text-sm text-[#C9BCAC]">
              <p>Cliente: {selectedOrder.customer_name}</p>
              <p>Telefone: {selectedOrder.customer_phone}</p>
              <p>Total: {money(selectedOrder.total_cents)}</p>
            </div>
            <textarea value={denyReason} onChange={(e) => setDenyReason(e.target.value)} rows={4} placeholder="Motivo da recusa…"
              className="w-full rounded-xl bg-black/30 border border-white/[0.08] text-sm text-white placeholder-[#8A7A69] p-3 focus:outline-none focus:border-[#F5A623]/50 transition-colors" />
            <div className="flex gap-3">
              <button onClick={() => { setShowDenyModal(false); setSelectedOrder(null); setDenyReason(''); }} className="flex-1 px-4 py-2.5 bg-white/[0.06] hover:bg-white/[0.10] text-[#C9BCAC] rounded-xl transition-all">Voltar</button>
              <button onClick={handleDeny} disabled={!denyReason.trim()} className="flex-1 px-4 py-2.5 bg-[#F5A623] hover:bg-[#D6860F] text-[#2A1710] font-semibold rounded-xl transition-all disabled:opacity-50">Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {message && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-2xl border backdrop-blur-[16px] px-5 py-3 font-medium text-sm shadow-[0_4px_24px_rgba(0,0,0,0.4)] ${
          message.type === 'success' ? 'border-[#22C55E]/30 bg-[#22C55E]/10 text-[#22C55E]' : 'border-[#F5A623]/30 bg-[#F5A623]/10 text-[#F5A623]'
        }`}>
          <div className="flex items-center gap-3">
            <span>{message.text}</span>
            <button className="opacity-60 hover:opacity-100" onClick={() => setMessage(null)}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Componentes auxiliares ───────────────────────────────────────────────────

function Delta({ pct, goodUp }: { pct: number | null; goodUp: boolean }) {
  if (pct == null) return <span className="text-xs font-medium text-[#8A7A69]">sem dados de ontem</span>;
  const up = pct >= 0;
  const isGood = pct === 0 ? null : up === goodUp;
  const color = isGood == null ? 'text-[#8A7A69]' : isGood ? 'text-[#22C55E]' : 'text-[#EF4444]';
  const arrow = pct === 0 ? '•' : up ? '▲' : '▼';
  return <span className={`text-xs font-medium ${color}`}>{arrow} {Math.abs(pct)}% vs ontem</span>;
}

function KpiCard({ label, value, delta, action, accentBorder }: { label: string; value: string; delta?: React.ReactNode; action?: React.ReactNode; accentBorder: string }) {
  return (
    <div className={`${GLASS} border-t-2 ${accentBorder} p-4 flex flex-col gap-1 hover:bg-white/[0.07] hover:border-white/[0.12] transition-all`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-[#8A7A69] font-medium">{label}</span>
        {action}
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {delta}
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  return type === 'delivery'
    ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 bg-orange-500/10 text-orange-400">🛵 Entrega</span>
    : <span className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 bg-blue-500/10 text-blue-400">🏃 Levantamento</span>;
}

function PayBadge({ method }: { method: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    mpesa: { label: 'M-Pesa', cls: 'bg-[#00BF63]/10 text-[#00BF63]' },
    emola: { label: 'e-Mola', cls: 'bg-purple-500/10 text-purple-400' },
    credit_card: { label: 'Cartão', cls: 'bg-blue-500/10 text-blue-400' },
    cash: { label: 'Dinheiro', cls: 'bg-amber-500/10 text-amber-400' },
  };
  const m = map[method];
  if (!m) return null;
  return <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${m.cls}`}>{m.label}</span>;
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1);
  const btn = 'min-w-[32px] h-8 px-2 grid place-items-center rounded-xl border text-sm transition-all';
  return (
    <div className="flex items-center gap-1.5">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)} className={`${btn} border-white/[0.08] text-[#C9BCAC] hover:bg-white/[0.06] disabled:opacity-40`}>‹</button>
      {pages.map((p, i) => (
        <Fragment key={p}>
          {i > 0 && p - pages[i - 1] > 1 && <span className="text-[#8A7A69] px-0.5">…</span>}
          <button onClick={() => onChange(p)} className={`${btn} ${p === page ? 'bg-[#F5A623] text-[#2A1710] border-transparent' : 'border-white/[0.08] text-[#C9BCAC] hover:bg-white/[0.06]'}`}>{p}</button>
        </Fragment>
      ))}
      <button disabled={page >= totalPages} onClick={() => onChange(page + 1)} className={`${btn} border-white/[0.08] text-[#C9BCAC] hover:bg-white/[0.06] disabled:opacity-40`}>›</button>
    </div>
  );
}

// Detalhe expandido — 3 colunas: itens / entrega / pagamento + comprovativo + ações
function OrderDetail({ order, proofUrl, actions }: { order: Order; proofUrl: string | undefined; actions: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Itens */}
      <div>
        <div className="text-[11px] font-medium text-[#8A7A69] uppercase tracking-wide mb-2">Itens</div>
        <div className="space-y-1 text-sm">
          {order.items.map((item) => (
            <div key={item.id} className="flex justify-between text-white">
              <span>{item.qty}× {item.name}{item.notes && <span className="text-[#8A7A69] italic"> — {item.notes}</span>}</span>
              <span>{money(item.unit_price_cents * item.qty)}</span>
            </div>
          ))}
        </div>
        {order.notes && <p className="mt-3 text-sm text-[#C9BCAC]"><span className="text-white font-medium">Obs: </span>{order.notes}</p>}
      </div>

      {/* Entrega / Levantamento */}
      <div className="text-sm text-[#C9BCAC] space-y-1">
        <div className="text-[11px] font-medium text-[#8A7A69] uppercase tracking-wide mb-2">{order.fulfillment_type === 'delivery' ? 'Entrega' : 'Levantamento'}</div>
        <p><span className="text-white font-medium">Tipo: </span>{order.fulfillment_type === 'delivery' ? 'Entrega ao domicílio' : 'Levantamento no balcão'}</p>
        {order.fulfillment_type === 'delivery' && order.address && <p><span className="text-white font-medium">Morada: </span>{order.address}</p>}
        <p><span className="text-white font-medium">Horário: </span>{order.scheduled_for ? format(parseISO(order.scheduled_for), "dd/MM 'às' HH:mm", { locale: pt }) : 'Agora'}</p>
        <p><span className="text-white font-medium">Pagamento: </span>{order.payment_method?.toUpperCase()}</p>
      </div>

      {/* Pagamento + comprovativo + ações */}
      <div className="space-y-3">
        <div className="text-sm space-y-1">
          <div className="flex justify-between text-[#C9BCAC]"><span>Subtotal</span><span>{money(order.subtotal_cents)}</span></div>
          {order.delivery_fee_cents > 0 && <div className="flex justify-between text-[#C9BCAC]"><span>Taxa de entrega</span><span>{money(order.delivery_fee_cents)}</span></div>}
          <div className="flex justify-between text-white font-bold text-lg pt-1 border-t border-white/[0.06]"><span>Total</span><span>{money(order.total_cents)}</span></div>
        </div>

        {order.payment_proof_path ? (
          proofUrl ? (
            <a href={proofUrl} target="_blank" rel="noopener noreferrer" className="block">
              <img src={proofUrl} alt={`Comprovativo ${order.order_number}`} className="rounded-xl border border-white/[0.08] max-h-48 w-auto object-contain bg-black/30" />
              <span className="text-xs text-[#F5A623] hover:underline mt-1 inline-block">Ver comprovativo em tamanho real ↗</span>
            </a>
          ) : <p className="text-sm text-[#C9BCAC]">A carregar comprovativo…</p>
        ) : <p className="text-sm text-[#8A7A69]">Sem comprovativo (pagamento na entrega ou automático).</p>}

        {actions && <div className="pt-1">{actions}</div>}
      </div>
    </div>
  );
}
