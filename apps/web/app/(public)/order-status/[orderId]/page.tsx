'use client';

/**
 * Pedido recebido — o ecrã que o cliente vê depois de pagar.
 *
 * O que ele precisa vem primeiro e por esta ordem: a SENHA por que vai ser
 * chamado, o estado ao vivo, e como falar com a loja. Só depois é que entram
 * os blocos comerciais (§ espaços C e D) e, no fim de tudo, a assinatura de
 * quem fez o sistema. Um cliente que não encontra o contacto da loja liga
 * para o número que encontrar — e nessa altura já não interessa o desenho.
 *
 * A lógica não mudou: mesmo polling, mesmo guard duplo do `purchase`, mesmo
 * `reorder`. Só a pele.
 */

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { formatMT, type Cents } from '@delivery/core';
import { brand } from '@brand';
import { trackPurchase, type TrackItem } from '@/lib/analytics/track';
import { shouldFirePurchase, markPurchaseFired } from '@/lib/analytics/purchase-guard';
import { useAccount } from '@/utils/useAccount';

import '../../_hawsmash/landing.css';
import '../../_hawsmash/funnel.css';
import {
  FunnelRail,
  FunnelFoot,
  SectionHead,
  PoweredBy,
  IcoCheck,
  IcoWhats,
  IcoPin,
  IcoRefresh,
  IcoArrow,
  IcoStar,
  IcoCopy,
} from '../../_hawsmash/funnel';

const L = brand.storefront.landing;
const PROMOS = brand.storefront.funnel.promos;

/** Estados terminais e a leitura de cada um em voz de marca. */
const LABEL: Record<string, string> = {
  awaiting_approval: 'Aguarda aprovação',
  approved: 'Aprovado',
  awaiting_payment: 'Aguarda pagamento',
  paid: 'Pagamento confirmado',
  payment_failed: 'Pagamento falhou',
  in_preparation: 'Na chapa',
  ready: 'Pronto',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
};

/** Título de capa por estado — o "Já estás na chapa" só vale quando é verdade. */
function heroCopy(status: string, fulfillment: string): { kicker: string; lead: string; tail: string } {
  if (status === 'cancelled') return { kicker: 'Pedido cancelado', lead: 'Este pedido', tail: 'parou.' };
  if (status === 'delivered') {
    return fulfillment === 'delivery'
      ? { kicker: 'Entregue', lead: 'Bom', tail: 'apetite.' }
      : { kicker: 'Levantado', lead: 'Bom', tail: 'apetite.' };
  }
  if (status === 'ready') {
    return fulfillment === 'delivery'
      ? { kicker: 'A caminho', lead: 'Já vai', tail: 'a sair.' }
      : { kicker: 'Pronto', lead: 'Podes', tail: 'levantar.' };
  }
  if (status === 'awaiting_approval') return { kicker: 'Pedido recebido', lead: 'Já', tail: 'chegou.' };
  if (status === 'awaiting_payment') return { kicker: 'Falta pagar', lead: 'Quase', tail: 'lá.' };
  return { kicker: 'Pedido confirmado', lead: 'Já estás', tail: 'na chapa.' };
}

