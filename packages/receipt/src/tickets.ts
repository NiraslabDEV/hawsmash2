/**
 * Os formatos do papel da casa, como instruções (`ops.ts`).
 *
 * Vieram do `escpos.ts` do print-bridge, onde foram validados em papel. Com o
 * layout de fábrica produzem exactamente os mesmos bytes de antes — guardado
 * por `services/print-bridge/src/__tests__/talao-bytes.test.ts`. Os modelos
 * Compacto e Cozinha (aba POS) são variações do talão completo; os outros
 * formatos (comanda curta, talão curto, fecho de caixa, mesa) não mudam.
 */

import {
  ALIGN_CENTER,
  ALIGN_LEFT,
  BOLD_OFF,
  BOLD_ON,
  BRAND,
  CUT,
  FEED_BEFORE_CUT,
  INIT,
  INIT_LEGACY,
  SIZE_DOUBLE,
  SIZE_NORMAL,
  SIZE_TALL,
  SIZE_TRIPLE,
  WIDTH_DOUBLE,
  feed,
  line,
  maputoTime,
  mt,
  qr,
  rule,
  signedMT,
  twoColumns,
  wrap,
  type Op,
} from './ops';
import { buildCashDayReceipt, isCashDayPayload } from './cash-day';
import { FACTORY_PRINT_LAYOUT, templateForVia, type PrintLayout, type TicketTemplate } from './layout';
import {
  isCashClosePayload,
  isCustomerReceipt,
  isKitchenTicket,
  isTestPayload,
  type CashClosePayload,
  type CustomerReceiptPayload,
  type KitchenTicketPayload,
  type PrintJobPayload,
  type PrintPayload,
  type TestPrintPayload,
} from './types';

function channelLabel(channel: KitchenTicketPayload['channel']): string {
  const labels: Record<KitchenTicketPayload['channel'], string> = {
    counter: 'BALCÃO',
    delivery: 'DELIVERY',
    pickup: 'LEVANTAMENTO',
    dine_in: 'MESA',
  };
  return labels[channel];
}

/**
 * O carimbo grande do talão.
 *
 * Uma entrega vendida ao balcão chega aqui com channel='counter' e
 * fulfillment_type='delivery'. Quem lê o papel — cozinha e entregador — quer
 * saber para onde aquilo vai, não por que porta foi vendido. O channel fica
 * como recurso para os pedidos antigos, que não trazem fulfillment.
 */
function fulfillmentLabel(payload: {
  channel: KitchenTicketPayload['channel'];
  fulfillment_type?: KitchenTicketPayload['fulfillment_type'];
}): string {
  const alvo = payload.fulfillment_type ?? payload.channel;
  if (alvo === 'counter' && payload.channel !== 'counter') return channelLabel(payload.channel);
  return channelLabel(alvo);
}

/**
 * Para onde vai a entrega: nome, telefone, zona e morada.
 *
 * Sem morada não há entrega — e por isso a ausência dela é impressa, em vez de
 * deixar um espaço em branco que ninguém nota.
 */
function deliveryBlock(payload: {
  fulfillment_type?: KitchenTicketPayload['fulfillment_type'];
  customer_name?: string | null;
  customer_phone?: string | null;
  delivery_zone?: string | null;
  address?: string | null;
}): Op[] {
  if (payload.fulfillment_type !== 'delivery') return [];
  const ops: Op[] = [line(rule('-')), BOLD_ON, line('ENTREGA'), BOLD_OFF];
  if (payload.customer_name) ops.push(line(`Cliente: ${payload.customer_name}`));
  if (payload.customer_phone) ops.push(line(`Tel: ${payload.customer_phone}`));
  if (payload.delivery_zone) ops.push(line(`Zona: ${payload.delivery_zone}`));
  if (payload.address) {
    for (const moradaLinha of wrap(`Morada: ${payload.address}`)) ops.push(line(moradaLinha));
  } else {
    ops.push(BOLD_ON, line('MORADA: A CONFIRMAR POR TELEFONE'), BOLD_OFF);
  }
  return ops;
}

