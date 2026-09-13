import { timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymentProvider } from '@delivery/payments';
import { z } from 'zod';
import type { PaymentConfig } from './config';
import type { ConfirmOrderInput, ConfirmOrderResult } from './confirm';

const afterSchema = z.object({ createdAt: z.string().datetime({ offset: true }), id: z.string().uuid() }).strict();
const cursorSchema = z.object({ v: z.literal(1), cutoff: z.string().datetime({ offset: true }), after: afterSchema.nullable() }).strict();
type Cursor = z.infer<typeof cursorSchema>;
type After = z.infer<typeof afterSchema>;
const orderSchema = z.object({
  id: z.string().uuid(), store_id: z.string().uuid(), total_cents: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  payment_reference: z.string().max(500).nullable(), payment_provider_ref: z.string().max(500).nullable(),
  payment_method: z.string().max(40).nullable(), created_at: z.string().datetime({ offset: true }),
  stores: z.object({ slug: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) }),
});
export type ReconciliationOrder = Omit<z.infer<typeof orderSchema>, 'stores'> & { storeSlug: string };
type PageInput = { cutoff: string; after?: After; limit: number; signal: AbortSignal };
export type ReconciliationDependencies = {
  listPage: (input: PageInput) => Promise<ReconciliationOrder[]>;
  configForStore: (slug: string, signal: AbortSignal) => Promise<PaymentConfig>;
  buildProvider: (config: PaymentConfig) => PaymentProvider;
  confirm: (input: Omit<ConfirmOrderInput, 'svc'>, signal: AbortSignal) => Promise<ConfirmOrderResult>;
};
export type ReconciliationOptions = {
  cursor?: string; pageSize?: number; maxOrders?: number; concurrency?: number;
  runBudgetMs?: number; statusTimeoutMs?: number; signal?: AbortSignal;
};

export function decodeReconciliationCursor(value: string): Cursor {
  if (!value || value.length > 2000 || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('invalid_reconciliation_cursor');
  return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
}
const encodeCursor = (value: Cursor) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Paginação por chave: confirmar/remover a página anterior não salta linhas. */
export function createReconciliationRepository(svc: SupabaseClient): ReconciliationDependencies['listPage'] {
  return async ({ cutoff, after, limit, signal }) => {
    const validCutoff = z.string().datetime({ offset: true }).parse(cutoff);
    const validAfter = after ? afterSchema.parse(after) : undefined;
    const validLimit = z.number().int().min(1).max(100).parse(limit);
    let query = svc.from('orders')
      .select('id,store_id,total_cents,payment_reference,payment_provider_ref,payment_method,created_at,stores!inner(slug)')
      .in('status', ['awaiting_payment', 'payment_failed'])
      .lt('created_at', validCutoff)
      .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(validLimit);
    if (validAfter) query = query.or(`created_at.gt.${validAfter.createdAt},and(created_at.eq.${validAfter.createdAt},id.gt.${validAfter.id})`);
    const { data, error } = await query.abortSignal(signal);
    if (error) throw new Error('reconciliation_read_failed');
    const parsed = z.array(orderSchema).max(validLimit).safeParse(data);
    if (!parsed.success) throw new Error('reconciliation_read_failed');
    return parsed.data.map(({ stores, ...order }) => ({ ...order, storeSlug: stores.slug }));
  };
}

function bounded(value: number | undefined, fallback: number, ceiling: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > ceiling) throw new Error('invalid_reconciliation_limit');
  return value;
}