export default function OrderStatusPage({ params }: { params: { orderId: string } }) {
  const router = useRouter();
  const [polling, setPolling] = useState(true);
  const { profile, hydrated: accountReady, bind } = useAccount();

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

  // É AQUI que o cliente fica com conta, sem nunca ter feito login: acabou de
  // pagar, e quem tem o UUID deste pedido é quem o fez. O servidor prende o
  // dispositivo e guarda a morada da entrega. Da próxima, o checkout já o
  // conhece e ele não escreve nome nem morada nenhuma.
  //
  // Uma vez por dispositivo, e só depois de o pedido estar pago ou aprovado —
  // um pedido que ainda não passou não prova nada.
  const boundRef = useRef(false);
  useEffect(() => {
    if (boundRef.current || !accountReady || profile || !orderStatus) return;
    const settled = ['paid', 'approved', 'in_preparation', 'ready', 'delivered'].includes(orderStatus.status);
    if (!settled) return;
    boundRef.current = true;
    // Best-effort: se falhar, o cliente vê o pedido na mesma. Só não fica logado.
    void bind(params.orderId);
  }, [accountReady, profile, orderStatus, bind, params.orderId]);

  // repõe o carrinho a partir dos itens do pedido e volta ao cardápio
  const reorder = () => {
    const items = (orderStatus?.order_items ?? []).map((oi: any) => ({ menuItemId: oi.menu_item_id, qty: oi.qty }));
    if (items.length) localStorage.setItem('cart', JSON.stringify(items));
    router.push('/menu');
  };

  if (isLoading) {
    return (
      <div className="hs hf" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
        <div style={{ textAlign: 'center' }}>
          <div className="hf-spin" style={{ width: 32, height: 32, margin: '0 auto 16px', borderRadius: '50%', border: '2px solid var(--hs-line)', borderTopColor: 'var(--hs-gold)' }} />
          <p style={{ color: 'var(--hs-ink-mute)', fontSize: 14 }}>A carregar o teu pedido…</p>
        </div>
      </div>
    );
  }

  if (error || !orderStatus) {
    return (
      <div className="hs hf" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ marginBottom: 16, color: 'var(--hs-ink-soft)', fontSize: 14 }}>
            {error ? 'Não conseguimos abrir este pedido.' : 'Pedido não encontrado.'}
          </p>
          <Link href="/menu" className="hf-btn hf-btn-ghost hf-btn-sm">Voltar ao cardápio</Link>
        </div>
      </div>
    );
  }

  const status: string = orderStatus.status;
  const fulfillment: string = orderStatus.fulfillment_type;
  const isTerminal = ['delivered', 'cancelled'].includes(status);
  const isCancelled = status === 'cancelled';
  const isPaid = ['paid', 'approved', 'in_preparation', 'ready', 'delivered'].includes(status);
  const hero = heroCopy(status, fulfillment);
  const store = orderStatus.store ?? {};
  // Senha do dia (1032). Pedidos antigos não a têm — aí o nº do pedido serve.
  const senha: string | null =
    orderStatus.daily_number != null ? String(orderStatus.daily_number).padStart(3, '0') : null;

  return (
    <div className="hs hf" style={{ minHeight: '100vh' }}>
      <div className="hf-page">
        <FunnelRail
          step={isPaid ? 3 : 2}
          storeName={store.short_name}
          failed={status === 'payment_failed'}
        />

        {/* ── Capa ─────────────────────────────────────────────────────── */}
        <section className="hf-hero hf-hero-glow-c" style={{ textAlign: 'center' }}>
          <Image
            src={L.logoCircle}
            alt={brand.storefront.logoText}
            width={82}
            height={82}
            style={{ width: 82, height: 82, borderRadius: '50%', objectFit: 'cover', margin: '0 auto' }}
            priority
          />
          <p className="hf-eyebrow is-centered" style={{ marginTop: 22, justifyContent: 'center' }}>{hero.kicker}</p>
          <h1 className="hf-display" style={{ marginTop: 14 }}>
            {hero.lead}
            <br />
            <span className="hf-flame">{hero.tail}</span>
          </h1>
        </section>

        {/* ── Senha: o que o cliente precisa de ver primeiro ───────────── */}
        <section className="hf-senha">
          <div style={{ minWidth: 0 }}>
            <div className="hf-meta-k">{senha ? 'A tua senha' : 'N.º do pedido'}</div>
            <div className="hf-senha-n num">{senha ?? orderStatus.order_number}</div>
          </div>
          <dl className="hf-senha-meta">
            {senha && (
              <div>
                <dt className="hf-meta-k">N.º do pedido</dt>
                <dd className="hf-meta-v num" style={{ margin: 0 }}>{orderStatus.order_number}</dd>
              </div>
            )}
            <div>
              <dt className="hf-meta-k">{orderStatus.scheduled_for ? 'Agendado' : 'Estado'}</dt>
              <dd className="hf-meta-v num" style={{ margin: 0 }}>
                {orderStatus.scheduled_for
                  ? new Date(orderStatus.scheduled_for).toLocaleTimeString('pt-MZ', { hour: '2-digit', minute: '2-digit' })
                  : LABEL[status] ?? status}
              </dd>
            </div>
          </dl>
        </section>

        {senha && (
          <p style={{ margin: 0, padding: '14px 20px 0', fontSize: 11, lineHeight: 1.5, color: 'var(--hs-ink-mute)' }}>
            {fulfillment === 'delivery'
              ? 'Guarda esta senha. É por ela que o estafeta te encontra.'
              : 'Guarda esta senha. É por ela que te chamamos ao balcão.'}
          </p>
        )}

        {/* ── Estado ao vivo ───────────────────────────────────────────── */}
        {isCancelled ? (
          <section className="hf-sec">
            <div className="hf-panel is-warn">
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--hs-ink-soft)' }}>
                Este pedido foi cancelado. Fala com a loja se precisares de perceber porquê.
              </p>
            </div>
          </section>
        ) : (
          <section className="hf-sec">
            <SectionHead
              action={
                <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  {!isTerminal && <span className="hf-pulse" />}
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--hs-gold)' }}>
                    {LABEL[status] ?? status}
                  </span>
                </span>
              }
            >
              Ao vivo
            </SectionHead>
            <Tracker status={status} fulfillment={fulfillment} />
          </section>
        )}

        {/* ── Contacto da loja: ANTES de qualquer bloco comercial ──────── */}
        {(store.phone || store.address) && (
          <section className="hf-sec">
            <SectionHead>Precisas de nós?</SectionHead>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {store.phone && (
                <a
                  className="hf-fld"
                  href={`https://wa.me/${String(store.phone).replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ textDecoration: 'none' }}
                >
                  <span className="hf-ok" style={{ display: 'flex' }}><IcoWhats size={18} /></span>
                  <span style={{ fontSize: 14 }}>WhatsApp da loja</span>
                  <span className="num" style={{ marginLeft: 'auto', fontSize: 14, color: 'var(--hs-ink-dim)' }}>{store.phone}</span>
                </a>
              )}
              {store.address && (
                <a
                  href={store.maps_url || undefined}
                  target={store.maps_url ? '_blank' : undefined}
                  rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '2px 0', textDecoration: 'none' }}
                >
                  <span style={{ color: 'var(--hs-ink-mute)', display: 'flex', flexShrink: 0, marginTop: 2 }}><IcoPin size={18} /></span>
                  <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--hs-ink-mute)' }}>
                    {fulfillment === 'delivery' ? 'Entrega a partir de ' : 'Levantamento em '}
                    {store.address}
                  </span>
                </a>
              )}
            </div>
          </section>
        )}

        {/* ── O pedido ─────────────────────────────────────────────────── */}
        <section className="hf-sec is-raised">
          <SectionHead>O teu pedido</SectionHead>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(orderStatus.order_items ?? []).map((oi: any, i: number) => (
              <div key={i} className="hf-line">
                <span className="hf-line-q num">{oi.qty}x</span>
                <span className="hf-line-n">{oi.name_snapshot}</span>
                <span className="hf-line-p num">{formatMT((oi.unit_price_cents * oi.qty) as Cents)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--hs-line)' }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--hs-ink-mute)' }}>
              {isPaid ? 'Pago' : 'Total'}
              {orderStatus.payment_method ? ` por ${String(orderStatus.payment_method).toUpperCase()}` : ''}
            </span>
            <span className="num" style={{ fontFamily: 'var(--font-display)', fontSize: 26, letterSpacing: '-.005em', color: 'var(--hs-ink)' }}>
              {formatMT(orderStatus.total_cents as Cents)}
            </span>
          </div>
        </section>

        {/* ── Espaços C e D: só com o pedido pago, no máximo dois ──────── */}
        {isPaid && PROMOS.slice(0, 2).map((promo, i) => (
          <Promo key={i} promo={promo} />
        ))}

        {/* ── Avaliação ────────────────────────────────────────────────── */}
        {status === 'delivered' && !orderStatus.feedback_submitted && (
          <section className="hf-sec">
            <SectionHead>Como foi?</SectionHead>
            <p style={{ margin: '-6px 0 16px', fontSize: 14, color: 'var(--hs-ink-mute)' }}>
              Dois toques. Quem faz o teu burger lê isto todos os dias.
            </p>
            <FeedbackForm orderId={params.orderId} />
          </section>
        )}

        {/* ── Acções ───────────────────────────────────────────────────── */}
        <section className="hf-sec" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {!isTerminal && (
            <button type="button" onClick={() => setPolling(!polling)} className="hf-btn hf-btn-quiet">
              {polling ? 'Pausar actualização' : 'Retomar actualização'}
            </button>
          )}
          {isTerminal && (
            <button type="button" onClick={reorder} className="hf-btn hf-btn-gold">
              <IcoRefresh />
              Pedir outra vez
            </button>
          )}
          <Link href="/menu" className="hf-btn hf-btn-quiet">Voltar ao cardápio</Link>
        </section>

        {/* ── Espaço E: sempre o último bloco ──────────────────────────── */}
        <PoweredBy />
        <FunnelFoot rights />
      </div>
    </div>
  );
}

/* ── Bloco comercial (espaços C e D) ──────────────────────────────────── */

function Promo({ promo }: { promo: (typeof PROMOS)[number] }) {
  const body = (
    <>
      <div className="hf-ad-kick">{promo.kicker}</div>
      <h2 className="hf-ad-big">{promo.title}</h2>
      <p style={{ margin: '12px 0 0', fontSize: 14, lineHeight: 1.5, color: 'var(--hs-ink-mute)', maxWidth: 250, textWrap: 'pretty' }}>
        {promo.body}
      </p>
      {promo.code && (
        <>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(promo.code)}
            className="hf-coupon num"
            style={{ marginTop: 16 }}
            aria-label={`Copiar codigo ${promo.code}`}
          >
            {promo.code}
            <IcoCopy size={15} />
          </button>
          {promo.note && <p className="num" style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--hs-ink-faint)' }}>{promo.note}</p>}
        </>
      )}
      {promo.cta && promo.href && (
        <span className="hf-btn hf-btn-ghost hf-btn-sm" style={{ marginTop: 16, display: 'inline-flex' }}>
          {promo.cta}
          <IcoArrow size={15} />
        </span>
      )}
    </>
  );

  return (
    <section className="hf-ad">
      {promo.href && !promo.code ? (
        <Link href={promo.href} style={{ display: 'block' }}>{body}</Link>
      ) : (
        body
      )}
    </section>
  );
}

/* ── Tracker: Recebido → Na chapa → A caminho/Pronto → Entregue ───────── */

function Tracker({ status, fulfillment }: { status: string; fulfillment: string }) {
  const nodes = ['Recebido', 'Na chapa', fulfillment === 'delivery' ? 'A caminho' : 'Pronto', 'Entregue'];
  const stepOf = (s: string) => {
    if (['approved', 'paid', 'in_preparation'].includes(s)) return 1;
    if (s === 'ready') return 2;
    if (s === 'delivered') return 3;
    return 0; // awaiting_* / payment_failed
  };
  const active = stepOf(status);

  return (
    <ol className="hf-track">
      {nodes.map((label, i) => {
        const done = i < active;
        const now = i === active;
        return (
          <li key={label} className={`hf-node${done ? ' is-done' : ''}${now ? ' is-now' : ''}`}>
            <span className="hf-node-rail">
              <span className="hf-node-dot">
                {done ? <IcoCheck size={13} /> : now ? <span className="hf-pulse" /> : null}
              </span>
            </span>
            <span className="hf-node-l">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/* ── Avaliação ────────────────────────────────────────────────────────── */

function FeedbackForm({ orderId }: { orderId: string }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rating === 0) { setError('Escolhe quantas estrelas.'); return; }
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
      <div className="hf-panel is-ok" style={{ textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--hs-ink)' }}>Obrigado. Chega hoje mesmo à equipa.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => setRating(star)}
            aria-label={`${star} estrelas`}
            aria-pressed={star <= rating}
            style={{
              height: 56,
              borderRadius: 6,
              display: 'grid',
              placeItems: 'center',
              color: 'var(--hs-gold)',
              border: `1px solid ${star <= rating ? 'color-mix(in srgb, var(--hs-gold) 45%, transparent)' : 'rgba(255,255,255,.1)'}`,
              background: star <= rating ? 'color-mix(in srgb, var(--hs-gold) 8%, transparent)' : 'var(--st-bg)',
            }}
          >
            <IcoStar filled={star <= rating} />
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Conta-nos o que correu bem — ou o que não correu."
        className="hf-fld"
        style={{ marginTop: 14 }}
        rows={3}
      />
      {error && <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--hs-ember)' }}>{error}</p>}
      <button type="submit" disabled={submitting || rating === 0} className="hf-btn hf-btn-ghost" style={{ marginTop: 12 }}>
        {submitting ? 'A enviar…' : 'Enviar avaliação'}
      </button>
    </form>
  );
}
