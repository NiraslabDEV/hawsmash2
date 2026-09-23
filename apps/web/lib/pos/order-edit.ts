/**
 * Alterar a morada e a hora de um pedido, a partir do quadro (1072).
 *
 * "O cliente ligou: afinal é para o prédio ao lado, e só às 20h." É conversa
 * de balcão, e até aqui não havia onde a escrever — anulava-se e refazia-se,
 * ou riscava-se o papel à mão.
 *
 * Quem decide é o servidor (`update_order_details`); este módulo só diz ao
 * ecrã o que mostrar, para o caixa não tocar num botão que vai ser recusado.
 * As regras são as mesmas dos dois lados:
 *   · a morada muda até o pedido sair, e só em entregas;
 *   · a hora muda até o pedido estar pronto;
 *   · mudar de zona só com a mesma taxa — o total não se mexe aqui (regra 2).
 */

import { formatMT, type Cents } from '@delivery/core';
import type { BoardOrder, OrderStatus } from './orders-board';

export type DeliveryZoneOption = { id: string; name: string; fee_cents: number };

/** Estados em que o pedido ainda está na loja. */
const EDITABLE: OrderStatus[] = [
  'awaiting_approval',
  'awaiting_payment',
  'approved',
  'paid',
  'in_preparation',
  'ready',
];

function editable(order: BoardOrder): boolean {
  return order.channel !== 'dine_in' && EDITABLE.includes(order.status);
}

export function canEditAddress(order: BoardOrder): boolean {
  return editable(order) && order.fulfillment_type === 'delivery';
}

export function canEditSchedule(order: BoardOrder): boolean {
  return editable(order) && order.status !== 'ready';
}

/**
 * As zonas, com as que não se podem escolher marcadas. Mostram-se todas — o
 * caixa percebe porque é que a Costa do Sol está apagada ("taxa diferente"),
 * em vez de achar que a zona desapareceu.
 */
export function zoneChoices(
  zones: DeliveryZoneOption[],
  order: BoardOrder,
): Array<{ zone: DeliveryZoneOption; allowed: boolean }> {
  return zones.map((zone) => ({
    zone,
    allowed: zone.id === order.delivery_zone_id || zone.fee_cents === order.delivery_fee_cents,
  }));
}

const mt = (value: number) => formatMT(value as Cents);

export function orderEditErrorMessage(raw: string | null | undefined): string {
  const mensagem = raw ?? '';

  const taxa = /delivery_fee_would_change:(\d+):(\d+)/.exec(mensagem);
  if (taxa) {
    return (
      `Nessa zona a taxa passa de ${mt(Number(taxa[1]))} para ${mt(Number(taxa[2]))}. ` +
      'O total do pedido não se muda aqui: é preciso anular e refazer o pedido, com gerente.'
    );
  }
  if (mensagem.includes('schedule_not_editable')) {
    return 'O pedido já está pronto — a hora já não se muda.';
  }
  if (mensagem.includes('order_not_editable')) {
    return 'Este pedido já não se pode alterar (já saiu ou foi anulado).';
  }
  if (mensagem.includes('scheduled_for_in_past')) {
    return 'Essa hora já passou. Escolhe outra.';
  }
  if (mensagem.includes('scheduled_for_too_far')) {
    return 'Só se agenda até uma semana à frente.';
  }
  if (mensagem.includes('address_required')) {
    return 'Escreve a morada — não pode ficar vazia.';
  }
  if (mensagem.includes('address_too_long')) {
    return 'A morada é demasiado longa (máximo 300 letras).';
  }
  if (mensagem.includes('invalid_delivery_zone')) {
    return 'Essa zona já não está activa nesta loja.';
  }
  if (mensagem.includes('not_a_delivery')) {
    return 'Este pedido não é uma entrega — não tem morada.';
  }
  if (mensagem.includes('order_edit_access_denied')) {
    return 'O teu perfil não pode alterar pedidos.';
  }
  if (mensagem.includes('order_not_found_or_unauthorised')) {
    return 'Este terminal não tem acesso a esse pedido.';
  }
  return `Não foi possível alterar o pedido${mensagem ? ` (${mensagem.slice(0, 80)})` : ''}.`;
}