/**
 * O cabeçalho da casa: logo (ou nome da marca) e o nome da loja por baixo.
 * Quem imprime decide o que o `BRAND` é — o logo é ficheiro da instalação.
 */
function brandHeader(storeShortName: string, withBrand = true): Op[] {
  const ops: Op[] = [INIT, ALIGN_CENTER];
  if (withBrand) ops.push(BRAND);
  ops.push(BOLD_ON, line(storeShortName.toUpperCase()), BOLD_OFF);
  return ops;
}

/**
 * A hora marcada, em corpo duplo: um agendamento que passa despercebido no
 * meio do talão vira comida feita à hora errada.
 */
function scheduleBlock(scheduledFor?: string | null): Op[] {
  if (!scheduledFor) return [];
  return [
    line(rule('-')),
    line('HORARIO:'),
    SIZE_DOUBLE, BOLD_ON, line(maputoTime(scheduledFor)), BOLD_OFF, SIZE_NORMAL,
  ];
}

// Primeiro nome, capitalizado ("MARIA ALBERTINA" -> "Maria"): o rodapé fala
// com o cliente pelo nome.
function firstName(full: string | null | undefined): string {
  const palavra = String(full ?? '').trim().split(/\s+/)[0] ?? '';
  return palavra ? palavra.charAt(0).toUpperCase() + palavra.slice(1).toLowerCase() : '';
}

const VIA_LABEL: Record<string, string> = {
  controlo: '*** VIA DE CONTROLO ***',
  cliente: '*** VIA DO CLIENTE ***',
  cozinha: '*** VIA DA COZINHA ***',
  reimpressao: '*** REIMPRESSÃO ***',
  alteracao: '*** PEDIDO ALTERADO ***',
};

// O que mudou, como o entregador o lê: "MUDOU: MORADA + HORA".
const ALTERACAO_LABEL: Record<string, string> = {
  address: 'MORADA',
  scheduled_for: 'HORA',
};

export function formatPaymentMethod(method: string): string {
  const map: Record<string, string> = {
    mpesa: 'M-Pesa',
    emola: 'e-Mola',
    cash: 'Dinheiro',
    credit_card: 'Cartao',
  };
  return map[method] || method;
}

/** O que cada modelo do talão completo leva. */
interface FullTicketOptions {
  brand: boolean;
  contacts: boolean;
  /** Preços, totais e pagamento. */
  prices: boolean;
  /** Artigos em altura dupla, com preço (Completo). */
  bigItems: boolean;
  /** Artigos e notas a dobrar, sem preço (Cozinha). */
  kitchenItems: boolean;
  thanks: boolean;
  qr: boolean;
  footer: boolean;
}

function optionsFor(template: TicketTemplate, layout: PrintLayout): FullTicketOptions {
  if (template === 'cozinha') {
    return {
      brand: false, contacts: false, prices: false, bigItems: false,
      kitchenItems: true, thanks: false, qr: false, footer: false,
    };
  }
  if (template === 'compacto') {
    return {
      brand: false, contacts: false, prices: true, bigItems: false,
      kitchenItems: false, thanks: false, qr: false, footer: layout.show.footer,
    };
  }
  return {
    brand: layout.show.logo,
    contacts: layout.show.storeContacts,
    prices: true,
    bigItems: layout.bigItems,
    kitchenItems: false,
    thanks: layout.show.thanks,
    qr: layout.show.qr,
    footer: layout.show.footer,
  };
}

/**
 * O talão da casa, em vias, para todos os pedidos.
 *
 * Sai em vias com o mesmo conteúdo e um rótulo diferente: a VIA DE CONTROLO
 * fica na loja, a VIA DO CLIENTE vai para a cozinha e depois cola-se no saco.
 * O rótulo é o que impede que alguém entregue a errada — e o que marca uma
 * REIMPRESSÃO, para não passar por original (§7.4). O modelo de cada via é da
 * loja (aba POS): Completo, Compacto ou Cozinha.
 *
 * Tudo o que é da marca (morada, telefone, Instagram, link de avaliação)
 * chega no payload, da base de dados (§18.2).
 */
