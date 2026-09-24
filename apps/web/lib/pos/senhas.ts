/**
 * A aba Senhas do POS e a TV de senhas.
 *
 * O caixa digita a senha que a cozinha acabou de pôr no balcão e ela aparece
 * na TV como PEDIDO PRONTO. Quem manda na TV é o estado do pedido: tudo o que
 * fica `ready` — venda de balcão, levantamento ou entrega — aparece sozinho,
 * seja pela senha digitada aqui, seja pela seta do quadro de Pedidos.
 *
 * O servidor (`call_ticket`, 1076) é que encontra o pedido pelo número do dia
 * e o faz andar pelo `advance_order`. Este módulo é só a parte que se testa
 * sem browser: o teclado, as listas e as frases.
 */

export type TicketOrder = {
  id: string;
  daily_number: number | null;
  order_number: string;
  status: string;
  channel: string | null;
  fulfillment_type: string | null;
  customer_name: string | null;
  created_at: string;
  updated_at: string;
};

/** As colunas que a aba lê. */
export const TICKET_SELECT =
  'id,daily_number,order_number,status,channel,fulfillment_type,customer_name,created_at,updated_at';

/** O que ainda pode ser chamado, e o que já está na TV. */
export const TICKET_STATUSES = ['paid', 'approved', 'in_preparation', 'ready'] as const;

/**
 * A meia-noite de hoje em Maputo, em UTC. O número do dia reinicia aí (§5.4)
 * — contar desde a meia-noite UTC misturava as senhas de ontem (§11.8).
 */
export function maputoDayStart(now: Date = new Date()): string {
  const dia = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Maputo' });
  // Maputo não tem hora de Verão: é sempre UTC+2.
  return new Date(`${dia}T00:00:00+02:00`).toISOString();
}

const PREPARING = new Set(['paid', 'approved', 'in_preparation']);

/** A senha é o número do dia: quatro algarismos chegam para um dia de loja. */
export const TICKET_MAX_DIGITS = 4;

export function pressTicketKey(current: string, key: string): string {
  if (key === 'C') return '';
  if (key === '⌫') return current.slice(0, -1);
  if (!/^\d$/.test(key)) return current;
  // A senha 07 é a 7: um zero à esquerda só enganava quem lê o visor.
  if (current === '' && key === '0') return current;
  if (current.length >= TICKET_MAX_DIGITS) return current;
  return current + key;
}

export function parseTicket(input: string): number | null {
  if (!/^\d+$/.test(input)) return null;
  const value = Number(input);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * O que a TV escreve por baixo do número — é o que diz ao cliente para onde
 * ir. Uma venda de balcão com entrega é ENTREGA: quem a vem buscar é o
 * estafeta, não quem está à espera ao balcão.
 */
export function ticketLabel(order: { channel: string | null; fulfillment_type: string | null }): string {
  if (order.fulfillment_type === 'delivery') return 'ENTREGA';
  if (order.channel === 'dine_in') return 'MESA';
  if (order.channel === 'pickup') return 'LEVANTAMENTO';
  return 'BALCÃO';
}

export function splitTickets<T extends TicketOrder>(orders: T[]): { preparing: T[]; ready: T[] } {
  const comSenha = orders.filter((order) => order.daily_number != null);
  const preparing = comSenha
    .filter((order) => PREPARING.has(order.status))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const ready = comSenha
    .filter((order) => order.status === 'ready')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return { preparing, ready };
}

/**
 * As senhas que ficaram prontas desde a leitura anterior da TV.
 *
 * Na primeira leitura (`previous === null`) não destaca nada: uma TV que se
 * liga a meio do turno não deve anunciar como novas as senhas que já lá estão.
 */
export function newlyReady<T extends { order_number: string }>(
  previous: Set<string> | null,
  ready: T[],
): T[] {
  if (!previous) return [];
  return ready.filter((entry) => !previous.has(entry.order_number));
}

export function ticketErrorMessage(raw: string | null | undefined, numero: number): string {
  const mensagem = raw ?? '';
  if (mensagem.includes('ticket_not_found')) {
    return `Não há senha ${numero} hoje nesta loja. Confere o número no talão.`;
  }
  if (mensagem.includes('ticket_not_paid')) {
    return `A senha ${numero} é um pedido da internet que ainda não foi aprovado ou pago. Aprova-o na aba Delivery.`;
  }
  if (mensagem.includes('ticket_already_delivered')) {
    return `A senha ${numero} já foi entregue.`;
  }
  if (mensagem.includes('ticket_cancelled')) {
    return `A senha ${numero} é de um pedido anulado.`;
  }
  if (mensagem.includes('store_access_denied')) {
    return 'Este terminal não tem acesso aos pedidos desta loja.';
  }
  return `Não foi possível chamar a senha ${numero}${mensagem ? ` (${mensagem.slice(0, 80)})` : ''}.`;
}
