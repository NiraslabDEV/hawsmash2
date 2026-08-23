/**
 * Visor do cliente (o mostrador de duas linhas virado para quem paga).
 *
 * Divisão de trabalho igual à da impressão: o POS manda **o que dizer**, o
 * print-bridge decide **como escrever** — quantas colunas tem o visor, que
 * protocolo fala, que bytes saem pela porta série. Aqui não há larguras nem
 * bytes: só semântica. É o que permite trocar o visor por outro modelo sem
 * tocar no POS.
 *
 * Regra 1 do CLAUDE: nada disto pode travar uma venda. Todo o envio é
 * best-effort, sem `await` no caminho da venda e sem erro visível ao operador.
 */

import { formatMT, type Cents } from '@delivery/core';
import type { CounterPaymentMethod } from './payment';
import { postToBridge, type LocalBridgeConfig } from './offline-sales';

/** Uma linha: o que encosta à esquerda e o que encosta à direita. */
export type DisplayLine = { left: string; right?: string };

export type DisplayFrame =
  | { mode: 'idle' }
  | { mode: 'text'; top: DisplayLine; bottom: DisplayLine };

export type DisplayState =
  /** Sem venda em curso — o bridge passa o nome da casa a andar. */
  | { step: 'idle' }
  /** Acabou de entrar (ou sair) um artigo do carrinho. */
  | { step: 'item'; name: string; qty: number; lineTotalCents: number }
  | { step: 'cart'; itemCount: number; totalCents: number }
  | {
      step: 'payment';
      method: CounterPaymentMethod;
      totalCents: number;
      /** Só para M-Pesa/e-Mola: é o número que o cliente vai marcar. */
      number: string | null;
    }
  | { step: 'change'; receivedCents: number; changeCents: number }
  | { step: 'thanks'; dailyNumber: number };

const mt = (value: number) => formatMT(value as Cents);

const METHOD_LABEL: Record<CounterPaymentMethod, string> = {
  cash: 'DINHEIRO',
  mpesa: 'M-PESA',
  emola: 'E-MOLA',
  credit_card: 'CARTAO',
};

/**
 * O estado do POS traduzido para as duas linhas do visor.
 *
 * Pura de propósito: é a única parte disto que se consegue testar sem hardware,
 * e é onde estão as decisões que interessam ao cliente que está a olhar.
 */
export function buildDisplayFrame(state: DisplayState): DisplayFrame {
  switch (state.step) {
    case 'idle':
      return { mode: 'idle' };
    case 'item':
      return {
        mode: 'text',
        top: { left: state.name },
        bottom: { left: `${state.qty} x`, right: mt(state.lineTotalCents) },
      };
    case 'cart':
      return {
        mode: 'text',
        top: { left: `${state.itemCount} ${state.itemCount === 1 ? 'artigo' : 'artigos'}` },
        bottom: { left: 'TOTAL', right: mt(state.totalCents) },
      };
    case 'payment':
      // O número do M-Pesa em cima, o valor em baixo: o cliente marca o número
      // enquanto confirma quanto vai enviar, sem ninguém lho ter de ditar.
      return {
        mode: 'text',
        top: {
          left: METHOD_LABEL[state.method],
          ...(state.number ? { right: state.number } : {}),
        },
        bottom: { left: 'A PAGAR', right: mt(state.totalCents) },
      };
    case 'change':
      return {
        mode: 'text',
        top: { left: 'RECEBIDO', right: mt(state.receivedCents) },
        bottom: { left: 'TROCO', right: mt(state.changeCents) },
      };
    case 'thanks':
      return {
        mode: 'text',
        top: { left: 'OBRIGADO!' },
        bottom: { left: 'SENHA', right: String(state.dailyNumber) },
      };
  }
}

/** Duas tramas iguais não valem uma ida à porta série. */
export function frameKey(frame: DisplayFrame): string {
  return JSON.stringify(frame);
}

/**
 * Envia sem esperar e sem se queixar. Um visor desligado, um bridge em baixo ou
 * um cabo fora não podem produzir um erro no ecrã do operador.
 */
export function sendDisplayFrame(
  config: LocalBridgeConfig,
  frame: DisplayFrame,
  fetcher?: typeof fetch,
): Promise<boolean> {
  return postToBridge(config, '/display', frame as unknown as Record<string, unknown>, fetcher);
}
