'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';
import { decodeAgentHandoff } from '@/lib/agents/handoff';
import { agentOrderSchema, type AgentOrderInput } from '@/lib/agents/schemas';
import { callPublicAgentTool, saveReviewedAgentCart } from '@/lib/agents/webmcp';
import { cartHasItems } from '@/lib/cart-store';
import { parseStoreCookie } from '@/lib/store-context';

type ReviewQuote = AgentOrderInput & {
  storeName?: string;
  deliveryZoneName?: string;
  lines: {
    name: string; qty: number; unitPriceCents: number; lineTotalCents: number;
    variantName?: string; addonNames?: string[]; modifierNames?: string[];
  }[];
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  requiresScheduling: boolean;
  notice: string;
};

function readQuote(result: Record<string, unknown>): ReviewQuote {
  agentOrderSchema.parse({ storeSlug: result.storeSlug, fulfillmentType: result.fulfillmentType, ...(result.deliveryZoneId ? { deliveryZoneId: result.deliveryZoneId } : {}), items: result.items });
  const cents = [result.subtotalCents, result.deliveryFeeCents, result.totalCents];
  if (!cents.every((value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    || !Array.isArray(result.lines) || !result.lines.length
    || !result.lines.every((line) => line && typeof line === 'object' && typeof line.name === 'string' && Number.isSafeInteger(line.qty) && line.qty > 0 && Number.isSafeInteger(line.unitPriceCents) && line.unitPriceCents >= 0 && Number.isSafeInteger(line.lineTotalCents) && line.lineTotalCents >= 0)) {
    throw new Error('Não foi possível confirmar o resumo desta selecção.');
  }
  return result as ReviewQuote;
}

function reviewSignature(quote: ReviewQuote) {
  return JSON.stringify([quote.storeSlug, quote.fulfillmentType, quote.deliveryZoneId, quote.items, quote.lines, quote.subtotalCents, quote.deliveryFeeCents, quote.totalCents, quote.requiresScheduling]);
}

export default function AssistedOrderPage() {
  const [selection, setSelection] = useState<AgentOrderInput | null>(null);
  const [quote, setQuote] = useState<ReviewQuote | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [replacesCart, setReplacesCart] = useState(false);
  const [reload, setReload] = useState(0);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const previousCart = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const requestGeneration = ++generation.current;
    setLoading(true);
    setError('');
    setMessage('');
    setQuote(null);
    setSelection(null);
    try {
      const input = decodeAgentHandoff(window.location.hash);
      previousCart.current = window.localStorage.getItem('cart');
      setReplacesCart(cartHasItems(previousCart.current));
      setSelection(input);
      void callPublicAgentTool('quote_order', input, controller.signal)
        .then((result) => { if (!controller.signal.aborted) setQuote(readQuote(result)); })
        .catch((err: unknown) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Não foi possível consultar a selecção.'); })
        .finally(() => { if (generation.current === requestGeneration) setLoading(false); });
    } catch {
      setError('Esta ligação não contém uma selecção válida. Pede ao assistente para preparar uma nova ou escolhe no cardápio.');
      setLoading(false);
    }
    const changed = () => setReload((value) => value + 1);
    window.addEventListener('hashchange', changed);
    return () => { generation.current = requestGeneration + 1; controller.abort(); window.removeEventListener('hashchange', changed); };
  }, [reload]);

  async function continueToCheckout() {
    if (!selection || !quote || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    const requestGeneration = generation.current;
    try {
      const fresh = readQuote(await callPublicAgentTool('quote_order', selection));
      if (requestGeneration !== generation.current) return;
      const currentCart = window.localStorage.getItem('cart');
      if (currentCart !== previousCart.current) {
        previousCart.current = currentCart;
        setReplacesCart(cartHasItems(currentCart));
        setQuote(fresh);
        setMessage('O carrinho guardado mudou noutra página. Revê esta selecção e confirma novamente para o substituir.');
        return;
      }
      if (reviewSignature(fresh) !== reviewSignature(quote)) {
        setQuote(fresh);
        setMessage('A loja actualizou esta selecção. Revê os artigos e o total actualizado antes de continuar.');
        return;
      }
      const input = agentOrderSchema.parse({ storeSlug: fresh.storeSlug, fulfillmentType: fresh.fulfillmentType, ...(fresh.deliveryZoneId ? { deliveryZoneId: fresh.deliveryZoneId } : {}), items: fresh.items });
      const url = saveReviewedAgentCart(input, window.localStorage, window.sessionStorage, (cookie) => {
        document.cookie = cookie;
        if (parseStoreCookie(document.cookie) !== input.storeSlug) throw new Error('Não foi possível seleccionar a loja neste browser.');
      });
      window.location.assign(url);
    } catch (err) {
      if (requestGeneration === generation.current) setError(err instanceof Error ? err.message : 'Não foi possível continuar. Tenta novamente.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const fmt = (value: number) => formatMT(value as Cents);
  const menuUrl = selection && !replacesCart ? `/l/${encodeURIComponent(selection.storeSlug)}` : '/';

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col px-5 py-8 sm:py-12">
      <Link href="/" className="mb-8 inline-flex min-h-11 items-center self-start text-sm text-[var(--st-muted-2)] underline underline-offset-4">Escolher loja</Link>
      <p className="mb-2 text-sm text-[var(--st-primary)]">Preparado com o teu assistente</p>
      <h1 className="text-3xl font-bold leading-tight">Revê o teu pedido</h1>
      <p className="mt-3 text-sm leading-6 text-[var(--st-muted-2)]">Confirma os artigos e a loja. A morada, os contactos e o pagamento são preenchidos no checkout.</p>

      {loading && <p role="status" className="py-10 text-[var(--st-muted-2)]">A confirmar preços e disponibilidade…</p>}
      {error && <div role="alert" className="mt-6 rounded-xl border border-[var(--st-line)] bg-[var(--st-card)] p-4 text-sm leading-6">
        <p>{error}</p>
        {selection && <button type="button" onClick={() => setReload((value) => value + 1)} className="mt-2 min-h-11 underline underline-offset-4">Consultar novamente</button>}
      </div>}
      {message && <p role="status" className="mt-5 rounded-xl border border-[var(--st-primary)] p-4 text-sm leading-6">{message}</p>}

      {quote && !loading && <>
        <section aria-label="Resumo da selecção" className="mt-7 rounded-2xl border border-[var(--st-line)] bg-[var(--st-card)] p-5">
          <h2 className="font-bold">{quote.storeName || quote.storeSlug}</h2>
          <p className="mt-1 text-sm text-[var(--st-muted-2)]">{quote.fulfillmentType === 'delivery' ? `Entrega${quote.deliveryZoneName ? ` · ${quote.deliveryZoneName}` : ''}` : 'Levantamento na loja'}</p>
          <ul className="mt-5 divide-y divide-[var(--st-line)]">
            {quote.lines.map((line, index) => <li key={index} className="py-4 first:pt-0">
              <div className="flex justify-between gap-4"><span className="font-semibold">{line.qty} × {line.name}</span><span className="shrink-0 tabular-nums">{fmt(line.lineTotalCents)}</span></div>
              {!![line.variantName, ...(line.addonNames ?? []), ...(line.modifierNames ?? [])].filter(Boolean).length && <p className="mt-1 text-sm text-[var(--st-muted-2)]">{[line.variantName, ...(line.addonNames ?? []), ...(line.modifierNames ?? [])].filter(Boolean).join(' · ')}</p>}
              <p className="mt-1 text-xs text-[var(--st-muted-2)]">{fmt(line.unitPriceCents)} por unidade</p>
            </li>)}
          </ul>
          <dl className="space-y-2 border-t border-[var(--st-line)] pt-4 text-sm">
            <div className="flex justify-between"><dt>Artigos</dt><dd>{fmt(quote.subtotalCents)}</dd></div>
            {quote.fulfillmentType === 'delivery' && <div className="flex justify-between"><dt>Entrega</dt><dd>{fmt(quote.deliveryFeeCents)}</dd></div>}
            <div className="flex justify-between pt-3 text-xl font-bold"><dt>Total actual</dt><dd className="text-[var(--st-primary)]">{fmt(quote.totalCents)}</dd></div>
          </dl>
        </section>
        {quote.requiresScheduling && <p className="mt-4 text-sm leading-6 text-[var(--st-muted-2)]">A loja exige agendamento para esta selecção. Escolhe um horário disponível no checkout.</p>}
        <p className="mt-4 text-xs leading-5 text-[var(--st-muted-2)]">{quote.notice || 'Os preços e a disponibilidade voltam a ser confirmados ao finalizar. A selecção não reserva stock.'}</p>
        {replacesCart && <p className="mt-5 rounded-xl border border-[var(--st-line)] p-4 text-sm leading-6">Já tens artigos no carrinho. Ao continuar, o carrinho guardado e as suas notas serão substituídos por esta selecção.</p>}
        <button type="button" disabled={busy} onClick={continueToCheckout} className="mt-6 min-h-12 w-full rounded-xl bg-[var(--st-primary)] px-4 py-4 text-sm font-bold text-[var(--st-bg)] disabled:opacity-60">
          {busy ? 'A confirmar…' : replacesCart ? 'Substituir carrinho e continuar' : 'Confirmar carrinho e continuar'}
        </button>
        <p className="mt-3 text-center text-xs leading-5 text-[var(--st-muted-2)]">Continuar ainda não envia o pedido nem efectua qualquer cobrança.</p>
      </>}
      <Link href={menuUrl} className="mt-5 flex min-h-11 items-center justify-center text-sm underline underline-offset-4">{quote ? 'Voltar ao cardápio' : 'Escolher no cardápio'}</Link>
    </main>
  );
}