/** Uma passagem limitada. completed refere-se à leitura da fila, não ao estado dos pagamentos. */
export async function runPaymentReconciliation(deps: ReconciliationDependencies, options: ReconciliationOptions = {}) {
  const cursor: Cursor = options.cursor ? decodeReconciliationCursor(options.cursor) : { v: 1, cutoff: new Date(Date.now() - 5 * 60_000).toISOString(), after: null };
  const pageSize = bounded(options.pageSize, 50, 100);
  const maxOrders = bounded(options.maxOrders, 300, 1000);
  const concurrency = bounded(options.concurrency, 3, 5);
  const runBudgetMs = bounded(options.runBudgetMs, 50_000, 60_000);
  const statusTimeoutMs = bounded(options.statusTimeoutMs, 20_000, 30_000);
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), runBudgetMs);
  const signal = options.signal ? AbortSignal.any([deadline.signal, options.signal]) : deadline.signal;
  const totals = { examined: 0, confirmed: 0, pending: 0, providerFailed: 0, skipped: 0, errors: 0 };
  const providers = new Map<string, Promise<{ name: string; provider: PaymentProvider } | null>>();
  let after = cursor.after;
  let reason: 'complete' | 'budget_exhausted' | 'limit_reached' | 'read_failed' = 'complete';

  const configured = (order: ReconciliationOrder) => {
    let provider = providers.get(order.store_id);
    if (!provider) {
      provider = (async () => {
        const cfg = await deps.configForStore(order.storeSlug, signal);
        signal.throwIfAborted();
        if (cfg.provider === 'manual') return null;
        return { name: cfg.provider, provider: deps.buildProvider(cfg) };
      })();
      providers.set(order.store_id, provider);
    }
    return provider;
  };
  const processOrder = async (order: ReconciliationOrder) => {
    try {
      const configuredProvider = await configured(order);
      if (!configuredProvider) return 'skipped' as const;
      const { name, provider } = configuredProvider;
      const reference = provider.flow === 'direct' ? order.payment_reference : order.payment_provider_ref;
      if (!reference || !provider.getPaymentStatus) return 'skipped' as const;
      const queryDeadline = new AbortController();
      const queryTimer = setTimeout(() => queryDeadline.abort(), statusTimeoutMs);
      const querySignal = AbortSignal.any([signal, queryDeadline.signal]);
      let status: Awaited<ReturnType<NonNullable<PaymentProvider['getPaymentStatus']>>>;
      try {
        status = await provider.getPaymentStatus(reference, { signal: querySignal });
        if (querySignal.aborted) return 'pending' as const;
      } finally { clearTimeout(queryTimer); }
      if (status === 'failed') {
        // DECISÃO: falta uma transição de domínio para a falha definitiva neste
        // caminho. Registamos o resultado da passagem sem UPDATE de estado nem
        // rotação de referência; a verificação activa continua disponível.
        return 'providerFailed' as const;
      }
      if (status !== 'success' || signal.aborted) return 'pending' as const;
      const result = await deps.confirm({
        orderId: order.id, provider: name, providerRef: order.payment_provider_ref ?? order.payment_reference,
        method: order.payment_method ?? 'mpesa', amountCents: order.total_cents, source: 'reconciliation',
      }, signal);
      return result.ok ? 'confirmed' as const : 'errors' as const;
    } catch { return signal.aborted ? 'pending' as const : 'errors' as const; }
  };

  try {
    while (totals.examined < maxOrders) {
      if (signal.aborted) { reason = 'budget_exhausted'; break; }
      const limit = Math.min(pageSize, maxOrders - totals.examined);
      let page: ReconciliationOrder[];
      try { page = await deps.listPage({ cutoff: cursor.cutoff, ...(after ? { after } : {}), limit, signal }); }
      catch { reason = signal.aborted ? 'budget_exhausted' : 'read_failed'; break; }
      if (!page.length) break;
      for (let start = 0; start < page.length; start += concurrency) {
        if (signal.aborted) { reason = 'budget_exhausted'; break; }
        const batch = page.slice(start, start + concurrency);
        // Não há corrida com Promise.race: todas as consultas arrancadas são
        // canceláveis e aguardadas, incluindo quando o orçamento termina.
        const outcomes = await Promise.all(batch.map(processOrder));
        for (const outcome of outcomes) totals[outcome]++;
        totals.examined += batch.length;
        const last = batch[batch.length - 1];
        after = { createdAt: last.created_at, id: last.id };
      }
      if (signal.aborted) { reason = 'budget_exhausted'; break; }
      if (totals.examined >= maxOrders) { reason = 'limit_reached'; break; }
      if (page.length < limit) break;
    }
    const completed = reason === 'complete';
    return {
      ok: reason !== 'read_failed', completed, reason, ...totals,
      nextCursor: completed ? null : encodeCursor({ ...cursor, after }),
      notice: 'O resultado descreve esta passagem. Pagamentos pendentes ou falhados pelo fornecedor continuam por resolver; a reconciliação não inicia cobranças.',
    };
  } finally { clearTimeout(timer); }
}

export async function handleReconciliationRequest(request: Request, deps: {
  secret: string | undefined;
  run: (cursor?: string) => Promise<Record<string, unknown>>;
}): Promise<Response> {
  const headers = { 'Cache-Control': 'private, no-store' };
  const secret = deps.secret?.trim();
  if (!secret) return Response.json({ ok: false, error: 'cron_not_configured' }, { status: 503, headers });
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(request.headers.get('authorization') ?? '');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401, headers });
  const values = new URL(request.url).searchParams.getAll('cursor');
  try {
    if (values.length > 1) throw new Error('duplicate_cursor');
    if (values[0]) decodeReconciliationCursor(values[0]);
    else if (values.length) throw new Error('empty_cursor');
  } catch { return Response.json({ ok: false, error: 'invalid_cursor' }, { status: 400, headers }); }
  try {
    const result = await deps.run(values[0]);
    return Response.json(result, { status: result.ok === false ? 503 : 200, headers });
  } catch { return Response.json({ ok: false, error: 'reconciliation_failed' }, { status: 503, headers }); }
}