export function buildFullTicket(payload: KitchenTicketPayload, layout: PrintLayout = FACTORY_PRINT_LAYOUT): Op[] {
  const o = optionsFor(templateForVia(layout, payload.via), layout);
  const ops: Op[] = brandHeader(payload.store_short_name, o.brand);
  if (o.contacts) {
    if (payload.store_address) {
      for (const moradaLinha of wrap(payload.store_address)) ops.push(line(moradaLinha));
    }
    if (payload.store_phone) ops.push(line(`Tel: ${payload.store_phone}`));
  }
  ops.push(ALIGN_LEFT, line(rule('=')));

  const via = payload.via ? VIA_LABEL[payload.via] : undefined;
  if (via) {
    ops.push(ALIGN_CENTER, BOLD_ON, line(via), BOLD_OFF);
    const mudou = (payload.alteracoes ?? [])
      .map((campo) => ALTERACAO_LABEL[campo])
      .filter(Boolean);
    if (payload.via === 'alteracao' && mudou.length > 0) {
      ops.push(line(`MUDOU: ${mudou.join(' + ')}`));
    }
    ops.push(ALIGN_LEFT, line(rule('=')));
  }

  ops.push(line(twoColumns(`PEDIDO: ${payload.order_number}`, maputoTime(payload.created_at))));
  ops.push(ALIGN_CENTER, line('SENHA'));
  ops.push(SIZE_TRIPLE, BOLD_ON, line(`${payload.daily_number}`), BOLD_OFF, SIZE_NORMAL);
  ops.push(ALIGN_LEFT, line(rule('=')));

  // Uma venda de balcão sem nome não tem bloco de cliente: não se imprime
  // "CLIENTE:" vazio, nem o nome de ninguém inventado.
  if (payload.customer_name || payload.customer_phone) {
    if (payload.customer_name) {
      ops.push(BOLD_ON);
      for (const nomeLinha of wrap(`CLIENTE: ${payload.customer_name.toUpperCase()}`)) {
        ops.push(line(nomeLinha));
      }
      ops.push(BOLD_OFF);
    }
    if (payload.customer_phone) ops.push(line(`TEL: ${payload.customer_phone}`));
    ops.push(line(rule('=')));
  }

  if (payload.fulfillment_type === 'counter') {
    ops.push(BOLD_ON, line('** BALCÃO **'), BOLD_OFF);
  } else if (payload.fulfillment_type === 'delivery') {
    ops.push(BOLD_ON, line('** ENTREGA **'), BOLD_OFF);
    if (payload.delivery_zone) ops.push(line(`Zona: ${payload.delivery_zone}`));
    if (payload.address) {
      for (const moradaLinha of wrap(`Morada: ${payload.address}`)) ops.push(line(moradaLinha));
    } else {
      ops.push(BOLD_ON, line('MORADA: A CONFIRMAR POR TELEFONE'), BOLD_OFF);
    }
  } else {
    ops.push(BOLD_ON, line('** LEVANTAMENTO **'), BOLD_OFF);
    ops.push(line('Levantamento no balcao'));
  }
  // O horário em bloco próprio e grande: "agora" e "às 20h" entram na mesma
  // fila, e trocá-los é o erro mais caro da cozinha.
  ops.push(line('HORARIO:'));
  ops.push(
    SIZE_DOUBLE,
    BOLD_ON,
    line(payload.scheduled_for ? maputoTime(payload.scheduled_for) : 'AGORA'),
    BOLD_OFF,
    SIZE_NORMAL,
  );
  ops.push(line(rule('=')));

  if (o.kitchenItems) {
    // Modelo Cozinha: lido de pé, a um ou dois metros. Artigos e notas a
    // dobrar, como na comanda do varão; a dobrar só cabem 24 colunas.
    for (const item of payload.items) {
      ops.push(SIZE_DOUBLE, BOLD_ON);
      for (const itemLinha of wrap(`${item.quantity}x ${item.name}`, WIDTH_DOUBLE)) ops.push(line(itemLinha));
      ops.push(BOLD_OFF, SIZE_NORMAL);
      if (item.notes) {
        ops.push(SIZE_DOUBLE, BOLD_ON);
        for (const notaLinha of wrap(`NOTA: ${item.notes}`, WIDTH_DOUBLE)) ops.push(line(notaLinha));
        ops.push(BOLD_OFF, SIZE_NORMAL);
      }
      ops.push(feed(1));
    }
  } else {
    ops.push(line(twoColumns('Descricao', 'Total')));
    ops.push(line(rule('-')));
    for (const item of payload.items) {
      const total = item.line_total_cents != null ? mt(item.line_total_cents) : '';
      const artigo = line(twoColumns(`${item.quantity}x ${item.name}`, total));
      if (o.bigItems) ops.push(BOLD_ON, SIZE_TALL, artigo, SIZE_NORMAL, BOLD_OFF);
      else ops.push(BOLD_ON, artigo, BOLD_OFF);
      if (item.notes) {
        for (const notaLinha of wrap(`  > ${item.notes}`)) ops.push(line(notaLinha));
      }
    }
  }
  ops.push(line(rule('=')));

  if (payload.notes) {
    if (o.kitchenItems) {
      ops.push(SIZE_DOUBLE, BOLD_ON);
      for (const notaLinha of wrap(`NOTA DO PEDIDO: ${payload.notes}`, WIDTH_DOUBLE)) ops.push(line(notaLinha));
      ops.push(BOLD_OFF, SIZE_NORMAL, line(rule('=')));
    } else {
      ops.push(BOLD_ON, line('** NOTA DO CLIENTE **'), BOLD_OFF);
      for (const notaLinha of wrap(payload.notes)) ops.push(line(notaLinha));
      ops.push(line(rule('=')));
    }
  }

  if (o.prices) {
    if (payload.subtotal_cents != null) {
      ops.push(line(twoColumns('Subtotal:', mt(payload.subtotal_cents))));
    }
    if (payload.fulfillment_type === 'delivery' && (payload.delivery_fee_cents ?? 0) > 0) {
      ops.push(line(twoColumns('Taxa de entrega:', mt(payload.delivery_fee_cents ?? 0))));
    }
    if ((payload.discount_cents ?? 0) > 0) {
      ops.push(line(twoColumns('Desconto:', signedMT(-(payload.discount_cents ?? 0)))));
    }
    if (payload.total_cents != null) {
      ops.push(line(rule('=')));
      ops.push(
        ALIGN_CENTER,
        SIZE_DOUBLE,
        BOLD_ON,
        line(`TOTAL: ${mt(payload.total_cents)}`),
        BOLD_OFF,
        SIZE_NORMAL,
        ALIGN_LEFT,
      );
    }
    ops.push(line(rule('=')));

    // Pagamento. No balcão pode ser misto e em dinheiro há troco: o selo
    // junta os métodos.
    const pagamentos = (payload.payments ?? []).filter((p) => p.amount_cents > 0);
    if (pagamentos.length > 1) {
      for (const pagamento of pagamentos) {
        ops.push(line(twoColumns(formatPaymentMethod(pagamento.method), mt(pagamento.amount_cents))));
      }
    }
    if (payload.cash_received_cents != null) {
      ops.push(line(twoColumns('Recebido', mt(payload.cash_received_cents))));
    }
    if (payload.change_cents != null && payload.change_cents > 0) {
      ops.push(BOLD_ON, line(twoColumns('Troco', mt(payload.change_cents))), BOLD_OFF);
    }
    const metodos = pagamentos.length > 0
      ? pagamentos.map((p) => formatPaymentMethod(p.method).toUpperCase())
      : payload.payment_method
        ? [formatPaymentMethod(payload.payment_method).toUpperCase()]
        : [];
    if (metodos.length > 0) {
      const selo = metodos.length > 1 ? `[ PAGO: ${metodos.join(' + ')} ]` : `[ PAGO VIA ${metodos[0]} ]`;
      ops.push(ALIGN_CENTER, BOLD_ON);
      for (const seloLinha of wrap(selo)) ops.push(line(seloLinha));
      ops.push(BOLD_OFF, ALIGN_LEFT, line(rule('=')));
    }
  }

  const nome = firstName(payload.customer_name);
  if (o.thanks || o.qr || o.footer) ops.push(ALIGN_CENTER);
  if (o.thanks) {
    ops.push(BOLD_ON);
    ops.push(line(nome ? `Obrigado! Bom apetite, ${nome}!` : 'Obrigado! Bom apetite!'));
    ops.push(BOLD_OFF, feed(1));
  }
  if (o.qr) {
    if (payload.review_url) {
      ops.push(line(nome ? `${nome}, pode avaliar-nos no Google?` : 'Pode avaliar-nos no Google?'));
      ops.push(line('Vai fazer muita diferença para nós.'));
      ops.push(line('Scaneia rapidinho o QR code:'), feed(1));
      ops.push(qr(payload.review_url, 5), feed(1));
      ops.push(line(nome ? `Obrigado mais uma vez, ${nome}. Até à próxima!` : 'Obrigado mais uma vez. Até à próxima!'));
      if (payload.instagram) {
        ops.push(feed(1), line('Siga-nos no Instagram:'), BOLD_ON, line(payload.instagram), BOLD_OFF);
      }
    } else if (payload.instagram_url) {
      ops.push(line(nome ? `${nome}, siga-nos no Instagram:` : 'Siga-nos no Instagram:'));
      if (payload.instagram) ops.push(BOLD_ON, line(payload.instagram), BOLD_OFF);
      ops.push(feed(1), qr(payload.instagram_url, 5), feed(1));
    }
  }
  if (o.footer && payload.receipt_footer) {
    ops.push(feed(1));
    for (const rodapeLinha of wrap(payload.receipt_footer)) ops.push(line(rodapeLinha));
  }

  ops.push(ALIGN_LEFT, feed(FEED_BEFORE_CUT), CUT);
  return ops;
}

