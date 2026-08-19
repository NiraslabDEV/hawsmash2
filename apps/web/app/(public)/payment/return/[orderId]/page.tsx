'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';

type PollStatus = 'polling' | 'paid' | 'failed' | 'timeout';

const POLL_INTERVAL_MS = 2500;
const TIMEOUT_MS       = 120_000; // 2 minutos — depois redireciona para order-status

export default function PaymentReturnPage() {
  const router   = useRouter();
  const params   = useParams();
  const orderId  = params.orderId as string;

  const [pollStatus, setPollStatus] = useState<PollStatus>('polling');
  const startedAt = useRef(Date.now());

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

  const Wrap = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen bg-[var(--st-bg)] flex items-center justify-center p-4">
      <div className="text-center max-w-sm w-full">{children}</div>
    </div>
  );

  if (pollStatus === 'paid') {
    return (
      <Wrap>
        <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-[var(--st-text)] mb-2">Pagamento Confirmado!</h1>
        <p className="text-[var(--st-muted)]">A redirecionar para o estado do seu pedido…</p>
      </Wrap>
    );
  }

  if (pollStatus === 'failed') {
    return (
      <Wrap>
        <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-[var(--st-text)] mb-2">Pagamento Não Processado</h1>
        <p className="text-[var(--st-muted)] mb-6">O pagamento não foi concluído. Pode tentar novamente.</p>
        <button onClick={() => { localStorage.removeItem('pending_order_id'); router.push('/checkout'); }} className="w-full text-[var(--st-text)] font-bold py-4 px-4 rounded-2xl" style={{ background: 'var(--st-grad)' }}>
          Tentar Novamente
        </button>
        <button onClick={() => router.push('/menu')} className="w-full mt-3 py-4 px-4 rounded-2xl font-semibold" style={{ border: '1px solid var(--st-line)', color: 'var(--st-muted-2)' }}>
          Voltar ao cardápio
        </button>
      </Wrap>
    );
  }

  if (pollStatus === 'timeout') {
    return (
      <Wrap>
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[var(--st-primary)] mx-auto mb-6"></div>
        <h1 className="text-xl font-bold text-[var(--st-text)] mb-2">A verificar pagamento…</h1>
        <p className="text-[var(--st-muted)]">A redirecionar para o estado do pedido.</p>
      </Wrap>
    );
  }

  // polling (default)
  return (
    <Wrap>
      <div className="relative w-20 h-20 mx-auto mb-6">
        <div className="absolute inset-0 rounded-full border-4 border-[var(--st-line)]"></div>
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-[var(--st-primary)] animate-spin"></div>
        <div className="absolute inset-0 flex items-center justify-center">
          <svg className="w-8 h-8 text-[var(--st-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        </div>
      </div>
      <h1 className="text-2xl font-bold text-[var(--st-text)] mb-2">A processar pagamento</h1>
      <p className="text-[var(--st-muted)] mb-2">Por favor aguarde…</p>
      <p className="text-[var(--st-muted)] text-sm">Não feche esta página</p>
    </Wrap>
  );
}
