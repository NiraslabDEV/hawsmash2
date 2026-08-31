'use client';

/**
 * Volta do gateway — o ecrã onde o cliente espera pela confirmação do M-Pesa.
 *
 * Duas coisas que este ecrã tinha de ganhar:
 *
 * 1. **Dizer o que o cliente tem de fazer.** "A processar… não feche a página"
 *    é passivo, e o cliente ainda tem de marcar o PIN no telemóvel. Um ecrã
 *    passivo num momento de acção é o que gera o telefonema.
 * 2. **Ter saída.** Ao fim de 45 s aparece "está a demorar" com retry e
 *    contacto da loja; no `failed` há sempre para onde ir. Sem isto, o cliente
 *    fecha o separador e o pedido fica em `awaiting_payment` para sempre.
 *
 * A faixa comercial deste passo não tem link para fora de propósito: abrir
 * outra app a meio da verificação mata o polling.
 *
 * A lógica de polling não mudou — mesma verificação activa, mesmo timeout.
 */

import { useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { brand } from '@brand';

import '../../../_hawsmash/landing.css';
import '../../../_hawsmash/funnel.css';
import { FunnelRail, FunnelFoot, IcoCheck, IcoAlert, IcoRefresh, IcoWhats, IcoUpload } from '../../../_hawsmash/funnel';

type PollStatus = 'polling' | 'paid' | 'failed' | 'timeout';

const POLL_INTERVAL_MS = 2500;
const TIMEOUT_MS       = 120_000; // 2 minutos — depois redireciona para order-status
const SLOW_AFTER_MS    = 45_000;  // a partir daqui mostra-se a saída de emergência

const L = brand.storefront.landing;

export default function PaymentReturnPage() {
  const router   = useRouter();
  const params   = useParams();
  const orderId  = params.orderId as string;

  const [pollStatus, setPollStatus] = useState<PollStatus>('polling');
  const [slow, setSlow] = useState(false);
  const startedAt = useRef(Date.now());

  // Passados 45 s sem resposta, o ecrã deixa de pedir paciência e passa a dar
  // alternativas. Não interrompe o polling — só destapa a saída.
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!orderId) return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;

      try {
        // Verificação ATIVA: pergunta o estado ao Paysuite e confirma se pago.
        // Não depende do webhook (que pode falhar/estar mal configurado).
        const res = await fetch('/api/payments/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId }),
        });
        const data = await res.json().catch(() => ({}));
        const status: string = data?.status ?? 'pending';

        if (status === 'paid') {
          if (!cancelled) {
            localStorage.removeItem('cart');
            localStorage.removeItem('pending_order_id');
            setPollStatus('paid');
            setTimeout(() => {
              if (!cancelled) router.replace(`/order-status/${orderId}`);
            }, 1500);
          }
          return;
        }

        if (status === 'failed') {
          if (!cancelled) setPollStatus('failed');
          return;
        }

        // Timeout → ir para order-status de qualquer maneira
        if (Date.now() - startedAt.current > TIMEOUT_MS) {
          if (!cancelled) {
            setPollStatus('timeout');
            setTimeout(() => {
              if (!cancelled) router.replace(`/order-status/${orderId}`);
            }, 2000);
          }
          return;
        }

        // Continuar a verificar
        setTimeout(poll, POLL_INTERVAL_MS);
      } catch {
        if (!cancelled) setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    poll();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const Frame = ({ children, failed = false }: { children: React.ReactNode; failed?: boolean }) => (
    <div className="hs hf" style={{ minHeight: '100vh' }}>
      <div className="hf-page" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <FunnelRail step={2} failed={failed} />
        {children}
        <FunnelFoot />
      </div>
    </div>
  );

  if (pollStatus === 'paid') {
    return (
      <Frame>
        <section className="hf-hero hf-hero-glow-c" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center' }}>
          <div
            className="hf-ok"
            style={{ width: 70, height: 70, margin: '0 auto', borderRadius: '50%', display: 'grid', placeItems: 'center', border: '1.5px solid color-mix(in srgb, var(--hs-ok) 50%, transparent)', background: 'color-mix(in srgb, var(--hs-ok) 9%, transparent)' }}
          >
            <IcoCheck size={30} />
          </div>
          <p className="hf-eyebrow is-centered" style={{ marginTop: 22, justifyContent: 'center' }}>Pagamento confirmado</p>
          <h1 className="hf-display is-sm" style={{ marginTop: 14 }}>
            Está<br /><span className="hf-flame">pago.</span>
          </h1>
          <p className="hf-lead is-centered">A abrir o teu pedido…</p>
        </section>
      </Frame>
    );
  }

  if (pollStatus === 'failed') {
    return (
      <Frame failed>
        <section className="hf-hero" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ textAlign: 'center' }}>
            <div
              className="hf-warn"
              style={{ width: 70, height: 70, margin: '0 auto', borderRadius: '50%', display: 'grid', placeItems: 'center', border: '1.5px solid color-mix(in srgb, var(--hs-ember) 50%, transparent)', background: 'color-mix(in srgb, var(--hs-ember) 9%, transparent)' }}
            >
              <IcoAlert size={30} />
            </div>
            <p className="hf-eyebrow is-centered hf-warn" style={{ marginTop: 22, justifyContent: 'center', color: 'var(--hs-ember)' }}>
              Pagamento não concluído
            </p>
            <h1 className="hf-display is-sm" style={{ marginTop: 14 }}>O pagamento<br />não passou.</h1>
            <p className="hf-lead is-centered">
              Não foi cobrado nada. O teu pedido fica guardado — é só escolher como queres pagar.
            </p>
          </div>

          <div style={{ marginTop: 'auto', paddingTop: 24, display: 'flex', flexDirection: 'column', gap: 11 }}>
            <button
              type="button"
              onClick={() => { localStorage.removeItem('pending_order_id'); router.push('/checkout'); }}
              className="hf-btn hf-btn-gold"
            >
              <IcoRefresh />
              Tentar outra vez
            </button>
            <Link href={`/order-status/${orderId}`} className="hf-btn hf-btn-ghost">
              <IcoUpload size={18} />
              Pagar por comprovativo
            </Link>
            <Link href="/menu" className="hf-btn hf-btn-quiet">Voltar ao cardápio</Link>
          </div>
        </section>
      </Frame>
    );
  }

  // polling e timeout partilham o mesmo ecrã — o que muda é a linha de baixo.
  return (
    <Frame>
      <section className="hf-hero hf-hero-glow-c" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ position: 'relative', width: 140, height: 140, margin: '0 auto', display: 'grid', placeItems: 'center' }}>
          <svg className="hf-spin" viewBox="0 0 140 140" width={140} height={140} style={{ position: 'absolute', inset: 0 }} aria-hidden>
            <circle cx="70" cy="70" r="67" fill="none" stroke="var(--hs-line)" strokeWidth="2" />
            <circle cx="70" cy="70" r="67" fill="none" stroke="var(--hs-gold)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="72 349" />
          </svg>
          <Image
            src={L.logoCircle}
            alt={brand.storefront.logoText}
            width={110}
            height={110}
            style={{ width: 110, height: 110, borderRadius: '50%', objectFit: 'cover' }}
            priority
          />
        </div>

        <p className="hf-eyebrow is-centered" style={{ marginTop: 24, justifyContent: 'center' }}>A ouvir o pagamento</p>
        <h1 className="hf-display is-sm" style={{ marginTop: 14 }}>
          Confirma no<br />telemóvel.
        </h1>
        <p className="hf-lead is-centered">
          {pollStatus === 'timeout'
            ? 'Vamos abrir o teu pedido — o estado aparece lá assim que confirmarmos.'
            : 'Vai aparecer um pedido de pagamento. Marca o teu PIN e volta aqui — a página trata do resto.'}
        </p>

        {slow && pollStatus === 'polling' && (
          <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,.07)' }}>
            <p style={{ margin: '0 0 12px', fontSize: 11, color: 'var(--hs-ink-faint)' }}>Não apareceu nada no telemóvel?</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <button type="button" onClick={() => router.push('/checkout')} className="hf-btn hf-btn-ghost">
                <IcoRefresh />
                Tentar outra vez
              </button>
              {brand.storefront.contact.phone && (
                <a
                  className="hf-btn hf-btn-quiet"
                  href={`https://wa.me/${brand.storefront.contact.phone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <IcoWhats size={16} />
                  Falar com a loja
                </a>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Espaço B — sem link para fora: sair daqui mata a verificação. */}
      {brand.storefront.funnel.waiting && (
        <aside className="hf-ad">
          <div className="hf-ad-kick">Enquanto esperas</div>
          <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.4, color: 'var(--hs-ink-dim)' }}>
            {brand.storefront.funnel.waiting}
          </p>
        </aside>
      )}
    </Frame>
  );
}
