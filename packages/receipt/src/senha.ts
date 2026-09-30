/**
 * A senha pequena (1083): o papel que o cliente leva — só o número que se
 * chama e que aparece na TV, a mesa (se for de mesa) e o nome. Nada de artigos
 * nem preços: isso vai na comanda. Sai nos pedidos de mesa (1092) e nas vendas
 * do balcão (1111), com o logo da marca por cima quando o layout da loja o tem
 * ligado — o mesmo interruptor do talão completo.
 *
 * O payload traz também os campos do formato herdado (`customer_name`,
 * `table_number`, `items: []`…). Um bridge de antes deste formato não o
 * reconhece e cai no herdado — que imprime o nome e a MESA em grande, sem
 * artigos. Sai maior do que devia, mas sai, e diz o que interessa.
 */

import { FACTORY_PRINT_LAYOUT, type PrintLayout } from './layout';
import {
  ALIGN_CENTER,
  ALIGN_LEFT,
  BOLD_OFF,
  BOLD_ON,
  BRAND,
  CUT,
  FEED_BEFORE_CUT,
  INIT,
  SIZE_DOUBLE,
  SIZE_NORMAL,
  SIZE_TRIPLE,
  feed,
  line,
  maputoTime,
  rule,
  type Op,
} from './ops';
import type { PrintPayload } from './types';

export interface SenhaSlipPayload {
  template: 'senha';
  store_short_name: string;
  daily_number: number;
  /** Só nos pedidos de mesa; no balcão vem `null`. */
  table_number: number | null;
  /** "Mesa 5 · João" na mesa, "João" no balcão, ou vazio sem nome escrito. */
  customer_name: string;
  order_number: string;
  created_at: string;
  // Formato herdado, para um bridge antigo imprimir o essencial.
  fulfillment_type: 'dine_in' | 'counter';
  items: [];
  payment_method: 'no_payment';
  total_cents: number;
}

export function isSenhaSlip(p: PrintPayload | SenhaSlipPayload): p is SenhaSlipPayload {
  return (p as SenhaSlipPayload).template === 'senha';
}

/** O nome sem o "Mesa N · " da frente: é a mesa que já vai por cima. */
function nomeDoCliente(customerName: string): string | null {
  const nome = customerName.replace(/^mesa\s+\d+\s*(·\s*)?/i, '').trim();
  return nome || null;
}

export function buildSenhaSlip(
  payload: SenhaSlipPayload,
  layout: PrintLayout = FACTORY_PRINT_LAYOUT,
): Op[] {
  const ops: Op[] = [INIT, ALIGN_CENTER];
  if (layout.show.logo) ops.push(BRAND);
  ops.push(BOLD_ON, line(payload.store_short_name.toUpperCase()), BOLD_OFF);
  ops.push(line(rule('-')));
  ops.push(line('SENHA'));
  ops.push(SIZE_TRIPLE, BOLD_ON, line(`${payload.daily_number}`), BOLD_OFF, SIZE_NORMAL);
  if (payload.table_number != null) {
    ops.push(SIZE_DOUBLE, BOLD_ON, line(`MESA ${payload.table_number}`), BOLD_OFF, SIZE_NORMAL);
  }
  const nome = nomeDoCliente(payload.customer_name);
  if (nome) ops.push(BOLD_ON, line(nome.toUpperCase()), BOLD_OFF);
  ops.push(feed(1), line(`${payload.order_number} · ${maputoTime(payload.created_at)}`));
  ops.push(line('Quando estiver pronto, chamamos esta senha.'));
  ops.push(ALIGN_LEFT, feed(FEED_BEFORE_CUT), CUT);
  return ops;
}
