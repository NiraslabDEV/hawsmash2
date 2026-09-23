export type CounterPaymentMethod = 'cash' | 'mpesa' | 'emola' | 'credit_card';

export type CounterPayment = {
  method: CounterPaymentMethod;
  amountCents: number;
};

type BuildPaymentPlanInput = {
  totalCents: number;
  methods: CounterPaymentMethod[];
  mixed: boolean;
  allocations: Partial<Record<CounterPaymentMethod, number>>;
};

function assertCents(value: number): void {
  if (!Number.isInteger(value) || value < 0) throw new Error('invalid_cents');
}

/**
 * O plano de pagamento do balcão.
 *
 * No misto, o valor escrito em **dinheiro é o que o cliente entregou**, não a
 * parcela: a parcela em dinheiro é o que falta depois dos meios digitais, e o
 * que passar dela é troco. Antes pedia-se a parcela e, à parte, o "Recebido" —
 * dois números para o mesmo dinheiro, o segundo esquecido a 0, e o FINALIZAR
 * ficava apagado sem dizer porquê. Dar a mais em dinheiro também bloqueava a
 * venda ("Excede") em vez de dar troco.
 *
 * Os meios digitais continuam exactos: M-Pesa, e-Mola e cartão não dão troco,
 * por isso a soma deles nunca pode passar do total.
 */
export function buildPaymentPlan({
  totalCents,
  methods,
  mixed,
  allocations,
}: BuildPaymentPlanInput): {
  complete: boolean;
  remainingCents: number;
  payments: CounterPayment[];
  /** Só no misto com dinheiro: o que o cliente entregou em notas. */
  cashReceivedCents: number | null;
} {
  assertCents(totalCents);
  if (methods.length === 0) {
    return { complete: false, remainingCents: totalCents, payments: [], cashReceivedCents: null };
  }

  if (!mixed) {
    return {
      complete: true,
      remainingCents: 0,
      payments: [{ method: methods[0], amountCents: totalCents }],
      cashReceivedCents: null,
    };
  }

  const amounts = methods.map((method) => {
    const amountCents = allocations[method] ?? 0;
    assertCents(amountCents);
    return { method, amountCents };
  });
  const digital = amounts.filter((entry) => entry.method !== 'cash');
  const digitalCents = digital.reduce((sum, entry) => sum + entry.amountCents, 0);
  const everyDigitalPaid = digital.every((entry) => entry.amountCents > 0);

  if (!methods.includes('cash')) {
    const remainingCents = totalCents - digitalCents;
    return {
      complete: remainingCents === 0 && everyDigitalPaid,
      remainingCents,
      payments: digital.filter((entry) => entry.amountCents > 0),
      cashReceivedCents: null,
    };
  }

  const cashReceivedCents = allocations.cash ?? 0;
  // O que o dinheiro tem de cobrir; negativo = os digitais já passam do total.
  const cashDueCents = totalCents - digitalCents;
  const remainingCents = cashDueCents - cashReceivedCents;
  const payments = [
    ...(cashDueCents > 0 ? [{ method: 'cash' as const, amountCents: cashDueCents }] : []),
    ...digital.filter((entry) => entry.amountCents > 0),
  ];

  return {
    complete: everyDigitalPaid && cashDueCents > 0 && remainingCents <= 0,
    remainingCents,
    payments,
    cashReceivedCents,
  };
}

export function calculateChange(cashPaymentCents: number, cashReceivedCents: number): number {
  assertCents(cashPaymentCents);
  assertCents(cashReceivedCents);
  if (cashReceivedCents < cashPaymentCents) {
    throw new Error('insufficient_cash_received');
  }
  return cashReceivedCents - cashPaymentCents;
}
