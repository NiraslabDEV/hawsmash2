// ESC/POS receipt encoder -- bytes montados a mao.
// DECISAO: nao usamos `esc-pos-encoder` (arrasta `canvas`, binding nativo Cairo).
// Acentos: CP1252 (WPC1252) selecionada na impressora; texto em latin1
// cujos bytes coincidem com CP1252 para acentos do portugues.
import { cents, formatMT } from '@delivery/core';
import type {
  CashClosePayload,
  CustomerReceiptPayload,
  KitchenTicketPayload,
  PrintJobPayload,
  PrintPayload,
  TestPrintPayload,
} from "./types";
import { isCashClosePayload, isCustomerReceipt, isKitchenTicket, isTestPayload } from "./types";

const ESC = 0x1b;
const GS = 0x1d;

const INIT = Buffer.from([ESC, 0x40]);
const CODEPAGE_CP1252 = Buffer.from([ESC, 0x74, 16]);
const ALIGN_LEFT = Buffer.from([ESC, 0x61, 0]);
const ALIGN_CENTER = Buffer.from([ESC, 0x61, 1]);
const BOLD_ON = Buffer.from([ESC, 0x45, 1]);
const BOLD_OFF = Buffer.from([ESC, 0x45, 0]);
const SIZE_NORMAL = Buffer.from([GS, 0x21, 0x00]);
const SIZE_DOUBLE = Buffer.from([GS, 0x21, 0x11]);
export const CUT_FULL = Buffer.from([GS, 0x56, 0x00]);
const WIDTH = 48;

// Caracteres CP1252 0x80-0x9F que NAO coincidem com latin1.
// Usamos unicode escapes (\uXXXX) para evitar problemas com editores/parsers.
const CP1252_EXTRA: Record<string, number> = {
  "€": 0x80, // EUR
  "‚": 0x82, // single low-9 quotation mark
  "ƒ": 0x83, // latin small f with hook
  "„": 0x84, // double low-9 quotation mark
  "…": 0x85, // horizontal ellipsis
  "†": 0x86, // dagger
  "‡": 0x87, // double dagger
  "ˆ": 0x88, // modifier letter circumflex
  "‰": 0x89, // per mille sign
  "Š": 0x8a, // latin capital S with caron
  "‹": 0x8b, // left-pointing angle quotation mark
  "Œ": 0x8c, // latin capital OE ligature
  "Ž": 0x8e, // latin capital Z with caron
  "‘": 0x91, // left single quotation mark
  "’": 0x92, // right single quotation mark
  "“": 0x93, // left double quotation mark
  "”": 0x94, // right double quotation mark
  "•": 0x95, // bullet
  "–": 0x96, // en dash
  "—": 0x97, // em dash
  "˜": 0x98, // small tilde
  "™": 0x99, // trade mark sign
  "š": 0x9a, // latin small s with caron
  "›": 0x9b, // right-pointing angle quotation mark
  "œ": 0x9c, // latin small oe ligature
  "ž": 0x9e, // latin small z with caron
  "Ÿ": 0x9f, // latin capital Y with diaeresis
};

const CP1252_REVERSE: Record<number, string> = Object.fromEntries(
  Object.entries(CP1252_EXTRA).map(([ch, b]) => [b, ch]),
);

function text(str: string): Buffer {
  const bytes: number[] = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0xff) bytes.push(cp);
    else bytes.push(CP1252_EXTRA[ch] ?? 0x3f);
  }
  return Buffer.from(bytes);
}

function line(str = ""): Buffer {
  return Buffer.concat([text(str), Buffer.from("\n", "latin1")]);
}

function feed(n: number): Buffer {
  return Buffer.from([ESC, 0x64, n]);
}

function rule(character = '-'): string {
  return character.repeat(WIDTH);
}

