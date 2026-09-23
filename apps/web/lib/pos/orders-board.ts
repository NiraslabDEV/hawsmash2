/**
 * O quadro de pedidos do balcão (kanban).
 *
 * Quem gere as entregas no HAWSMASH é o caixa, do POS, sem sair do terminal —
 * e por isso o quadro vive aqui e não só no painel de administração.
 *
 * A regra do desenho é uma só: **um toque avança um pedido**. Nada de arrastar
 * cartões num ecrã táctil com o dedo cheio de gordura, nada de menus. A seta do
 * cartão diz para onde vai e leva-o lá. O que o operador tem de decidir é se o
 * pedido avançou na vida real; o resto é ruído.
 *
 * Este módulo é a parte que se testa sem browser: que colunas existem, em que
 * coluna cai cada pedido, e que evento o faz saltar para a seguinte.
 */

export type OrderStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'awaiting_payment'
  | 'approved'
  | 'paid'
  | 'in_preparation'
  | 'ready'
  | 'delivered'
  | 'cancelled';

export type OrderEvent = 'APPROVE' | 'START_PREPARATION' | 'MARK_READY' | 'DELIVER' | 'CANCEL';

export type BoardColumnId = 'online' | 'incoming' | 'preparing' | 'ready';

export type BoardOrder = {
  id: string;
  daily_number: number | null;
  order_number: string;
  status: OrderStatus;
  channel: string;
  fulfillment_type: string;
  customer_name: string | null;
  customer_phone: string | null;
  total_cents: number;
  scheduled_for: string | null;
  created_at: string;
  /** Como o cliente disse que paga — o caixa precisa disto para conferir. */
  payment_method: string | null;
  /** Caminho no bucket privado. Nunca é um url: abre-se assinado, à parte. */
  payment_proof_path: string | null;
  flow: string | null;
  /** Entregas: o que o caixa pode mudar quando o cliente liga (1072). */
  address: string | null;
  delivery_zone_id: string | null;
  delivery_fee_cents: number;
};

/** As colunas que o quadro lê. Uma só definição, para o teste medir o mesmo. */
export const BOARD_SELECT =
  'id,daily_number,order_number,status,channel,fulfillment_type,' +
  'customer_name,customer_phone,total_cents,scheduled_for,created_at,' +
  'payment_method,payment_proof_path,flow,address,delivery_zone_id,delivery_fee_cents';

export const BOARD_STATUSES: OrderStatus[] = [
  'awaiting_approval',
  'awaiting_payment',
  'approved',
  'paid',
  'in_preparation',
  'ready',
];

export const BOARD_LIMIT = 120;

/**
 * **Os mais recentes primeiro — e isto não é detalhe.**
 *
 * O quadro mostra por ordem de entrada (o `buildBoard` trata disso, em
 * memória), mas o tecto de linhas tem de cortar pelo lado certo. Lido por
 * ordem crescente, o tecto ficava com os mais ANTIGOS: com 355 pedidos activos
 * numa loja, a encomenda que acabou de entrar não chegava ao ecrã — sem erro e
 * sem aviso, só um quadro cheio de pedidos velhos e o cliente à espera.
 *
 * Lido por ordem decrescente, o que cabe é sempre o que interessa.
 */
export const BOARD_ORDER = { column: 'created_at', ascending: false } as const;

export type BoardColumn = {
  id: BoardColumnId;
  title: string;
  /**
   * A cor muda com a coluna de propósito: quem olha o quadro de longe tem de
   * saber onde está a pressão sem ler uma palavra. Âmbar espera, azul está a
   * ser feito, verde está à espera de sair. Violeta é a internet: pedidos que
   * ainda esperam uma decisão de quem está ao balcão.
   */
  tone: 'violet' | 'amber' | 'blue' | 'green';
  orders: BoardOrder[];
};

/**
 * A primeira coluna é a da internet: o que chegou do site e ainda não entrou na
 * cozinha. Só pedidos online vivem nestes dois estados — o balcão nasce `paid`.
 * Aprovado (ou pago pelo gateway), o pedido passa para A FAZER.
 */
