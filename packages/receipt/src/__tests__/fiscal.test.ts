import { describe, expect, it } from 'vitest';

import {
  WIDTH, WIDTH_DOUBLE, buildFiscalDocument, buildPrintDocument, buildReceipt, fiscalMoney, methodLabel,
  type FiscalDocumentPayload, type Op, type PrintPayload,
} from '../index';

/** Textos impressos, com o tamanho em vigor em cada linha. */
function linhas(ops: Op[]): Array<{ text: string; double: boolean }> {
  let double = false;
  const out: Array<{ text: string; double: boolean }> = [];
  for (const op of ops) {
    if (op.t === 'size') double = op.value === 'double' || op.value === 'triple';
    if (op.t === 'text') for (const t of op.value.replace(/\n$/, '').split('\n')) out.push({ text: t, double });
  }
  return out;
}
const texto = (ops: Op[]) => linhas(ops).map((l) => l.text).join('\n');

/** O mesmo documento do modelo entregue à AT (FR LOJ2026/000123, código Cn5h). */
const fr: FiscalDocumentPayload = {
  template: 'fiscal',
  format_version: 1,
  via: 'Original',
  doc_type: 'FR',
  full_number: 'FR LOJ2026/000123',
  issue_date: '2026-11-18',
  emitted_at: '2026-11-18T17:42:05.117Z',
  origin_number: null,
  reason: null,
  issuer: {
    name: 'RESTAURANTE EXEMPLO, LDA', nuit: '400000001', address: 'Av. Exemplo, n.º 100, Maputo', regime: 'normal',
    at_certificate: '', store_name: 'Loja Baixa', store_address: 'Rua Exemplo, n.º 20, Baixa, Maputo', store_phone: '+258 84 000 0000',
  },
  buyer: { name: 'EMPRESA CLIENTE, LDA', nuit: '400000009', address: 'Av. Cliente, n.º 5, Maputo' },
  base_cents: 105517,
  vat_cents: 16883,
  total_cents: 122400,
  payment_method: 'cash',
  operator: 'Operador Exemplo',
  control_code: 'Cn5h',
  lines: [
    { position: 1, description: 'Hambúrguer clássico', quantity: 2, unit_price_cents: 38793, vat_bp: 1600, exemption_reason: null, base_cents: 77586, vat_cents: 12414, total_cents: 90000 },
    { position: 2, description: 'Batata frita (média)', quantity: 1, unit_price_cents: 12931, vat_bp: 1600, exemption_reason: null, base_cents: 12931, vat_cents: 2069, total_cents: 15000 },
    { position: 3, description: 'Refrigerante 330 ml', quantity: 2, unit_price_cents: 7500, vat_bp: 1600, exemption_reason: null, base_cents: 15000, vat_cents: 2400, total_cents: 17400 },
  ],
  order_numbers: ['LOJ-0042'],
  cash_received_cents: 150000,
  change_cents: 27600,
  product: 'WinTable',
};

describe('talão fiscal de 80 mm', () => {
  it('leva os elementos do art. 27.º, com os valores do documento', () => {
    const t = texto(buildFiscalDocument(fr));
    for (const esperado of [
      'RESTAURANTE EXEMPLO, LDA', 'NUIT 400 000 001', 'Sede: Av. Exemplo, n.º 100, Maputo', 'Regime normal de IVA',
      'FACTURA-RECIBO', 'FR LOJ2026/000123', 'Original', '18/11/2026 19:42:05', 'Pedido: LOJ-0042',
      'EMPRESA CLIENTE, LDA', 'NUIT 400 000 009', 'Av. Cliente, n.º 5, Maputo',
      'Hambúrguer clássico', '2 x 387,93', '124,14', '775,86', '1.055,17', '168,83', 'TOTAL 1.224,00',
      'Numerário', '1.500,00', '276,00', 'Documento que serve de factura e de recibo.',
      'Código de controlo: Cn5h', 'Processado por programa informático WinTable',
    ]) expect(t).toContain(esperado);
  });

  it('nenhuma linha passa a largura do papel', () => {
    for (const doc of [fr, { ...fr, doc_type: 'NC' as const, origin_number: 'FR LOJ2026/000123', reason: 'Anulação da venda — pedido registado em duplicado com um texto bem comprido' }]) {
      for (const l of linhas(buildFiscalDocument(doc))) {
        expect(l.text.length, l.text).toBeLessThanOrEqual(l.double ? WIDTH_DOUBLE : WIDTH);
      }
    }
  });

  it('sem número da AT não imprime nada sobre certificação; com número, imprime-o', () => {
    expect(texto(buildFiscalDocument(fr)).toLowerCase()).not.toContain('certifica');
    expect(texto(buildFiscalDocument({ ...fr, issuer: { ...fr.issuer, at_certificate: '123/AT/2027' } }))).toContain('Certificação AT n.º 123/AT/2027');
  });

  it('consumidor final; isento com o motivo; nota de crédito com origem e motivo', () => {
    const cf = texto(buildFiscalDocument({ ...fr, buyer: { name: 'Consumidor final', nuit: '' } }));
    expect(cf).toContain('Consumidor final');
    expect(cf).not.toContain('NUIT 400 000 009');
    const isento = texto(buildFiscalDocument({
      ...fr, issuer: { ...fr.issuer, regime: 'isento' },
      lines: fr.lines.map((l) => ({ ...l, vat_bp: 0, vat_cents: 0, base_cents: l.total_cents, exemption_reason: 'Isento - artigo 9.º do CIVA' })),
    }));
    expect(isento).toContain('Isento de IVA');
    expect(isento).toContain('Motivo: Isento - artigo 9.º do CIVA');
    const nc = texto(buildFiscalDocument({ ...fr, doc_type: 'NC', full_number: 'NC LOJ2026/000004', origin_number: 'FR LOJ2026/000123', reason: 'Pedido em duplicado' }));
    expect(nc).toContain('NOTA DE CRÉDITO');
    expect(nc).toContain('FR LOJ2026/000123');
    expect(nc).toContain('Motivo: Pedido em duplicado');
    expect(nc).toContain('Valor creditado (MT):');
    expect(nc).not.toContain('Recibo');
  });

  it('a fila escolhe o formato fiscal; payload estranho com kind fiscal falha em vez de imprimir outra coisa', () => {
    expect(texto(buildPrintDocument('fiscal', fr as unknown as PrintPayload))).toContain('FACTURA-RECIBO');
    expect(() => buildPrintDocument('fiscal', { order_number: 'X' } as unknown as PrintPayload)).toThrow('fiscal_payload_invalid');
    expect(() => buildFiscalDocument({ ...fr, format_version: 2 })).toThrow('fiscal_format_unsupported');
  });

  it('uma bridge antiga (formato herdado) não consegue imprimir o documento fiscal', () => {
    // O formato herdado lê `customer_name`; o payload fiscal não o traz, e o trabalho falha.
    expect(() => buildReceipt({ ...fr, template: undefined } as unknown as PrintPayload)).toThrow();
  });

  it('dinheiro com duas casas e meios de pagamento por extenso', () => {
    expect(fiscalMoney(122400)).toBe('1.224,00');
    expect(fiscalMoney(5)).toBe('0,05');
    expect(fiscalMoney(123456789)).toBe('1.234.567,89');
    expect(methodLabel('cash+mpesa')).toBe('Numerário + M-Pesa');
    expect(methodLabel(null)).toBe('-');
  });
});
