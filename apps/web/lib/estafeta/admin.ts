/** Frases do painel para os códigos das RPCs de estafetas (1115). */
const MENSAGENS: Record<string, string> = {
  courier_access_denied: 'Sem permissão para isto nesta loja.',
  courier_phone_taken: 'Já há um estafeta activo com este telefone.',
  invalid_courier_phone: 'Telefone inválido — 9 dígitos, ex.: 84 123 4567.',
  invalid_courier_name: 'Nome inválido.',
  invalid_pin_format: 'O PIN tem 4 a 6 dígitos.',
  courier_not_found: 'Estafeta não encontrado ou desactivado.',
  courier_wrong_store: 'Este estafeta é de outra loja.',
  order_not_delivery: 'Este pedido não é de entrega.',
  order_not_assignable: 'Este pedido ainda não pode sair (por aprovar ou cancelado).',
  delivery_already_picked_up: 'O estafeta já levantou este pedido — já não se troca.',
  no_open_session: 'Não há turno de caixa aberto: abre o caixa ou escolhe outro meio de pagamento.',
  invalid_payout_amount: 'Valor inválido.',
  invalid_adjust_amount: 'Valor inválido.',
  adjust_reason_required: 'Escreve o motivo do acerto.',
  request_id_reused: 'Este pagamento já foi registado com outro valor. Fecha e abre de novo.',
  invalid_courier_fee: 'Regra de pagamento inválida (percentagem entre 0 e 100).',
};

export function courierAdminErrorMessage(message: string | null | undefined): string {
  if (message) {
    for (const [codigo, frase] of Object.entries(MENSAGENS)) {
      if (message.includes(codigo)) return frase;
    }
  }
  return 'Não foi possível. Tenta outra vez.';
}