const COLUMN_OF_STATUS: Partial<Record<OrderStatus, BoardColumnId>> = {
  awaiting_approval: 'online',
  awaiting_payment: 'online',
  approved: 'incoming',
  paid: 'incoming',
  in_preparation: 'preparing',
  ready: 'ready',
};

/** Em que coluna cai este pedido. `null` = já saiu do quadro (entregue/anulado). */
export function columnOf(status: OrderStatus): BoardColumnId | null {
  return COLUMN_OF_STATUS[status] ?? null;
}

/**
 * O que acontece quando o caixa toca na seta.
 *
 * `awaiting_payment` não tem seta: um pedido por pagar não avança por decisão
 * de quem está ao balcão — avança quando o dinheiro entra. Mostrar-lhe uma seta
 * seria convidar a mandar comida para a rua sem ter recebido.
 */
export function nextStep(
  status: OrderStatus,
): { event: OrderEvent; label: string } | null {
  switch (status) {
    case 'awaiting_approval':
      return { event: 'APPROVE', label: 'Aprovar' };
    case 'approved':
    case 'paid':
      return { event: 'START_PREPARATION', label: 'Preparar' };
    case 'in_preparation':
      return { event: 'MARK_READY', label: 'Pronto' };
    case 'ready':
      return { event: 'DELIVER', label: 'Entregue' };
    default:
      return null;
  }
}

/**
 * Os pedidos do dia por coluna.
 *
 * A ordem dentro da coluna é pela hora marcada quando existe, e pela hora de
 * entrada quando não — um pedido agendado para as 20h não pode andar à frente
 * de um que é para agora só porque foi registado primeiro.
 */
export function buildBoard(orders: BoardOrder[]): BoardColumn[] {
  const colunas: BoardColumn[] = [
    { id: 'online', title: 'INTERNET', tone: 'violet', orders: [] },
    { id: 'incoming', title: 'A FAZER', tone: 'amber', orders: [] },
    { id: 'preparing', title: 'EM PREPARO', tone: 'blue', orders: [] },
    { id: 'ready', title: 'PRONTO', tone: 'green', orders: [] },
  ];
  const porId = new Map(colunas.map((coluna) => [coluna.id, coluna]));

  for (const order of orders) {
    const alvo = columnOf(order.status);
    if (!alvo) continue;
    porId.get(alvo)?.orders.push(order);
  }

  for (const coluna of colunas) {
    coluna.orders.sort((a, b) => scheduleKey(a).localeCompare(scheduleKey(b)));
  }
  return colunas;
}

function scheduleKey(order: BoardOrder): string {
  return order.scheduled_for ?? order.created_at;
}

/** Está agendado para mais tarde, e não para agora? */
export function isScheduled(order: BoardOrder, now = Date.now()): boolean {
  if (!order.scheduled_for) return false;
  return new Date(order.scheduled_for).getTime() - now > 60_000;
}

/**
 * Um pedido cuja hora marcada já passou e que ainda não está pronto.
 *
 * É o único alarme do quadro. Vale mais do que parece: um agendamento que
 * ninguém viu passar é um cliente a chegar à porta e a esperar de pé.
 */
export function isLate(order: BoardOrder, now = Date.now()): boolean {
  if (!order.scheduled_for) return false;
  if (order.status === 'ready' || order.status === 'delivered') return false;
  return new Date(order.scheduled_for).getTime() < now;
}

const FULFILLMENT_LABEL: Record<string, string> = {
  delivery: 'ENTREGA',
  pickup: 'LEVANTAMENTO',
};

export function fulfillmentLabel(order: BoardOrder): string {
  if (order.channel === 'counter' && order.fulfillment_type !== 'delivery') return 'BALCÃO';
  return FULFILLMENT_LABEL[order.fulfillment_type] ?? order.fulfillment_type.toUpperCase();
}

const PAYMENT_LABEL: Record<string, string> = {
  mpesa: 'M-PESA',
  emola: 'E-MOLA',
  cash: 'DINHEIRO',
  card: 'CARTÃO',
  credit_card: 'CARTÃO',
};

export function paymentLabel(order: BoardOrder): string {
  if (!order.payment_method) return '—';
  return PAYMENT_LABEL[order.payment_method] ?? order.payment_method.toUpperCase();
}

