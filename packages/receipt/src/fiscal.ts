/**
 * Factura-Recibo e Nota de Crédito no talão de 80 mm (1140, ADR 0013/0014).
 *
 * Tudo o que se imprime vem do documento gravado na base de dados (emitente e adquirente como estavam no momento
 * da emissão), nunca das definições de agora. Os elementos são os do Código do IVA, art. 27.º, e o código de
 * controlo são 4 caracteres do hash do documento.
 *
 * Uma bridge antiga não conhece este formato: o payload não traz os campos do formato herdado e o trabalho falha
 * em vez de sair uma factura incompleta.
 */

import {
  ALIGN_CENTER, ALIGN_LEFT, BOLD_OFF, BOLD_ON, CUT, FEED_BEFORE_CUT, INIT, SIZE_DOUBLE, SIZE_NORMAL,
  WIDTH, feed, line, rule, twoColumns, wrap, type Op,
} from './ops';

export interface FiscalDocumentLine {
  position: number;
  description: string;
  quantity: number;
  unit_price_cents: number;
  vat_bp: number;
  exemption_reason: string | null;
  base_cents: number;
  vat_cents: number;
  total_cents: number;
}

export interface FiscalDocumentPayload {
  template: 'fiscal';
  format_version: number;
  via: string;
  doc_type: 'FR' | 'NC';
  full_number: string;
  issue_date: string;
  emitted_at: string;
  origin_number: string | null;
  reason: string | null;
  issuer: {
    name: string;
    nuit: string;
    address: string;
    regime: 'normal' | 'ispc' | 'isento';
    at_certificate?: string | null;
    store_name?: string | null;
    store_address?: string | null;
    store_phone?: string | null;
  };
  buyer: { name?: string | null; nuit?: string | null; address?: string | null };
  base_cents: number;
  vat_cents: number;
  total_cents: number;
  payment_method: string | null;
  operator: string | null;
  control_code: string;
  lines: FiscalDocumentLine[];
  order_numbers?: string[] | null;
  cash_received_cents?: number | null;
  change_cents?: number | null;
  product?: string | null;
}

/** Versão do formato que esta bridge sabe imprimir. Um documento de versão maior não sai. */
export const FISCAL_FORMAT_VERSION = 1;

export function isFiscalDocument(payload: unknown): payload is FiscalDocumentPayload {
  return typeof payload === 'object' && payload !== null && (payload as { template?: unknown }).template === 'fiscal';
}

const TITLE: Record<FiscalDocumentPayload['doc_type'], string> = { FR: 'FACTURA-RECIBO', NC: 'NOTA DE CRÉDITO' };
const REGIME: Record<FiscalDocumentPayload['issuer']['regime'], string> = {
  normal: 'Regime normal de IVA',
  ispc: 'Regime ISPC',
  isento: 'Isento de IVA',
};
const METHOD: Record<string, string> = {
  cash: 'Numerário', mpesa: 'M-Pesa', emola: 'e-Mola', credit_card: 'Cartão', counter: 'Balcão', manual: 'Transferência',
};

