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

export type BoardColumnId = 'incoming' | 'preparing' | 'ready';

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
};

/** As colunas que o quadro lê. Uma só definição, para o teste medir o mesmo. */
export const BOARD_SELECT =
  'id,daily_number,order_number,status,channel,fulfillment_type,' +
  'customer_name,customer_phone,total_cents,scheduled_for,created_at,' +
  'payment_method,payment_proof_path,flow';

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
   * ser feito, verde está à espera de sair.
   */
  tone: 'amber' | 'blue' | 'green';
  orders: BoardOrder[];
};

const COLUMN_OF_STATUS: Partial<Record<OrderStatus, BoardColumnId>> = {
  awaiting_approval: 'incoming',
  awaiting_payment: 'incoming',
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
 * Este pedido espera que alguém confira um comprovativo antes de aprovar?
 *
 * É o caso do fluxo manual (§11.9): o cliente transferiu e anexou o recibo, e
 * quem está ao balcão tem de o ver antes de mandar fazer a comida. Um pedido
 * digital já vem pago pelo gateway — aprovar esse é só carimbar.
 */
export function needsProofCheck(order: BoardOrder): boolean {
  return order.status === 'awaiting_approval' && order.flow !== 'digital';
}
