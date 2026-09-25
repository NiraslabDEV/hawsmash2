/**
 * A senha pequena (1083): o papel que o cliente da mesa leva — só o número que
 * se chama e que aparece na TV, a mesa e o nome. Nada de artigos nem preços:
 * isso vai na comanda.
 *
 * O payload traz também os campos do formato herdado (`customer_name`,
 * `table_number`, `items: []`…). Um bridge de antes deste formato não o
 * reconhece e cai no herdado — que imprime o nome e a MESA em grande, sem
 * artigos. Sai maior do que devia, mas sai, e diz o que interessa.
 */

import {
  ALIGN_CENTER,
  ALIGN_LEFT,
  BOLD_OFF,
  BOLD_ON,
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
  table_number: number | null;
  /** "Mesa 5 · João" — o nome do cliente, quando o caixa o escreveu. */
  customer_name: string;
  order_number: string;
  created_at: string;
  // Formato herdado, para um bridge antigo imprimir o essencial.
  fulfillment_type: 'dine_in';
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

export function buildSenhaSlip(payload: SenhaSlipPayload): Op[] {
  const ops: Op[] = [INIT, ALIGN_CENTER];
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