/** Meticais com duas casas e separador de milhares, como no documento: 1.224,00. */
export function fiscalMoney(value: number): string {
  const negative = value < 0;
  const abs = Math.abs(Math.trunc(value));
  const int = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${int},${String(abs % 100).padStart(2, '0')}`;
}

const nuitText = (nuit: string) => nuit.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3');
const percent = (bp: number) => `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2).replace('.', ',')}%`;

function dateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Africa/Maputo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/** Colunas da linha de artigo: "2 x 387,93" · taxa · valor do IVA · valor sem IVA = 48. */
function itemColumns(left: string, rate: string, vat: string, base: string): string {
  return `${left.slice(0, 18).padEnd(18)} ${rate.padStart(5)} ${vat.padStart(11)} ${base.padStart(11)}`;
}

export function methodLabel(method: string | null | undefined): string {
  if (!method) return '-';
  return method.split('+').map((m) => METHOD[m] ?? m).join(' + ');
}

export function buildFiscalDocument(doc: FiscalDocumentPayload): Op[] {
  if ((doc.format_version ?? 1) > FISCAL_FORMAT_VERSION) {
    throw new Error(`fiscal_format_unsupported:${doc.format_version}`);
  }
  const ops: Op[] = [INIT, ALIGN_CENTER];
  const centered = (text: string) => { for (const l of wrap(text)) ops.push(line(l)); };

  // Emitente
  ops.push(BOLD_ON);
  centered(doc.issuer.name);
  ops.push(BOLD_OFF);
  ops.push(line(`NUIT ${nuitText(doc.issuer.nuit)}`));
  centered(`Sede: ${doc.issuer.address}`);
  if (doc.issuer.store_name) centered([doc.issuer.store_name, doc.issuer.store_address].filter(Boolean).join(' - '));
  if (doc.issuer.store_phone) ops.push(line(`Tel. ${doc.issuer.store_phone}`));
  ops.push(line(REGIME[doc.issuer.regime] ?? doc.issuer.regime));

  // Documento
  ops.push(line(rule('=')));
  ops.push(SIZE_DOUBLE, BOLD_ON, line(TITLE[doc.doc_type]), SIZE_NORMAL);
  ops.push(line(doc.full_number), BOLD_OFF);
  ops.push(line(doc.via));
  ops.push(ALIGN_LEFT, line(rule('-')));
  ops.push(line(twoColumns('Data/hora:', dateTime(doc.emitted_at))));
  if (doc.order_numbers?.length) {
    for (const l of wrap(`Pedido: ${doc.order_numbers.join(', ')}`)) ops.push(line(l));
  }
  if (doc.doc_type === 'NC') {
    ops.push(line(twoColumns('Documento de origem:', doc.origin_number ?? '-')));
    for (const l of wrap(`Motivo: ${doc.reason ?? '-'}`)) ops.push(line(l));
  } else if (doc.origin_number) {
    for (const l of wrap(`Substitui ${doc.origin_number}`)) ops.push(line(l));
  }

  // Adquirente
  ops.push(line(rule('-')), BOLD_ON, line('Adquirente'), BOLD_OFF);
  const buyerNuit = (doc.buyer.nuit ?? '').trim();
  if (buyerNuit) {
    for (const l of wrap(doc.buyer.name ?? '')) ops.push(line(l));
    ops.push(line(`NUIT ${nuitText(buyerNuit)}`));
    if (doc.buyer.address) for (const l of wrap(doc.buyer.address)) ops.push(line(l));
  } else {
    ops.push(line('Consumidor final'));
  }

  // Linhas
  ops.push(line(rule('-')));
  ops.push(BOLD_ON, line(itemColumns('Qtd x P.unit s/IVA', 'IVA', 'Valor IVA', 'Val. s/IVA')), BOLD_OFF);
  for (const item of doc.lines) {
    for (const l of wrap(item.description)) ops.push(line(l));
    ops.push(line(itemColumns(`${item.quantity} x ${fiscalMoney(item.unit_price_cents)}`, percent(item.vat_bp),
      fiscalMoney(item.vat_cents), fiscalMoney(item.base_cents))));
  }

  // Resumo do IVA por taxa
  const rates = new Map<number, { base: number; vat: number; reason: string | null }>();
  for (const item of doc.lines) {
    const r = rates.get(item.vat_bp) ?? { base: 0, vat: 0, reason: item.exemption_reason };
    r.base += item.base_cents;
    r.vat += item.vat_cents;
    rates.set(item.vat_bp, r);
  }
  ops.push(line(rule('-')), BOLD_ON, line('Resumo do IVA'));
  ops.push(line(`${'Taxa'.padEnd(16)}${'Incidência'.padStart(16)}${'IVA'.padStart(16)}`), BOLD_OFF);
  for (const [bp, r] of [...rates.entries()].sort((a, b) => b[0] - a[0])) {
    ops.push(line(`${percent(bp).padEnd(16)}${fiscalMoney(r.base).padStart(16)}${fiscalMoney(r.vat).padStart(16)}`));
    if (bp === 0 && r.reason) for (const l of wrap(`Motivo: ${r.reason}`)) ops.push(line(l));
  }

  // Totais
  ops.push(line(rule('-')));
  ops.push(line(twoColumns('Total sem IVA', fiscalMoney(doc.base_cents))));
  ops.push(line(twoColumns('Total do IVA', fiscalMoney(doc.vat_cents))));
  ops.push(SIZE_DOUBLE, BOLD_ON, line(`TOTAL ${fiscalMoney(doc.total_cents)}`.slice(0, WIDTH / 2)), BOLD_OFF, SIZE_NORMAL);
  ops.push(line('Valores em meticais (MT)'));
  ops.push(line(rule('-')));

  if (doc.doc_type === 'FR') {
    ops.push(BOLD_ON, line('Recibo'), BOLD_OFF);
    ops.push(line(twoColumns('Meio de pagamento:', methodLabel(doc.payment_method))));
    if (doc.cash_received_cents != null) ops.push(line(twoColumns('Valor recebido:', fiscalMoney(doc.cash_received_cents))));
    if (doc.change_cents != null) ops.push(line(twoColumns('Troco:', fiscalMoney(doc.change_cents))));
    ops.push(BOLD_ON, line(twoColumns('Valor pago (MT):', fiscalMoney(doc.total_cents))), BOLD_OFF);
    ops.push(line('Documento que serve de factura e de recibo.'));
  } else {
    ops.push(BOLD_ON, line(twoColumns('Valor creditado (MT):', fiscalMoney(doc.total_cents))), BOLD_OFF);
  }
  ops.push(line(rule('-')));
  if (doc.operator) ops.push(line(twoColumns('Operador:', doc.operator)));

  ops.push(feed(1), ALIGN_CENTER, BOLD_ON, line(`Código de controlo: ${doc.control_code}`), BOLD_OFF);
  for (const l of wrap(`Processado por programa informático ${doc.product ?? 'WinTable'}`)) ops.push(line(l));
  // O número da AT só existe depois de atribuído; até lá não se imprime nada sobre certificação.
  if (doc.issuer.at_certificate?.trim()) ops.push(line(`Certificação AT n.º ${doc.issuer.at_certificate.trim()}`));
  ops.push(ALIGN_LEFT, feed(FEED_BEFORE_CUT), CUT);
  return ops;
}
