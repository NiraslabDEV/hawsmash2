/**
 * Frases de balcão — o que o operador diz ao cliente em cada passo do funil.
 *
 * Existem por uma razão prática: a diferença entre um balcão que vende
 * acompanhamentos e um que não vende quase nunca é o sistema — é a frase. Quem
 * está a cobrar, com fila à frente, não inventa uma boa pergunta de cada vez.
 * O ecrã dá-lha feita.
 *
 * Regras de escrita destas frases (valem também para as que o dono escreve no
 * painel):
 *
 * 1. **Curtas.** Lêem-se de relance, com o cliente à frente. Nada que obrigue a
 *    baixar os olhos duas vezes.
 * 2. **Pergunta aberta em vez de sim/não** sempre que der. "Qual bebida vai
 *    levar?" converte muito melhor do que "quer bebida?", porque a segunda tem
 *    uma resposta fácil e a primeira não.
 * 3. **Sem pressão.** O cliente pode dizer que não e o operador segue. Frase
 *    agressiva queima o balcão e o cliente não volta.
 *
 * Roda-se a frase por venda (não por render — piscar texto durante uma venda é
 * pior do que repetir). Com o tempo a equipa aprende as frases e passa a
 * dizê-las sem olhar; é esse o objectivo.
 *
 * As frases de cada loja vivem nas definições do POS (`lib/pos/settings.ts`,
 * aba POS do painel, migration 1067). As de baixo são só o valor de fábrica —
 * neutras de propósito: não falam de nenhum produto, porque o cardápio é de
 * cada casa (§18.3).
 */

import { FACTORY_POS_SETTINGS } from './settings';

export type PosUpsellStepKind = 'upgrade' | 'companion' | 'dessert';

export const UPSELL_SCRIPTS: Record<PosUpsellStepKind, readonly string[]> = {
  // Subir de gama: o cliente já quer o produto. Só falta perguntar.
  upgrade: [
    'Quer provar a versão especial? A diferença é pequena.',
    'Por mais um pouco leva o nosso melhor.',
  ],
  companion: FACTORY_POS_SETTINGS.upsell.steps.companion.scripts,
  dessert: FACTORY_POS_SETTINGS.upsell.steps.dessert.scripts,
};

/** Uma frase de uma lista, estável para a mesma `seed`. Vazio se não houver. */
export function pickScript(frases: readonly string[], seed: number): string {
  if (frases.length === 0) return '';
  const indice = Math.abs(Math.trunc(seed)) % frases.length;
  return frases[indice] as string;
}

/**
 * A frase de fábrica deste passo, para esta venda.
 *
 * `seed` deve ser estável durante uma venda inteira e mudar de venda para venda.
 * Assim o texto não pisca enquanto o operador está a ler, mas também não é
 * sempre o mesmo.
 */
export function upsellScript(kind: PosUpsellStepKind, seed: number): string {
  return pickScript(UPSELL_SCRIPTS[kind], seed);
}

/** Todas as frases de fábrica de um passo. */
export function upsellScripts(kind: PosUpsellStepKind): readonly string[] {
  return UPSELL_SCRIPTS[kind];
}
