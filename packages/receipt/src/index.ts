/**
 * @delivery/receipt — o papel da casa, partilhado entre o mini-PC e o painel.
 *
 * - `tickets.ts`: os formatos, como instruções (`ops.ts`), com o layout da loja;
 * - `encode.ts`: instruções → ESC/POS (print-bridge);
 * - `preview.ts`: instruções → linhas de ecrã (aba POS do painel);
 * - `layout.ts`: os modelos e interruptores, lidos com tolerância.
 *
 * Sem dependências de Node nem do browser. Ver docs/POS-DEFINICOES.md §Impressão.
 */

export * from './ops';
export * from './types';
export * from './layout';
export * from './tickets';
export * from './cash-day';
export * from './encode';
export * from './preview';
export * from './sample';
