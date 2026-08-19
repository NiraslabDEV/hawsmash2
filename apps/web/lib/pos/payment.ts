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

export function buildPaymentPlan({
  totalCents,
  methods,
  mixed,
  allocations,
}: BuildPaymentPlanInput): {
  complete: boolean;
  remainingCents: number;
  payments: CounterPayment[];
} {
  assertCents(totalCents);
  if (methods.length === 0) {
    return { complete: false, remainingCents: totalCents, payments: [] };
  }

  if (!mixed) {
    return {
      complete: true,
      remainingCents: 0,
      payments: [{ method: methods[0], amountCents: totalCents }],
    };
  }

  const payments = methods.map((method) => {
    const amountCents = allocations[method] ?? 0;
    assertCents(amountCents);
    return { method, amountCents };
  });
  const allocated = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const remainingCents = totalCents - allocated;

  return {
    complete: remainingCents === 0 && payments.every((payment) => payment.amountCents > 0),
    remainingCents,
    payments: payments.filter((payment) => payment.amountCents > 0),
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