/**
 * A comanda da cozinha (formato curto: mesa e POS sem rede).
 *
 * Vai PENDURADA no varão e é lida a um ou dois metros, de lado, por quem tem
 * as mãos ocupadas. O número do dia a triplo, artigos e notas a dobrar.
 * Com `formato: 'talao_completo'` sai o talão da casa, no modelo da via.
 */
export function buildKitchenTicket(payload: KitchenTicketPayload, layout: PrintLayout = FACTORY_PRINT_LAYOUT): Op[] {
  if (payload.formato === 'talao_completo') return buildFullTicket(payload, layout);

  const ops: Op[] = brandHeader(payload.store_short_name);
  ops.push(SIZE_TRIPLE, BOLD_ON, line(`Nº ${payload.daily_number}`), BOLD_OFF, SIZE_NORMAL);
  ops.push(SIZE_DOUBLE, BOLD_ON, line(fulfillmentLabel(payload)), BOLD_OFF, SIZE_NORMAL);
  ops.push(line(maputoTime(payload.created_at)), ALIGN_LEFT, line(rule('=')));
  ops.push(...scheduleBlock(payload.scheduled_for));
  ops.push(...deliveryBlock(payload));

  for (const item of payload.items) {
    ops.push(SIZE_DOUBLE, BOLD_ON);
    for (const itemLine of wrap(`${item.quantity}x ${item.name}`, WIDTH_DOUBLE)) {
      ops.push(line(itemLine));
    }
    ops.push(BOLD_OFF, SIZE_NORMAL);
    // "SEM JALAPENO" é a linha que estraga o prato se passar ao lado. Sai do
    // mesmo tamanho do artigo a que pertence.
    if (item.notes) {
      ops.push(SIZE_DOUBLE, BOLD_ON);
      for (const noteLine of wrap(`NOTA: ${item.notes}`, WIDTH_DOUBLE)) ops.push(line(noteLine));
      ops.push(BOLD_OFF, SIZE_NORMAL);
    }
    ops.push(feed(1));
  }
  if (payload.notes) {
    ops.push(line(rule('-')), SIZE_DOUBLE, BOLD_ON);
    for (const noteLine of wrap(`NOTA DO PEDIDO: ${payload.notes}`, WIDTH_DOUBLE)) {
      ops.push(line(noteLine));
    }
    ops.push(BOLD_OFF, SIZE_NORMAL);
  }

  ops.push(line(rule('=')), feed(FEED_BEFORE_CUT), CUT);
  return ops;
}

