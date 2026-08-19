'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { formatMT, type Cents } from '@delivery/core';
import { trackPurchase, type TrackItem } from '@/lib/analytics/track';
import { shouldFirePurchase, markPurchaseFired } from '@/lib/analytics/purchase-guard';

const CARD = 'rounded-2xl p-4 bg-[var(--st-card)] border border-[var(--st-line)]';

export default function OrderStatusPage({ params }: { params: { orderId: string } }) {
  const router = useRouter();
  const [polling, setPolling] = useState(true);

  const { data: orderStatus, isLoading, error } = useQuery({
    queryKey: ['order-status', params.orderId],
    queryFn: async () => {
      const response = await fetch(`/api/order-status/${params.orderId}`);
      if (!response.ok) throw new Error('Failed to fetch order status');
      return response.json();
    },
    enabled: !!params.orderId,
    refetchInterval: polling ? 5000 : false, // Poll every 5 seconds
  });

  useEffect(() => {
    if (orderStatus?.status === 'delivered' || orderStatus?.status === 'cancelled') {
      setPolling(false);
    }
  }, [orderStatus?.status]);

  // purchase — REGRA CRÍTICA (16.1): só em paid/approved, com guard duplo
  // (useRef in-memory + localStorage) para nunca re-disparar em reload/polling.
  const purchaseFiredRef = useRef(false);
  useEffect(() => {
    if (purchaseFiredRef.current || typeof window === 'undefined' || !orderStatus) return;
    if (!shouldFirePurchase(orderStatus.status, params.orderId, window.localStorage)) return;

    purchaseFiredRef.current = true;
    markPurchaseFired(params.orderId, window.localStorage);

    const items: TrackItem[] = (orderStatus.order_items ?? []).map((oi: any) => ({
      id: oi.menu_item_id,
      name: oi.name_snapshot,
      price_cents: oi.unit_price_cents,
      qty: oi.qty,
    }));

    trackPurchase({ orderId: params.orderId, totalCents: orderStatus.total_cents, items });
  }, [orderStatus, params.orderId]);

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      awaiting_approval: 'text-yellow-400',
      approved: 'text-green-400',
      awaiting_payment: 'text-yellow-400',
      paid: 'text-green-400',
      payment_failed: 'text-red-400',
      in_preparation: 'text-blue-400',
      ready: 'text-purple-400',
      delivered: 'text-green-400',
      cancelled: 'text-red-400',
    };
    return colors[status] || 'text-gray-400';
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      awaiting_approval: 'Aguardando Aprovação',
      approved: 'Aprovado',
      awaiting_payment: 'Aguardando Pagamento',
      paid: 'Pagamento Confirmado',
      payment_failed: 'Pagamento Falhou',
      in_preparation: 'Em Preparação',
      ready: 'Pronto',
      delivered: 'Entregue',
      cancelled: 'Cancelado',
    };
    return labels[status] || status;
  };

  const getFlowLabel = (flow: string) => ({ manual: 'Manual', digital: 'Digital' }[flow] || flow);

  // repõe o carrinho a partir dos itens do pedido e volta ao cardápio
  const reorder = () => {
    const items = (orderStatus?.order_items ?? []).map((oi: any) => ({ menuItemId: oi.menu_item_id, qty: oi.qty }));
    if (items.length) localStorage.setItem('cart', JSON.stringify(items));
    router.push('/menu');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--st-bg)]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--st-primary)] mx-auto mb-4"></div>
          <p className="text-[var(--st-muted)]">A carregar status do pedido…</p>
        </div>
      </div>
    );
  }

  if (error || !orderStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--st-bg)]">
        <div className="text-center">
          <p className="mb-3" style={{ color: error ? 'var(--st-primary)' : 'var(--st-muted)' }}>
            {error ? 'Erro ao carregar status do pedido' : 'Pedido não encontrado'}
          </p>
          <button onClick={() => router.push('/menu')} className="underline" style={{ color: 'var(--st-primary)' }}>Voltar ao cardápio</button>
        </div>
      </div>
    );
  }

  const isTerminal = ['delivered', 'cancelled'].includes(orderStatus.status);
  const isCancelled = orderStatus.status === 'cancelled';

  return (
    <div className="min-h-screen bg-[var(--st-bg)]">
      <div className="max-w-[480px] mx-auto pb-8">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-[var(--st-bg)]/95 backdrop-blur border-b border-[var(--st-line)]">
          <div className="px-4 py-4 flex items-center gap-3">
            <button onClick={() => router.push('/menu')} className="text-2xl text-[var(--st-text)] leading-none" aria-label="Voltar">←</button>
            <h1 className="text-xl font-extrabold text-[var(--st-text)]">Status do Pedido</h1>
          </div>
        </header>

        <div className="px-4 mt-4 space-y-4">
          {/* Pedido + estado */}
          <div className={CARD}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[var(--st-muted)] text-sm mb-1">Pedido</p>
                <p className="text-[var(--st-text)] font-extrabold text-xl">{orderStatus.order_number}</p>
                {orderStatus.store?.short_name && (
                  <p className="text-[var(--st-muted-2)] text-xs mt-1">
                    Loja {orderStatus.store.short_name}
                    {orderStatus.store.phone ? ` · ${orderStatus.store.phone}` : ''}
                  </p>
                )}
              </div>
              <span className={`inline-flex items-center gap-1.5 text-sm font-bold ${getStatusColor(orderStatus.status)}`}>
                <span className={`w-2 h-2 rounded-full bg-current ${!isTerminal ? 'animate-pulse' : ''}`} />
                {getStatusLabel(orderStatus.status)}
              </span>
            </div>

            {/* Tracker */}
            {!isCancelled && (
              <div className="mt-6">
                <Tracker status={orderStatus.status} fulfillment={orderStatus.fulfillment_type} />
              </div>
            )}
          </div>

          {/* Cancelado */}
          {isCancelled && (
            <div className="rounded-2xl p-4" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
              <p className="text-red-400 text-sm text-center">Pedido cancelado. Contacte o restaurante para mais informações.</p>
            </div>
          )}

          {/* Aguarda aprovação */}
          {orderStatus.status === 'awaiting_approval' && (
            <div className="rounded-2xl p-4" style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)' }}>
              <p className="text-yellow-400 text-sm text-center">Pedido criado! Aguarde a aprovação do restaurante.</p>
            </div>
          )}

          {/* Detalhes */}
          <div className={CARD}>
            <h2 className="text-[var(--st-text)] font-bold mb-4">Detalhes</h2>
            <div className="space-y-3 text-sm">
              <Row label="Tipo">{orderStatus.fulfillment_type === 'delivery' ? 'Entrega' : 'Levantamento'}</Row>
              <Row label="Pagamento">{getFlowLabel(orderStatus.flow)} · {orderStatus.payment_method?.toUpperCase()}</Row>
              {orderStatus.scheduled_for && (
                <Row label="Agendado para">{new Date(orderStatus.scheduled_for).toLocaleString('pt-MZ', { dateStyle: 'short', timeStyle: 'short' })}</Row>
              )}
              <Row label="Criado">{new Date(orderStatus.created_at).toLocaleString('pt-MZ', { dateStyle: 'short', timeStyle: 'short' })}</Row>
              <div className="flex justify-between pt-2 border-t border-[var(--st-line)]">
                <span className="text-[var(--st-muted)]">Total</span>
                <span className="text-[var(--st-text)] font-extrabold text-base">{formatMT(orderStatus.total_cents as Cents)}</span>
              </div>
            </div>
          </div>

          {/* Atualização */}
          {!isTerminal && (
            <button
              onClick={() => setPolling(!polling)}
              className="w-full rounded-2xl py-3.5 px-4 font-semibold transition-colors"
              style={{ background: 'var(--st-card)', border: '1px solid var(--st-line)', color: 'var(--st-muted-2)' }}
            >
              {polling ? '⏸ Pausar atualização automática' : '▶ Retomar atualização'}
            </button>
          )}

          {/* Terminal: feedback + ações */}
          {isTerminal && (
            <>
              {orderStatus.status === 'delivered' && !orderStatus.feedback_submitted && (
                <div className={CARD}>
                  <h2 className="text-[var(--st-text)] font-bold mb-3">Como foi a sua experiência?</h2>
                  <FeedbackForm orderId={params.orderId} />
                </div>
              )}
              <button onClick={reorder} className="w-full text-[var(--st-text)] font-extrabold py-4 px-4 rounded-2xl" style={{ background: 'var(--st-grad)' }}>
                ↻ Pedir novamente
              </button>
              <button onClick={() => router.push('/menu')} className="w-full rounded-2xl py-3.5 px-4 font-semibold" style={{ background: 'var(--st-card)', border: '1px solid var(--st-line)', color: 'var(--st-muted-2)' }}>
                Voltar ao cardápio
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--st-muted)]">{label}</span>
      <span className="text-[var(--st-text)] text-right">{children}</span>
    </div>
  );
}

