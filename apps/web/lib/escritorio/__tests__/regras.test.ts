import { describe, expect, it } from 'vitest';
import { calcularHash, type DocumentoBD } from '@delivery/fiscal';

import { buildMonthFile, checkExport, type MonthExport } from '../ficheiros';
import {
  OBLIGATION_TEMPLATES, checkFiscalBuyer, currentOccurrence, dueInMonth, expiryState, formatNuit, isValidNuit, money,
  officeError, parseMoney, periodLabel, ruleText, storagePath, vatInsideTotal, type Obligation,
} from '../regras';

const ob = (over: Partial<Obligation>): Obligation => ({
  id: 'o1', store_id: null, title: 'X', description: null, recurrence: 'monthly', due_rule: 'day', due_day: 10,
  due_month: null, due_date: null, refers_to_previous: true, remind_days: 7, responsible: null, active: true, ...over,
});

describe('obrigações', () => {
  it('prazo do mês: dia fixo cortado ao fim do mês e último dia útil (igual à BD)', () => {
    expect(dueInMonth(2026, 2, 'day', 31)).toBe('2026-02-28');
    expect(dueInMonth(2026, 2, 'last_business_day', null)).toBe('2026-02-27');
    expect(dueInMonth(2026, 11, 'last_business_day', null)).toBe('2026-11-30');
    expect(dueInMonth(2026, 5, 'last_business_day', null)).toBe('2026-05-29');
  });

  it('mensal: o período é o mês anterior; fica a aproximar dentro do aviso', () => {
    const o = currentOccurrence(ob({ due_day: 20 }), new Set(), '2026-11-16');
    expect(o).toMatchObject({ period: '2026-10', due: '2026-11-20', daysLeft: 4, state: 'a_aproximar' });
    expect(currentOccurrence(ob({ due_day: 28 }), new Set(), '2026-11-16')?.state).toBe('em_dia');
  });

  it('o mês passado por fazer aparece como atrasado, antes do próximo', () => {
    const o = currentOccurrence(ob({ due_day: 10 }), new Set(), '2026-11-16');
    expect(o).toMatchObject({ period: '2026-10', due: '2026-11-10', state: 'atrasado', daysLeft: -6 });
    const feito = currentOccurrence(ob({ due_day: 10 }), new Set(['2026-10']), '2026-11-16');
    expect(feito).toMatchObject({ period: '2026-11', due: '2026-12-10', state: 'em_dia' });
  });

  it('anual e única', () => {
    const anual = currentOccurrence(ob({ recurrence: 'yearly', due_month: 3, due_day: 31, remind_days: 15 }), new Set(), '2026-03-20');
    expect(anual).toMatchObject({ period: '2025', due: '2026-03-31', state: 'a_aproximar' });
    const unica = currentOccurrence(ob({ recurrence: 'once', due_date: '2026-11-01' }), new Set(['once']), '2026-11-16');
    expect(unica?.state).toBe('feito');
    expect(ruleText(ob({ recurrence: 'yearly', due_month: 3, due_day: 31 }))).toBe('todos os anos, dia 31 de março');
    expect(ruleText(ob({ due_rule: 'last_business_day' }))).toBe('todos os meses, último dia útil');
    expect(periodLabel('2026-10')).toBe('Outubro de 2026');
  });

  it('os modelos só trazem prazo onde há fonte: os outros ficam para o dono preencher', () => {
    const comPrazo = OBLIGATION_TEMPLATES.filter((t) => t.due_rule === 'last_business_day' || t.due_day != null);
    expect(comPrazo.map((t) => t.title)).toEqual(['Ficheiro das facturas no e-Declaração']);
  });
});