export function buildCustomerReceipt(payload: CustomerReceiptPayload): Op[] {
  const ops: Op[] = brandHeader(payload.store_short_name);
  if (payload.store_address) {
    for (const addressLine of wrap(payload.store_address)) ops.push(line(addressLine));
  }
  if (payload.store_phone) ops.push(line(`Tel: ${payload.store_phone}`));

  // A SENHA — o número que se chama ao balcão e que aparece na TV (§5.4).
  ops.push(line(rule('-')));
  ops.push(line('SENHA'));
  ops.push(SIZE_TRIPLE, BOLD_ON, line(`${payload.daily_number}`), BOLD_OFF, SIZE_NORMAL);

  ops.push(ALIGN_LEFT, line(rule('=')));
  ops.push(line(twoColumns(`PEDIDO ${payload.order_number}`, maputoTime(payload.created_at))));
  ops.push(...scheduleBlock(payload.scheduled_for));
  ops.push(...deliveryBlock(payload));
  ops.push(line(rule('-')));

  for (const item of payload.items) {
    ops.push(line(twoColumns(`${item.quantity}x ${item.name}`, mt(item.line_total_cents))));
    if (item.notes) {
      for (const noteLine of wrap(`  Nota: ${item.notes}`)) ops.push(line(noteLine));
    }
  }

  ops.push(line(rule('-')));
  ops.push(line(twoColumns('Subtotal', mt(payload.subtotal_cents))));
  if (payload.delivery_fee_cents > 0) {
    ops.push(line(twoColumns('Taxa de entrega', mt(payload.delivery_fee_cents))));
  }
  ops.push(line(rule('=')));
  ops.push(SIZE_DOUBLE, BOLD_ON, line(`TOTAL ${mt(payload.total_cents)}`), BOLD_OFF, SIZE_NORMAL);
  ops.push(line(rule('=')));

  for (const payment of payload.payments) {
    ops.push(line(twoColumns(formatPaymentMethod(payment.method), mt(payment.amount_cents))));
  }
  if (payload.cash_received_cents != null) {
    ops.push(line(twoColumns('Recebido', mt(payload.cash_received_cents))));
  }
  if (payload.change_cents != null) {
    ops.push(BOLD_ON, line(twoColumns('Troco', mt(payload.change_cents))), BOLD_OFF);
  }

  if (payload.receipt_footer) {
    ops.push(feed(1), ALIGN_CENTER);
    for (const footerLine of wrap(payload.receipt_footer)) ops.push(line(footerLine));
  }
  ops.push(ALIGN_LEFT, feed(FEED_BEFORE_CUT), CUT);
  return ops;
}

