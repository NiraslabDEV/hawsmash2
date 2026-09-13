import { z } from 'zod';
import type { ParsedWebhook } from './provider';

const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:/-]+$/);
const method = z.enum(['mpesa', 'emola', 'credit_card']);
const webhookSchema = z.object({
  event: z.enum(['payment.success', 'payment.failed']),
  data: z.object({
    id: identifier,
    reference: identifier,
    amount: z.union([z.string(), z.number()]),
    transaction: z.object({ method }).optional(),
  }),
});

/** Converte o decimal do fornecedor sem arredondar nem fazer contas com float. */
function amountToCents(value: string | number): number {
  const text = String(value);
  if (text.length > 32 || !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(text)) throw new Error('paysuite_webhook_invalid_amount');
  const [units, fraction = ''] = text.split('.');
  const cents = BigInt(units) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents <= 0n || cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('paysuite_webhook_invalid_amount');
  return Number(cents);
}

/** Boundary de saída: centavos inteiros → decimal exacto, incluindo valores grandes. */
export function formatPaysuiteAmount(amountCents: number): string {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error('paysuite_invalid_amount_cents');
  const cents = BigInt(amountCents);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

/** Eventos pendentes/desconhecidos nunca se transformam em falha definitiva. */
export function parsePaysuiteWebhook(payload: unknown): ParsedWebhook {
  const parsed = webhookSchema.safeParse(payload);
  if (!parsed.success) throw new Error('paysuite_webhook_invalid_payload');
  const { event, data } = parsed.data;
  const payment = {
    requestId: data.reference,
    amountCents: amountToCents(data.amount),
    providerRef: data.id,
  };
  if (event === 'payment.success') {
    if (!data.transaction) throw new Error('paysuite_webhook_missing_method');
    return { ...payment, event: 'success', method: data.transaction.method };
  }
  // DECISÃO: falha sem transacção não prova o método; o handler usa o pedido da loja.
  return { ...payment, event: 'failed', ...(data.transaction ? { method: data.transaction.method } : {}) };
}
