import { describe, expect, it } from 'vitest';
import { reconcilePaymentStatement, parseStatementAmount, type StatementInput } from '../statement';

function sample(): StatementInput {
  return {
    version: 1, storeId: 'PLACEHOLDER_LOJA', provider: 'mpesa', currency: 'MZN',
    periodStart: '2026-09-13T22:00:00.000Z', periodEnd: '2026-09-14T22:00:00.000Z',
    ledger: [{ id: 'PLACEHOLDER_PAGAMENTO', storeId: 'PLACEHOLDER_LOJA', reference: 'PLACEHOLDER_REF', amountCents: 103000, occurredAt: '2026-09-14T10:00:00.000Z', status: 'confirmed' }],
    statement: [{ id: 'PLACEHOLDER_MOVIMENTO', storeId: 'PLACEHOLDER_LOJA', reference: 'PLACEHOLDER_REF', amountCents: 103000, occurredAt: '2026-09-14T10:01:00.000Z', kind: 'payment' }],
  };
}

describe('conciliação de extracto, sem alterar pagamentos', () => {
  it('confere referências e centavos; repetir é determinístico e não muda entradas', () => {
    const input = sample(); const before = JSON.stringify(input);
    const report = reconcilePaymentStatement(input);
    expect(report.status).toBe('matched');
    expect(report.matchedCount).toBe(1);
    expect(report.totals).toMatchObject({ confirmedCents: 103000, statementPaymentCents: 103000, differenceCents: 0 });
    expect(reconcilePaymentStatement(input)).toEqual(report);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('detecta total diferente mesmo com referência igual', () => {
    const input = sample(); input.statement[0].amountCents = 102999;
    expect(reconcilePaymentStatement(input).issues[0].code).toBe('amount_mismatch');
  });
  it('pagamento pendente visto no extracto exige revisão, nunca é confirmado pelo relatório', () => {
    const input = sample(); input.ledger[0].status = 'pending';
    expect(reconcilePaymentStatement(input)).toMatchObject({ status: 'review_required', matchedCount: 0, issues: [{ code: 'ledger_not_confirmed' }] });
    expect(input.ledger[0].status).toBe('pending');
  });
  it('ref não encontrada e confirmado sem movimento não se compensam pelo mesmo valor', () => {
    const input = sample(); input.statement[0].reference = 'PLACEHOLDER_OUTRA';
    const report = reconcilePaymentStatement(input);
    expect(report.totals.differenceCents).toBe(0);
    expect(report.status).toBe('review_required');
    expect(report.issues.map((x) => x.code).sort()).toEqual(['missing_in_ledger', 'missing_in_statement']);
  });
  it('duas linhas para a mesma referência ficam ambíguas, não são deduplicadas em silêncio', () => {
    const input = sample(); input.statement.push({ ...input.statement[0], id: 'PLACEHOLDER_OUTRO_MOVIMENTO' });
    expect(reconcilePaymentStatement(input).issues[0].code).toBe('duplicate_reference');
  });
  it('referências são exactas e sensíveis a maiúsculas', () => {
    const input = sample(); input.statement[0].reference = 'placeholder_ref';
    expect(reconcilePaymentStatement(input).matchedCount).toBe(0);
  });
  it('taxas e devoluções ficam visíveis para revisão separada', () => {
    const input = sample(); input.statement.push(
      { ...input.statement[0], id: 'PLACEHOLDER_TAXA', kind: 'fee', amountCents: 300 },
      { ...input.statement[0], id: 'PLACEHOLDER_DEVOLUCAO', kind: 'refund', amountCents: 5000 },
    );
    const report = reconcilePaymentStatement(input);
    expect(report.status).toBe('review_required');
    expect(report.issues.map((x) => x.code)).toEqual(['statement_adjustment', 'statement_adjustment']);
    expect(report.totals).toMatchObject({ statementRefundCents: 5000, statementFeeCents: 300, statementNetCents: 97700 });
  });
  it('pendência sem extracto é assinalada; tentativa falhada sem crédito não conta como recebimento', () => {
    const input = sample(); input.statement = []; input.ledger[0].status = 'pending';
    expect(reconcilePaymentStatement(input).issues[0].code).toBe('unresolved_ledger');
    input.ledger[0].status = 'failed';
    expect(reconcilePaymentStatement(input)).toMatchObject({ status: 'matched', excludedFailedCount: 1, totals: { confirmedCents: 0 } });
  });
  it('recusa misturar lojas e IDs duplicados', () => {
    const input = sample(); input.statement[0].storeId = 'PLACEHOLDER_OUTRA_LOJA';
    expect(() => reconcilePaymentStatement(input)).toThrow(/loja/i);
    const duplicate = sample(); duplicate.ledger.push({ ...duplicate.ledger[0] });
    expect(() => reconcilePaymentStatement(duplicate)).toThrow(/duplicado/i);
  });
  it('recusa centavos fraccionários, negativos e overflow na soma', () => {
    for (const amountCents of [0, -1, 1.1, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const input = sample(); input.ledger[0].amountCents = amountCents;
      expect(() => reconcilePaymentStatement(input)).toThrow();
    }
    const input = sample(); input.ledger[0].amountCents = Number.MAX_SAFE_INTEGER;
    input.ledger.push({ ...input.ledger[0], id: 'PLACEHOLDER_P2', reference: 'PLACEHOLDER_R2' });
    expect(() => reconcilePaymentStatement(input)).toThrow(/limite/i);
  });
  it('exige intervalo UTC explícito e rejeita movimentos fora dele sem os descartar', () => {
    for (const date of ['2026-09-14', '2026-02-30T10:00:00.000Z', '2026-09-14T22:00:00.000Z']) {
      const input = sample(); input.statement[0].occurredAt = date;
      expect(() => reconcilePaymentStatement(input)).toThrow();
    }
    const input = sample(); input.periodEnd = input.periodStart;
    expect(() => reconcilePaymentStatement(input)).toThrow();
  });
  it('recusa campos imprevistos, estados e moedas desconhecidos', () => {
    for (const patch of [{ currency: 'USD' }, { phone: 'PLACEHOLDER_PRIVADO' }, { provider: 'unknown' }]) {
      expect(() => reconcilePaymentStatement({ ...sample(), ...patch })).toThrow();
    }
    const input = sample(); Object.assign(input.statement[0], { kind: 'unknown' });
    expect(() => reconcilePaymentStatement(input)).toThrow();
  });
  it('confere 1500 pagamentos e detecta uma discrepância no fim do lote', () => {
    const input = sample(); const ledger = input.ledger[0]; const statement = input.statement[0];
    input.ledger = Array.from({ length: 1500 }, (_, i) => ({ ...ledger, id: `PLACEHOLDER_L${i}`, reference: `PLACEHOLDER_R${i}` }));
    input.statement = Array.from({ length: 1500 }, (_, i) => ({ ...statement, id: `PLACEHOLDER_S${i}`, reference: `PLACEHOLDER_R${i}` }));
    expect(reconcilePaymentStatement(input).matchedCount).toBe(1500);
    input.statement[1499].amountCents++;
    expect(reconcilePaymentStatement(input)).toMatchObject({ matchedCount: 1499, status: 'review_required' });
  });
});

describe('normalização de montantes sem float', () => {
  it('converte texto decimal explícito em centavos exactos', () => {
    expect(parseStatementAmount('1030.01', '.')).toBe(103001);
    expect(parseStatementAmount('1030,01', ',')).toBe(103001);
    expect(parseStatementAmount('0.10', '.')).toBe(10);
  });
  it('não adivinha milhares, arredondamentos, moeda ou sinal', () => {
    for (const text of ['1,030.01', '1.030,01', '10.001', '10,50', '1e3', '-1.00', '10 MT', ' 10.00', '01.00', '90071992547409.92']) {
      expect(() => parseStatementAmount(text, '.')).toThrow();
    }
  });
});