export function buildCashCloseReceipt(payload: CashClosePayload): Op[] {
  // O fecho do dia (1091) chega pela mesma fila, com os turnos dentro.
  if (isCashDayPayload(payload)) return buildCashDayReceipt(payload, brandHeader(payload.store_short_name));
  // O fecho de caixa vai para o dono e para o arquivo: leva a marca.
  const ops: Op[] = brandHeader(payload.store_short_name);
  ops.push(SIZE_DOUBLE, BOLD_ON, line('FECHO DE CAIXA'), BOLD_OFF, SIZE_NORMAL);
  ops.push(line(payload.shift_label), line(`${maputoTime(payload.opened_at)} - ${maputoTime(payload.closed_at)}`));
  ops.push(ALIGN_LEFT, line(rule('=')));
  ops.push(line(twoColumns('Fundo inicial', mt(payload.opening_float_cents))));
  ops.push(line(twoColumns('Vendas dinheiro', mt(payload.cash_sales_cents))));
  ops.push(line(twoColumns('Sangrias', `-${mt(payload.sangria_cents)}`)));
  ops.push(line(twoColumns('Reforcos', mt(payload.reforco_cents))));
  ops.push(line(twoColumns('Despesas', `-${mt(payload.despesa_cents)}`)));
  ops.push(line(rule('-')));
  ops.push(BOLD_ON, line(twoColumns('Esperado na gaveta', mt(payload.expected_cash_cents))), BOLD_OFF);
  ops.push(line(twoColumns('Contado', mt(payload.counted_cash_cents))));
  ops.push(BOLD_ON, line(twoColumns('Diferenca', signedMT(payload.difference_cents))), BOLD_OFF);
  ops.push(line(rule('=')), BOLD_ON, line('PAGAMENTOS'), BOLD_OFF);
  ops.push(line(twoColumns('Dinheiro', mt(payload.payments.cash))));
  ops.push(line(twoColumns('M-Pesa', mt(payload.payments.mpesa))));
  ops.push(line(twoColumns('e-Mola', mt(payload.payments.emola))));
  ops.push(line(twoColumns('Cartao', mt(payload.payments.credit_card))));
  if (payload.difference_reason) {
    ops.push(line(rule('-')), BOLD_ON, line('MOTIVO DA DIFERENCA'), BOLD_OFF);
    for (const reasonLine of wrap(payload.difference_reason)) ops.push(line(reasonLine));
  }
  if (payload.closed_by_name) ops.push(feed(1), line(`Fechado por: ${payload.closed_by_name}`));
  ops.push(feed(FEED_BEFORE_CUT), CUT);
  return ops;
}