function twoColumns(left: string, right: string): string {
  const safeRight = right.slice(0, WIDTH - 1);
  const maxLeft = WIDTH - safeRight.length - 1;
  const safeLeft = left.slice(0, Math.max(0, maxLeft));
  return `${safeLeft}${' '.repeat(Math.max(1, WIDTH - safeLeft.length - safeRight.length))}${safeRight}`;
}

function wrap(value: string, width = WIDTH): string[] {
  const lines: string[] = [];
  let current = '';
  for (const originalWord of value.trim().split(/\s+/).filter(Boolean)) {
    let word = originalWord;
    while (word.length > width) {
      if (current) lines.push(current);
      current = '';
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!current) current = word;
    else if (`${current} ${word}`.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function maputoTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Africa/Maputo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function signedMT(value: number): string {
  return value < 0 ? `-${formatMT(cents(Math.abs(value)))}` : formatMT(cents(value));
}

function channelLabel(channel: KitchenTicketPayload['channel']): string {
  const labels: Record<KitchenTicketPayload['channel'], string> = {
    counter: 'BALCÃO',
    delivery: 'DELIVERY',
    pickup: 'LEVANTAMENTO',
    dine_in: 'MESA',
  };
  return labels[channel];
}

export function createKitchenTicket(payload: KitchenTicketPayload): Buffer {
  const chunks: Buffer[] = [INIT, CODEPAGE_CP1252, ALIGN_CENTER];
  chunks.push(BOLD_ON, line(`HAWSMASH ${payload.store_short_name.toUpperCase()}`), BOLD_OFF);
  chunks.push(SIZE_DOUBLE, BOLD_ON, line(`Nº ${payload.daily_number}`), BOLD_OFF, SIZE_NORMAL);
  chunks.push(BOLD_ON, line(channelLabel(payload.channel)), BOLD_OFF);
  chunks.push(line(maputoTime(payload.created_at)), ALIGN_LEFT, line(rule('=')));

  for (const item of payload.items) {
    chunks.push(BOLD_ON, line(`${item.quantity}x ${item.name}`), BOLD_OFF);
    if (item.notes) {
      for (const noteLine of wrap(`NOTA: ${item.notes}`)) chunks.push(line(noteLine));
    }
  }
  if (payload.notes) {
    chunks.push(line(rule('-')), BOLD_ON);
    for (const noteLine of wrap(`NOTA DO PEDIDO: ${payload.notes}`)) chunks.push(line(noteLine));
    chunks.push(BOLD_OFF);
  }

  chunks.push(line(rule('=')), feed(3), CUT_FULL);
  return Buffer.concat(chunks);
}

export function createCustomerReceipt(payload: CustomerReceiptPayload): Buffer {
  const chunks: Buffer[] = [INIT, CODEPAGE_CP1252, ALIGN_CENTER];
  chunks.push(BOLD_ON, line(`HAWSMASH ${payload.store_short_name.toUpperCase()}`), BOLD_OFF);
  if (payload.store_address) {
    for (const addressLine of wrap(payload.store_address)) chunks.push(line(addressLine));
  }
  if (payload.store_phone) chunks.push(line(`Tel: ${payload.store_phone}`));
  chunks.push(ALIGN_LEFT, line(rule('=')));
  chunks.push(line(twoColumns(`PEDIDO ${payload.order_number}`, maputoTime(payload.created_at))));
  chunks.push(line(rule('-')));

  for (const item of payload.items) {
    chunks.push(line(twoColumns(`${item.quantity}x ${item.name}`, formatMT(cents(item.line_total_cents)))));
    if (item.notes) {
      for (const noteLine of wrap(`  Nota: ${item.notes}`)) chunks.push(line(noteLine));
    }
  }

  chunks.push(line(rule('-')));
  chunks.push(line(twoColumns('Subtotal', formatMT(cents(payload.subtotal_cents)))));
  if (payload.delivery_fee_cents > 0) {
    chunks.push(line(twoColumns('Taxa de entrega', formatMT(cents(payload.delivery_fee_cents)))));
  }
  chunks.push(line(rule('=')));
  chunks.push(
    SIZE_DOUBLE,
    BOLD_ON,
    line(`TOTAL ${formatMT(cents(payload.total_cents))}`),
    BOLD_OFF,
    SIZE_NORMAL,
  );
  chunks.push(line(rule('=')));

  for (const payment of payload.payments) {
    chunks.push(line(twoColumns(formatPaymentMethod(payment.method), formatMT(cents(payment.amount_cents)))));
  }
  if (payload.cash_received_cents != null) {
    chunks.push(line(twoColumns('Recebido', formatMT(cents(payload.cash_received_cents)))));
  }
  if (payload.change_cents != null) {
    chunks.push(BOLD_ON, line(twoColumns('Troco', formatMT(cents(payload.change_cents)))), BOLD_OFF);
  }

  if (payload.receipt_footer) {
    chunks.push(feed(1), ALIGN_CENTER);
    for (const footerLine of wrap(payload.receipt_footer)) chunks.push(line(footerLine));
  }
  chunks.push(ALIGN_LEFT, feed(3), CUT_FULL);
  return Buffer.concat(chunks);
}

export function createCashCloseReceipt(payload: CashClosePayload): Buffer {
  const chunks: Buffer[] = [INIT, CODEPAGE_CP1252, ALIGN_CENTER];
  chunks.push(BOLD_ON, line(`HAWSMASH ${payload.store_short_name.toUpperCase()}`), BOLD_OFF);
  chunks.push(SIZE_DOUBLE, BOLD_ON, line('FECHO DE CAIXA'), BOLD_OFF, SIZE_NORMAL);
  chunks.push(line(payload.shift_label), line(`${maputoTime(payload.opened_at)} - ${maputoTime(payload.closed_at)}`));
  chunks.push(ALIGN_LEFT, line(rule('=')));
  chunks.push(line(twoColumns('Fundo inicial', formatMT(cents(payload.opening_float_cents)))));
  chunks.push(line(twoColumns('Vendas dinheiro', formatMT(cents(payload.cash_sales_cents)))));
  chunks.push(line(twoColumns('Sangrias', `-${formatMT(cents(payload.sangria_cents))}`)));
  chunks.push(line(twoColumns('Reforcos', formatMT(cents(payload.reforco_cents)))));
  chunks.push(line(twoColumns('Despesas', `-${formatMT(cents(payload.despesa_cents))}`)));
  chunks.push(line(rule('-')));
  chunks.push(BOLD_ON, line(twoColumns('Esperado na gaveta', formatMT(cents(payload.expected_cash_cents)))), BOLD_OFF);
  chunks.push(line(twoColumns('Contado', formatMT(cents(payload.counted_cash_cents)))));
  chunks.push(
    BOLD_ON,
    line(twoColumns('Diferenca', signedMT(payload.difference_cents))),
    BOLD_OFF,
  );
  chunks.push(line(rule('=')), BOLD_ON, line('PAGAMENTOS'), BOLD_OFF);
  chunks.push(line(twoColumns('Dinheiro', formatMT(cents(payload.payments.cash)))));
  chunks.push(line(twoColumns('M-Pesa', formatMT(cents(payload.payments.mpesa)))));
  chunks.push(line(twoColumns('e-Mola', formatMT(cents(payload.payments.emola)))));
  chunks.push(line(twoColumns('Cartao', formatMT(cents(payload.payments.credit_card)))));
  if (payload.difference_reason) {
    chunks.push(line(rule('-')), BOLD_ON, line('MOTIVO DA DIFERENCA'), BOLD_OFF);
    for (const reasonLine of wrap(payload.difference_reason)) chunks.push(line(reasonLine));
  }
  if (payload.closed_by_name) chunks.push(feed(1), line(`Fechado por: ${payload.closed_by_name}`));
  chunks.push(feed(3), CUT_FULL);
  return Buffer.concat(chunks);
}

export function createPrintDocument(kind: string, payload: PrintPayload): Buffer {
  if (kind === 'order' && isKitchenTicket(payload)) return createKitchenTicket(payload);
  if (kind === 'receipt' && isCustomerReceipt(payload)) return createCustomerReceipt(payload);
  if (kind === 'cash_close' && isCashClosePayload(payload)) return createCashCloseReceipt(payload);
  return createReceipt(payload);
}

export function formatPaymentMethod(method: string): string {
  const map: Record<string, string> = {
    mpesa: "M-Pesa",
    emola: "e-Mola",
    cash: "Dinheiro",
    credit_card: "Cartao",
  };
  return map[method] || method;
}

function formatCurrency(cents: number): string {
  return `${(cents / 100).toFixed(2)} MT`;
}

function paymentLine(job: PrintJobPayload): string {
  // Mesa: a comanda NAO e conta. O pagamento e ato da equipa, no balcao.
  if (job.fulfillment_type === "dine_in") return "[ PAGAR NO BALCAO / A MESA ]";
  if (job.payment_status === "paid") {
    return `[ PAGO VIA ${formatPaymentMethod(job.payment_method).toUpperCase()} ]`;
  }
  return "[ PAGAR NA ENTREGA/LEVANTAMENTO ]";
}

/**
 * Linhas de um item. A nota fica inline -- `2x Frango (sem cebola)` -- porque e
 * o formato de talao ja acordado e impresso hoje; as escolhas (molho,
 * acompanhamentos) sao informacao nova e vao indentadas por baixo.
 */
function itemLines(item: PrintJobPayload["items"][number]): Buffer[] {
  const chunks: Buffer[] = [];
  const variant = item.variant ? ` (${item.variant})` : "";
  const notes = item.notes ? ` (${item.notes})` : "";
  chunks.push(line(`${item.quantity}x ${item.name}${variant}${notes}`));

  for (const mod of item.modifiers ?? []) {
    const names = mod.options.map((o) => o.name).join(", ");
    if (names) chunks.push(line(`   ${mod.group_name}: ${names}`));
  }
  return chunks;
}

/**
 * Itens da comanda. Quando as linhas trazem `person` (pedido de mesa feito por
 * varias pessoas no mesmo telemovel), agrupa por pessoa para a cozinha montar
 * prato a prato e a equipa servir a quem pediu. Sem `person`, lista simples.
 */
function itemsSection(job: PrintJobPayload): Buffer[] {
  const chunks: Buffer[] = [];
  const people: string[] = [];
  for (const item of job.items) {
    if (item.person && !people.includes(item.person)) people.push(item.person);
  }

  if (people.length === 0) {
    chunks.push(line("--- ITENS ---"));
    for (const item of job.items) chunks.push(...itemLines(item));
    return chunks;
  }

  for (const person of people) {
    chunks.push(BOLD_ON, line(`--- ${person.toUpperCase()} ---`), BOLD_OFF);
    for (const item of job.items.filter((i) => i.person === person)) {
      chunks.push(...itemLines(item));
    }
  }

  // Linhas sem pessoa (ex.: algo pedido "para a mesa") vao no fim.
  const shared = job.items.filter((i) => !i.person);
  if (shared.length > 0) {
    chunks.push(BOLD_ON, line("--- PARA A MESA ---"), BOLD_OFF);
    for (const item of shared) chunks.push(...itemLines(item));
  }
  return chunks;
}

export function createReceipt(payload: PrintPayload): Buffer {
  if (isKitchenTicket(payload)) return createKitchenTicket(payload);
  if (isCustomerReceipt(payload)) return createCustomerReceipt(payload);
  if (isTestPayload(payload)) return createTestReceipt(payload);
  const job = payload;
  const chunks: Buffer[] = [];

  chunks.push(INIT, CODEPAGE_CP1252);

  // Cabecalho: no pedido + nome do cliente em destaque
  chunks.push(ALIGN_CENTER, BOLD_ON, line(`Pedido ${job.order_number}`), BOLD_OFF);
  chunks.push(SIZE_DOUBLE, BOLD_ON, line(job.customer_name.toUpperCase()), BOLD_OFF, SIZE_NORMAL);
  chunks.push(feed(1));

  // Fulfillment
  chunks.push(ALIGN_LEFT);
  if (job.fulfillment_type === "dine_in") {
    // Mesa: o numero da mesa e a informacao critica -- vai grande e centrado.
    const mesa = String(job.table_number ?? "").padStart(2, "0");
    chunks.push(ALIGN_CENTER, SIZE_DOUBLE, BOLD_ON, line(`MESA ${mesa}`), BOLD_OFF, SIZE_NORMAL, ALIGN_LEFT);
  } else if (job.fulfillment_type === "delivery") {
    chunks.push(BOLD_ON, line("ENTREGA"), BOLD_OFF);
    if (job.delivery_zone) chunks.push(line(`Zona: ${job.delivery_zone}`));
    if (job.address) chunks.push(line(`Morada: ${job.address}`));
  } else {
    chunks.push(BOLD_ON, line("LEVANTAMENTO"), BOLD_OFF);
  }

  // Agendamento nao se aplica a mesa (e sempre "agora").
  if (job.fulfillment_type !== "dine_in") {
    const schedule = job.scheduled_for
      ? `Horario: ${new Date(job.scheduled_for).toLocaleTimeString("pt-MZ", { hour: "2-digit", minute: "2-digit" })}`
      : "Horario: AGORA (ASAP)";
    chunks.push(line(schedule));
  }
  chunks.push(feed(1));

  // Itens (agrupados por pessoa quando a mesa as identifica)
  chunks.push(...itemsSection(job));
  chunks.push(feed(1));

  // Pagamento
  chunks.push(line("--- PAGAMENTO ---"));
  chunks.push(BOLD_ON, line(paymentLine(job)), BOLD_OFF);
  chunks.push(line(`Total: ${formatCurrency(job.total_cents)}`));

  if (job.notes) {
    chunks.push(feed(1), line("--- NOTAS ---"), line(job.notes));
  }

  chunks.push(feed(1), line(`Hora: ${new Date(job.created_at).toLocaleTimeString("pt-MZ")}`));
  chunks.push(feed(3), CUT_FULL);

  return Buffer.concat(chunks);
}

function createTestReceipt(payload: TestPrintPayload): Buffer {
  const chunks: Buffer[] = [];
  chunks.push(INIT, CODEPAGE_CP1252);
  chunks.push(ALIGN_CENTER, BOLD_ON, line("DELIVERY OS"), BOLD_OFF, feed(1));
  chunks.push(SIZE_DOUBLE, BOLD_ON, line("TESTE"), BOLD_OFF, SIZE_NORMAL, feed(1));
  chunks.push(ALIGN_LEFT, line(payload.message ?? "Teste de impressao -- Delivery OS"));
  chunks.push(line(`Hora: ${new Date().toLocaleTimeString("pt-MZ")}`));
  chunks.push(feed(3), CUT_FULL);
  return Buffer.concat(chunks);
}

export function decodeReceipt(buffer: Buffer): string {
  let out = "";
  let i = 0;
  while (i < buffer.length) {
    const b = buffer[i];
    if (b === ESC) {
      const cmd = buffer[i + 1];
      if (cmd === 0x40) { i += 2; }
      else if (cmd === 0x74 || cmd === 0x61 || cmd === 0x45 || cmd === 0x64) { i += 3; }
      else { i += 2; }
      continue;
    }
    if (b === GS) {
      const cmd = buffer[i + 1];
      if (cmd === 0x21 || cmd === 0x56) { i += 3; }
      else { i += 2; }
      continue;
    }
    out += CP1252_REVERSE[b] ?? Buffer.from([b]).toString("latin1");
    i += 1;
  }
  return out;
}
