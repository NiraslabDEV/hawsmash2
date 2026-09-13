import { z } from 'zod';

const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:/-]+$/);
const timestamp = z.iso.datetime({ precision: 3 }).refine((value) => {
  const time = new Date(value);
  return Number.isFinite(time.getTime()) && time.toISOString() === value;
}, 'Data UTC inválida.');
const amount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const common = { id: identifier, storeId: identifier, reference: identifier, amountCents: amount, occurredAt: timestamp };

/** Contrato normalizado; não é o formato de um extracto da Vodacom. */
export const paymentStatementSchema = z.object({
  version: z.literal(1), storeId: identifier, provider: z.literal('mpesa'), currency: z.literal('MZN'),
  periodStart: timestamp, periodEnd: timestamp,
  ledger: z.array(z.object({ ...common, status: z.enum(['confirmed', 'pending', 'failed']) }).strict()).max(200_000),
  statement: z.array(z.object({ ...common, kind: z.enum(['payment', 'refund', 'fee']) }).strict()).max(200_000),
}).strict().superRefine((input, ctx) => {
  if (input.periodEnd <= input.periodStart) ctx.addIssue({ code: 'custom', message: 'Intervalo do extracto inválido.' });
  for (const collection of ['ledger', 'statement'] as const) {
    const ids = new Set<string>();
    input[collection].forEach((entry, index) => {
      const path = [collection, index];
      if (entry.storeId !== input.storeId) ctx.addIssue({ code: 'custom', path, message: 'O movimento pertence a outra loja.' });
      if (ids.has(entry.id)) ctx.addIssue({ code: 'custom', path, message: 'Identificador duplicado no ficheiro.' });
      ids.add(entry.id);
      if (entry.occurredAt < input.periodStart || entry.occurredAt >= input.periodEnd) ctx.addIssue({ code: 'custom', path, message: 'Movimento fora do intervalo; revê o extracto, sem descartar linhas.' });
    });
  }
});
export type StatementInput = z.infer<typeof paymentStatementSchema>;
export type StatementIssueCode = 'amount_mismatch' | 'ledger_not_confirmed' | 'missing_in_ledger' | 'missing_in_statement' | 'duplicate_reference' | 'statement_adjustment' | 'unresolved_ledger';
export interface StatementIssue {
  code: StatementIssueCode;
  reference: string;
  ledgerIds: string[];
  statementIds: string[];
}

function sum(values: number[]): number {
  return values.reduce((total, value) => {
    const result = total + value;
    if (!Number.isSafeInteger(result)) throw new Error('Os valores excedem o limite seguro de centavos.');
    return result;
  }, 0);
}

/** Converte decimal explícito sem parseFloat, separadores de milhares ou arredondamento. */
export function parseStatementAmount(value: string, separator: '.' | ','): number {
  if (typeof value !== 'string' || value.length > 32 || !['.', ','].includes(separator)) throw new Error('Montante inválido.');
  const parts = value.split(separator);
  if (parts.length !== 2 || !/^(0|[1-9]\d*)$/.test(parts[0]) || !/^\d{2}$/.test(parts[1])) throw new Error('Usa um montante com duas casas decimais e sem separador de milhares.');
  const cents = BigInt(parts[0]) * 100n + BigInt(parts[1]);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Montante acima do limite seguro de centavos.');
  return Number(cents);
}

/**
 * Conciliação apenas de leitura, por referência exacta e por loja.
 * Nunca confirma/reverte pagamentos. Divergências, taxas e devoluções exigem revisão.
 * DECISÃO: o adaptador real depende de um extracto validado (B-107); não adivinhar colunas,
 * referências, datas de liquidação ou o sinal dos movimentos do fornecedor.
 */
export function reconcilePaymentStatement(value: unknown) {
  const input = paymentStatementSchema.parse(value);
  const issues: StatementIssue[] = [];
  const groups = new Map<string, { ledger: StatementInput['ledger']; statement: StatementInput['statement'] }>();
  const group = (reference: string) => {
    let current = groups.get(reference);
    if (!current) { current = { ledger: [], statement: [] }; groups.set(reference, current); }
    return current;
  };
  for (const entry of input.ledger) group(entry.reference).ledger.push(entry);
  for (const entry of input.statement) {
    if (entry.kind === 'payment') group(entry.reference).statement.push(entry);
    else issues.push({ code: 'statement_adjustment', reference: entry.reference, ledgerIds: [], statementIds: [entry.id] });
  }
  let matchedCount = 0;
  let excludedFailedCount = 0;
  for (const [reference, { ledger, statement }] of groups) {
    let code: StatementIssueCode | null = null;
    if (ledger.length > 1 || statement.length > 1) code = 'duplicate_reference';
    else if (!ledger.length) code = 'missing_in_ledger';
    else if (!statement.length) {
      if (ledger[0].status === 'failed') excludedFailedCount++;
      else code = ledger[0].status === 'confirmed' ? 'missing_in_statement' : 'unresolved_ledger';
    } else if (ledger[0].status !== 'confirmed') code = 'ledger_not_confirmed';
    else if (ledger[0].amountCents !== statement[0].amountCents) code = 'amount_mismatch';
    else matchedCount++;
    if (code) issues.push({ code, reference, ledgerIds: ledger.map((entry) => entry.id), statementIds: statement.map((entry) => entry.id) });
  }
  const confirmedCents = sum(input.ledger.filter((entry) => entry.status === 'confirmed').map((entry) => entry.amountCents));
  const statementPaymentCents = sum(input.statement.filter((entry) => entry.kind === 'payment').map((entry) => entry.amountCents));
  const statementRefundCents = sum(input.statement.filter((entry) => entry.kind === 'refund').map((entry) => entry.amountCents));
  const statementFeeCents = sum(input.statement.filter((entry) => entry.kind === 'fee').map((entry) => entry.amountCents));
  const statementNetCents = sum([statementPaymentCents, -statementRefundCents, -statementFeeCents]);
  const differenceCents = sum([statementPaymentCents, -confirmedCents]);
  return {
    version: 1 as const, storeId: input.storeId, provider: input.provider, currency: input.currency,
    periodStart: input.periodStart, periodEnd: input.periodEnd,
    status: issues.length ? 'review_required' as const : 'matched' as const,
    matchedCount, excludedFailedCount, ledgerCount: input.ledger.length, statementCount: input.statement.length,
    totals: { confirmedCents, statementPaymentCents, statementRefundCents, statementFeeCents, statementNetCents, differenceCents },
    issues,
    notice: 'Conferência de ficheiros normalizados; não é uma confirmação do fornecedor nem uma reconciliação do saldo bancário. Nenhum pagamento foi alterado.',
  };
}