function formatCurrency(value: number): string {
  return `${(value / 100).toFixed(2)} MT`;
}

function paymentLine(job: PrintJobPayload): string {
  // Mesa: a comanda NÃO é conta. O pagamento é acto da equipa, no balcão.
  if (job.fulfillment_type === 'dine_in') return '[ PAGAR NO BALCAO / A MESA ]';
  if (job.payment_status === 'paid') {
    return `[ PAGO VIA ${formatPaymentMethod(job.payment_method).toUpperCase()} ]`;
  }
  return '[ PAGAR NA ENTREGA/LEVANTAMENTO ]';
}

/**
 * Linhas de um item. A nota fica inline — `2x Frango (sem cebola)` — porque é
 * o formato de talão já acordado; as escolhas vão indentadas por baixo.
 */
function itemLines(item: PrintJobPayload['items'][number]): Op[] {
  const ops: Op[] = [];
  const variant = item.variant ? ` (${item.variant})` : '';
  const notes = item.notes ? ` (${item.notes})` : '';
  ops.push(line(`${item.quantity}x ${item.name}${variant}${notes}`));

  for (const mod of item.modifiers ?? []) {
    const names = mod.options.map((o) => o.name).join(', ');
    if (names) ops.push(line(`   ${mod.group_name}: ${names}`));
  }
  return ops;
}

/**
 * Itens da comanda de mesa, agrupados por pessoa quando as linhas o trazem,
 * para a cozinha montar prato a prato e a equipa servir a quem pediu.
 */
function itemsSection(job: PrintJobPayload): Op[] {
  const ops: Op[] = [];
  const people: string[] = [];
  for (const item of job.items) {
    if (item.person && !people.includes(item.person)) people.push(item.person);
  }

  if (people.length === 0) {
    ops.push(line('--- ITENS ---'));
    for (const item of job.items) ops.push(...itemLines(item));
    return ops;
  }

  for (const person of people) {
    ops.push(BOLD_ON, line(`--- ${person.toUpperCase()} ---`), BOLD_OFF);
    for (const item of job.items.filter((i) => i.person === person)) {
      ops.push(...itemLines(item));
    }
  }

  // Linhas sem pessoa (ex.: algo pedido "para a mesa") vão no fim.
  const shared = job.items.filter((i) => !i.person);
  if (shared.length > 0) {
    ops.push(BOLD_ON, line('--- PARA A MESA ---'), BOLD_OFF);
    for (const item of shared) ops.push(...itemLines(item));
  }
  return ops;
}

