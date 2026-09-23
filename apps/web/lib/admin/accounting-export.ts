import { cents, centsToDecimalString } from '@delivery/core';
import { z } from 'zod';

const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const exportRowSchema = z.object({
  store_name: z.string(), sale_date: z.string(), sale_time: z.string(), order_number: z.string().min(1),
  daily_number: z.number().int().nullable(), channel: z.string(), order_status: z.string(),
  customer_name: z.string(), customer_phone: z.string().nullable(),
  subtotal_cents: amount, delivery_fee_cents: amount, order_total_cents: amount,
  payment_method: z.string(), payment_amount_cents: amount,
  payment_status: z.enum(['confirmed', 'refunded']), payment_reference: z.string().nullable(),
});
export type ExportRow = z.infer<typeof exportRowSchema>;
export type AccountingLayout = 'payments' | 'orders';
export type CsvFormat = 'standard' | 'excel';

const commonHeader = ['loja', 'data', 'hora', 'numero_pedido', 'numero_dia', 'canal', 'estado_pedido', 'cliente', 'telefone', 'subtotal_mt', 'taxa_entrega_mt', 'total_pedido_mt'];
const common = (r: ExportRow, money: (n: number) => string) => [r.store_name, r.sale_date, r.sale_time, r.order_number, r.daily_number ?? '', r.channel, r.order_status, r.customer_name, r.customer_phone ?? '', money(r.subtotal_cents), money(r.delivery_fee_cents), money(r.order_total_cents)];

/** CSV genérico para mapeamento no destino; não é um documento fiscal nem um formato WinREST. */
export function buildAccountingCsv(input: unknown[], layout: AccountingLayout, format: CsvFormat): string {
  const rows = z.array(exportRowSchema).parse(input);
  const delimiter = format === 'excel' ? ';' : ',';
  const money = (value: number) => {
    const decimal = centsToDecimalString(cents(value));
    return format === 'excel' ? decimal.replace('.', ',') : decimal;
  };
  const field = (value: unknown) => {
    let text = String(value ?? '');
    // Uma célula fornecida por um cliente nunca se transforma numa fórmula ao abrir no Excel.
    if (/^\s*[=+@-]|^[\t\r\n]/.test(text)) text = `'${text}`;
    return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = [...commonHeader, ...(layout === 'payments'
    ? ['forma_pagamento', 'valor_pagamento_mt', 'estado_pagamento', 'referencia_pagamento']
    : ['pagamentos_confirmados_mt', 'pagamentos_devolvidos_mt', 'formas_pagamento']), 'moeda', 'versao_formato'];
  let values: unknown[][];
  if (layout === 'payments') {
    values = rows.map((r) => [...common(r, money), r.payment_method, money(r.payment_amount_cents), r.payment_status, r.payment_reference ?? '', 'MZN', '1']);
  } else {
    const orders = new Map<string, { row: ExportRow; confirmed: number; refunded: number; methods: Set<string> }>();
    for (const row of rows) {
      const key = JSON.stringify([row.store_name, row.order_number]);
      const order = orders.get(key) ?? { row, confirmed: 0, refunded: 0, methods: new Set<string>() };
      // DECISÃO: o resumo repete o total da venda uma única vez, mesmo em pagamento misto.
      if (JSON.stringify(common(order.row, money)) !== JSON.stringify(common(row, money))) throw new Error('Dados do pedido inconsistentes. Repita a exportação.');
      const sum = row.payment_status === 'confirmed' ? 'confirmed' : 'refunded';
      order[sum] += row.payment_amount_cents;
      if (!Number.isSafeInteger(order[sum])) throw new Error('Total fora do limite suportado.');
      order.methods.add(row.payment_method); orders.set(key, order);
    }
    values = [...orders.values()].map((o) => [...common(o.row, money), money(o.confirmed), money(o.refunded), [...o.methods].sort().join(' + '), 'MZN', '1']);
  }
  return '\uFEFF' + [header, ...values].map((row) => row.map(field).join(delimiter)).join('\r\n') + '\r\n';
}