describe('dinheiro, NUIT e ficheiros', () => {
  it('dinheiro como no documento e lido como se escreve', () => {
    expect(money(122400)).toBe('1.224,00');
    expect(money(-500)).toBe('-5,00');
    expect(parseMoney('1.224,50')).toBe(122450);
    expect(parseMoney('1224.5')).toBe(122450);
    expect(parseMoney('1 160')).toBe(116000);
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('1.2.3')).toBeNull();
    expect(vatInsideTotal(116000, 1600)).toBe(16000);
    expect(vatInsideTotal(15000, 1600)).toBe(2069);
    expect(vatInsideTotal(15000, 0)).toBe(0);
  });

  it('NUIT e adquirente', () => {
    expect(isValidNuit('400 000 009')).toBe(true);
    expect(isValidNuit('12345')).toBe(false);
    expect(formatNuit('400000009')).toBe('400 000 009');
    expect(checkFiscalBuyer({ nuit: '400 000 009', name: '  Empresa   Cliente ', address: ' Rua 5 ' }))
      .toEqual({ ok: true, buyer: { nuit: '400000009', name: 'Empresa Cliente', address: 'Rua 5' } });
    expect(checkFiscalBuyer({ nuit: '4000', name: 'X', address: '' })).toEqual({ ok: false, error: 'O NUIT tem 9 dígitos.' });
    expect(checkFiscalBuyer({ nuit: '400000009', name: ' ', address: '' }).ok).toBe(false);
  });

  it('validade do arquivo e caminho do ficheiro como a BD aceita', () => {
    expect(expiryState(null, 30, '2026-11-16')).toBe('sem_validade');
    expect(expiryState('2026-11-15', 30, '2026-11-16')).toBe('caducado');
    expect(expiryState('2026-12-01', 30, '2026-11-16')).toBe('a_caducar');
    expect(expiryState('2027-06-01', 30, '2026-11-16')).toBe('valido');
    const path = storagePath('purchases', '3f1c2a4e-0000-4000-8000-000000000001', 'Factura Fornecedor nº 77 (Nov).PDF');
    expect(path).toMatch(/^purchases\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/);
    expect(path.endsWith('.pdf')).toBe(true);
  });

  it('erros da BD em português, e o aviso de migration por aplicar', () => {
    expect(officeError('office_duplicate_invoice')).toContain('já está registada');
    expect(officeError('Could not find the function public.office_month_summary')).toContain('1140 e 1141');
    expect(officeError('forbidden')).toBe('O teu perfil não pode fazer isto.');
  });
});

describe('ficheiro do mês', () => {
  function doc(number: number, previous: string, over: Partial<DocumentoBD> = {}): DocumentoBD {
    const base: DocumentoBD = {
      doc_type: 'FR', series: 'LOJ2026', number, full_number: `FR LOJ2026/${String(number).padStart(6, '0')}`,
      issue_date: '2026-11-18', emitted_at: `2026-11-18T10:00:0${number}.000+00:00`, origin_number: null,
      buyer: { name: 'Consumidor final', nuit: '' }, base_cents: 10000, vat_cents: 1600, total_cents: 11600,
      payment_method: 'cash', hash: '', previous_hash: previous, voided: false,
      lines: [{ description: 'Artigo; com ponto e vírgula', quantity: 1, unit_price_cents: 10000, vat_bp: 1600, exemption_reason: null, base_cents: 10000, vat_cents: 1600 }],
      ...over,
    };
    base.hash = calcularHash({ dataEmissao: base.issue_date, emitidoEm: new Date(base.emitted_at), numeroCompleto: base.full_number, totalCents: base.total_cents, nuitAdquirente: '' }, previous);
    return base;
  }
  const a = doc(1, '');
  const b = doc(2, a.hash);
  const data: MonthExport = { issuer: { name: 'Empresa, Lda', nuit: '400000001', address: 'Sede' }, from: '2026-11-01', to: '2026-11-30', documents: [a, b] };

  it('com a cadeia íntegra gera CSV (com BOM e ;) e XML SAF-T', () => {
    expect(checkExport(data)).toEqual({ ok: true });
    const csvFile = buildMonthFile('csv', data, []);
    expect(csvFile.fileName).toBe('facturas-400000001-2026-11.csv');
    expect(csvFile.body.charCodeAt(0)).toBe(0xfeff);
    expect(csvFile.body).toContain('FR LOJ2026/000002');
    expect(csvFile.body).toContain('999999999');
    const xml = buildMonthFile('xml', data, []);
    expect(xml.body).toContain('<InvoiceNo>FR LOJ2026/000001</InvoiceNo>');
    expect(xml.contentType).toContain('xml');
  });

  it('com a cadeia partida não entrega nada', () => {
    const r = checkExport({ ...data, documents: [a, { ...b, total_cents: 1 }] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('FR LOJ2026/000002');
    expect(checkExport({ ...data, issuer: null }).ok).toBe(false);
  });

  it('compras do mês em CSV', () => {
    const f = buildMonthFile('compras', data, [{
      store: 'Baixa', supplier_name: 'Fornecedor; Lda', supplier_nuit: '400000020', invoice_number: 'FT 77', invoice_date: '2026-11-03',
      category: 'mercadoria', total_cents: 116000, vat_cents: 16000, deductible: true, has_file: true,
    }]);
    expect(f.fileName).toBe('compras-2026-11.csv');
    expect(f.body).toContain('"Fornecedor; Lda";400000020;FT 77;2026-11-03;mercadoria;1160.00;160.00;Sim;Sim');
  });
});