function buildTestReceipt(payload: TestPrintPayload): Op[] {
  return [
    INIT_LEGACY,
    ALIGN_CENTER, BOLD_ON, line('DELIVERY OS'), BOLD_OFF, feed(1),
    SIZE_DOUBLE, BOLD_ON, line('TESTE'), BOLD_OFF, SIZE_NORMAL, feed(1),
    ALIGN_LEFT, line(payload.message ?? 'Teste de impressao -- Delivery OS'),
    line(`Hora: ${new Date().toLocaleTimeString('pt-MZ', { timeZone: 'Africa/Maputo' })}`),
    feed(FEED_BEFORE_CUT), CUT,
  ];
}

/** Qualquer payload conhecido; o que não se reconhece sai no formato herdado. */
export function buildReceipt(payload: PrintPayload, layout: PrintLayout = FACTORY_PRINT_LAYOUT): Op[] {
  if (isKitchenTicket(payload)) return buildKitchenTicket(payload, layout);
  if (isCustomerReceipt(payload)) return buildCustomerReceipt(payload);
  if (isCashClosePayload(payload)) return buildCashCloseReceipt(payload);
  if (isTestPayload(payload)) return buildTestReceipt(payload);
  const job = payload;
  const ops: Op[] = [INIT_LEGACY];

  // Cabeçalho: nº do pedido + nome do cliente em destaque
  ops.push(ALIGN_CENTER, BOLD_ON, line(`Pedido ${job.order_number}`), BOLD_OFF);
  ops.push(SIZE_DOUBLE, BOLD_ON, line(job.customer_name.toUpperCase()), BOLD_OFF, SIZE_NORMAL);
  ops.push(feed(1));

  ops.push(ALIGN_LEFT);
  if (job.fulfillment_type === 'dine_in') {
    // Mesa: o número da mesa é a informação crítica — vai grande e centrado.
    const mesa = String(job.table_number ?? '').padStart(2, '0');
    ops.push(ALIGN_CENTER, SIZE_DOUBLE, BOLD_ON, line(`MESA ${mesa}`), BOLD_OFF, SIZE_NORMAL, ALIGN_LEFT);
  } else if (job.fulfillment_type === 'delivery') {
    ops.push(BOLD_ON, line('ENTREGA'), BOLD_OFF);
    if (job.delivery_zone) ops.push(line(`Zona: ${job.delivery_zone}`));
    if (job.address) ops.push(line(`Morada: ${job.address}`));
  } else {
    ops.push(BOLD_ON, line('LEVANTAMENTO'), BOLD_OFF);
  }

  // Agendamento não se aplica a mesa (é sempre "agora").
  if (job.fulfillment_type !== 'dine_in') {
    const schedule = job.scheduled_for
      ? `Horario: ${new Date(job.scheduled_for).toLocaleTimeString('pt-MZ', { timeZone: 'Africa/Maputo', hour: '2-digit', minute: '2-digit' })}`
      : 'Horario: AGORA (ASAP)';
    ops.push(line(schedule));
  }
  ops.push(feed(1));

  ops.push(...itemsSection(job));
  ops.push(feed(1));

  ops.push(line('--- PAGAMENTO ---'));
  ops.push(BOLD_ON, line(paymentLine(job)), BOLD_OFF);
  ops.push(line(`Total: ${formatCurrency(job.total_cents)}`));

  if (job.notes) {
    ops.push(feed(1), line('--- NOTAS ---'), line(job.notes));
  }

  ops.push(feed(1), line(`Hora: ${new Date(job.created_at).toLocaleTimeString('pt-MZ', { timeZone: 'Africa/Maputo' })}`));
  ops.push(feed(FEED_BEFORE_CUT), CUT);
  return ops;
}

/** O documento de um trabalho de impressão, pelo `kind` da fila. */
export function buildPrintDocument(
  kind: string,
  payload: PrintPayload,
  layout: PrintLayout = FACTORY_PRINT_LAYOUT,
): Op[] {
  if (kind === 'order' && isKitchenTicket(payload)) return buildKitchenTicket(payload, layout);
  if (kind === 'receipt' && isCustomerReceipt(payload)) return buildCustomerReceipt(payload);
  if (kind === 'cash_close' && isCashClosePayload(payload)) return buildCashCloseReceipt(payload);
  return buildReceipt(payload, layout);
}