// Tracker horizontal: Recebido → Em preparo → Pronto/A caminho → Entregue
function Tracker({ status, fulfillment }: { status: string; fulfillment: string }) {
  const nodes = ['Recebido', 'Em preparo', fulfillment === 'delivery' ? 'A caminho' : 'Pronto', 'Entregue'];
  const stepOf = (s: string) => {
    if (['approved', 'paid', 'in_preparation'].includes(s)) return 1;
    if (s === 'ready') return 2;
    if (s === 'delivered') return 3;
    return 0; // awaiting_* / payment_failed
  };
  const active = stepOf(status);

  return (
    <div className="flex items-start">
      {nodes.map((label, i) => {
        const done = i < active;
        const isActive = i === active;
        const reached = done || isActive;
        return (
          <div key={i} className="flex-1 flex flex-col items-center relative">
            {i > 0 && (
              <div
                className="absolute top-[10px] right-1/2 w-full h-[2px]"
                style={{ background: i <= active ? 'var(--st-primary)' : 'rgba(42,23,16,.12)' }}
              />
            )}
            <div
              className="w-[22px] h-[22px] rounded-full grid place-items-center text-[10px] font-extrabold text-[var(--st-text)] relative z-[1] mb-1.5"
              style={{ background: reached ? 'var(--st-primary)' : 'transparent', border: `2px solid ${reached ? 'var(--st-primary)' : 'rgba(42,23,16,.2)'}` }}
            >
              {done ? '✓' : isActive ? '•' : ''}
            </div>
            <span
              className="text-[9.5px] text-center leading-tight"
              style={{ color: isActive ? 'var(--st-text)' : done ? 'var(--st-muted)' : 'rgba(42,23,16,.35)', fontWeight: isActive ? 800 : 400 }}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Feedback (reskin The Box)
function FeedbackForm({ orderId }: { orderId: string }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) { setError('Por favor, selecione uma classificação'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, rating, comment }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Erro ao enviar feedback');
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar feedback');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="text-center py-4">
        <p className="text-lg font-semibold" style={{ color: 'var(--st-primary)' }}>Obrigado pelo seu feedback!</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex justify-center gap-2">
        {[1, 2, 3, 4, 5].map((star) => (
          <button key={star} type="button" onClick={() => setRating(star)} className="text-3xl transition-colors" style={{ color: star <= rating ? 'var(--st-star)' : 'rgba(42,23,16,.25)' }}>
            {star <= rating ? '★' : '☆'}
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Comentário opcional…"
        className="w-full rounded-xl p-3 text-[var(--st-text)] placeholder:text-[var(--st-muted)] focus:outline-none focus:border-[var(--st-primary)] border border-[var(--st-line)] bg-[var(--st-bg)]"
        rows={3}
      />
      {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      <button type="submit" disabled={submitting || rating === 0} className="w-full text-[var(--st-text)] font-bold py-3 px-4 rounded-2xl disabled:opacity-50" style={{ background: 'var(--st-grad)' }}>
        {submitting ? 'A enviar…' : 'Enviar Feedback'}
      </button>
    </form>
  );
}