/**
 * O que dizer ao caixa quando um pedido não avança.
 *
 * Até aqui o quadro dizia sempre "esse pedido já mudou de estado" — e a 23 Set
 * isso mentiu: o pedido não tinha mudado nada, faltava cheddar na loja, e a
 * aprovação (que desconta a ficha técnica na mesma transacção, §10.1)
 * reverteu. O caixa carregou em Aprovar, nada aconteceu, e o ecrã deu-lhe a
 * razão errada.
 *
 * `mudouDeEstado` diz se o pedido foi mexido noutro sítio (e a conferência
 * aberta já não serve) ou se continua onde estava e o problema é outro.
 */
export function advanceErrorMessage(raw: string | undefined | null): {
  texto: string;
  mudouDeEstado: boolean;
} {
  const mensagem = raw ?? '';

  const ingrediente = /out_of_ingredient:\s*([^.]+?)\.?$/.exec(mensagem)?.[1]?.trim();
  if (ingrediente) {
    return {
      texto: `Falta ${ingrediente} na loja — o pedido não foi aprovado. Repõe no Estoque ou marca o produto como esgotado.`,
      mudouDeEstado: false,
    };
  }
  if (mensagem.includes('out_of_stock') || mensagem.includes('item_unavailable')) {
    return {
      texto: 'Um dos produtos deste pedido está esgotado — o pedido não foi aprovado.',
      mudouDeEstado: false,
    };
  }
  if (mensagem.includes('invalid_transition')) {
    return { texto: 'Esse pedido já mudou de estado noutro sítio. Actualizei o quadro.', mudouDeEstado: true };
  }
  if (mensagem.includes('store_access_denied')) {
    return { texto: 'Este terminal não tem acesso a esse pedido.', mudouDeEstado: false };
  }
  // O resto mostra-se tal como vem: um código lido ao telefone resolve mais
  // depressa do que um "tenta outra vez" que não diz nada.
  return {
    texto: `Não foi possível avançar o pedido${mensagem ? ` (${mensagem.slice(0, 80)})` : ''}.`,
    mudouDeEstado: false,
  };
}

/**
 * Este pedido espera que alguém confira um comprovativo antes de aprovar?
 *
 * É o caso do fluxo manual (§11.9): o cliente transferiu e anexou o recibo, e
 * quem está ao balcão tem de o ver antes de mandar fazer a comida. Um pedido
 * digital já vem pago pelo gateway — aprovar esse é só carimbar.
 */
export function needsProofCheck(order: BoardOrder): boolean {
  return order.status === 'awaiting_approval' && order.flow !== 'digital';
}

/**
 * Pode ser recusado do POS?
 *
 * Só o que espera aprovação. Um pedido `awaiting_payment` fica de fora de
 * propósito: o cliente pode já ter digitado o PIN e o dinheiro estar a sair —
 * "não sei" nunca vira "não pagou" (§11.9). Quem o resolve é o fornecedor.
 */
export function canDecide(order: { status: string }): boolean {
  return order.status === 'awaiting_approval';
}

/**
 * Os motivos de recusa, de um toque. O servidor exige motivo para cancelar
 * (`cancel_reason_required`) e o motivo fica no `event_log` — é o que responde
 * ao cliente que liga a perguntar porquê.
 */
export const REJECT_REASONS = [
  'Pagamento não recebido',
  'Comprovativo inválido',
  'Produto esgotado',
  'Fora da zona de entrega',
  'Loja a fechar',
  'Cliente pediu para cancelar',
] as const;

/** Os canais que são "internet": o site. `counter` é o POS, `dine_in` a mesa. */
export const ONLINE_CHANNELS = ['delivery', 'pickup'] as const;

/**
 * A ordem da aba de pedidos online: primeiro o que espera decisão (o mais
 * antigo à frente — é o cliente que espera há mais tempo), depois o resto, o
 * mais recente primeiro.
 */
export function sortOnlineOrders<T extends { status: string; created_at: string }>(orders: T[]): T[] {
  return [...orders].sort((a, b) => {
    const da = canDecide(a) ? 0 : 1;
    const db = canDecide(b) ? 0 : 1;
    if (da !== db) return da - db;
    return da === 0 ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at);
  });
}
