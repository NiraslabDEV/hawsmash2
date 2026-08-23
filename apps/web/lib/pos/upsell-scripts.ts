/**
 * Frases de balcão — o que o operador diz ao cliente em cada passo do funil.
 *
 * Existem por uma razão prática: a diferença entre um balcão que vende
 * acompanhamentos e um que não vende quase nunca é o sistema — é a frase. Quem
 * está a cobrar, com fila à frente, não inventa uma boa pergunta de cada vez.
 * O ecrã dá-lha feita.
 *
 * Regras de escrita destas frases:
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
 * pior do que repetir). Com o tempo a equipa aprende as dez e passa a dizê-las
 * sem olhar; é esse o objectivo.
 *
 * Por agora ficam no código. Quando o dono quiser afinar o tom, mudam-se para
 * `settings` ao lado de `upsell_title`/`upsell_subtitle`, que já lá estão para
 * a loja online.
 */

export type PosUpsellStepKind = 'upgrade' | 'companion' | 'dessert';

export const UPSELL_SCRIPTS: Record<PosUpsellStepKind, readonly string[]> = {
  // Subir de gama: o cliente já quer o produto. Só falta perguntar.
  upgrade: [
    'Quer provar o WAGYU? A carne é outra e a diferença é pequena.',
    'Por mais um pouco leva o WAGYU — é o nosso melhor lanche.',
    'Hoje o WAGYU está a sair muito. Quer experimentar?',
    'Se é para comer bem, o WAGYU compensa.',
    'Já provou o WAGYU? Quem prova raramente volta atrás.',
  ],

  // Acompanhar: batata e bebida. É aqui que está o grosso da margem.
  companion: [
    'Qual bebida vai levar — Coca, Fanta ou Sprite?',
    'Junto uma batata e uma bebida? Fica completo.',
    'Batata para acompanhar? Sai quentinha agora mesmo.',
    'Uma bebida gelada cai sempre bem com o smash.',
    'Leva batata? É o que mais sai com esse lanche.',
    'Água, refrigerante ou Red Bull?',
    'Quer completar com batata e bebida?',
  ],

  // Sobremesa: pergunta-se no fim, quando o cliente já disse sim ao resto.
  dessert: [
    'Para fechar, dois pastéis de nata?',
    'Os pastéis de nata acabaram de sair. Leva uns?',
    'Já provou as nossas natas? São feitas aqui.',
    'Uma sobremesa para levar?',
    'Fecha com uns pastéis de nata?',
  ],
} as const;

/**
 * A frase deste passo, para esta venda.
 *
 * `seed` deve ser estável durante uma venda inteira e mudar de venda para venda
 * — o número de vendas do turno serve. Assim o texto não pisca enquanto o
 * operador está a ler, mas também não é sempre o mesmo.
 */
export function upsellScript(kind: PosUpsellStepKind, seed: number): string {
  const frases = UPSELL_SCRIPTS[kind];
  if (frases.length === 0) return '';
  const indice = Math.abs(Math.trunc(seed)) % frases.length;
  return frases[indice] as string;
}

/** Todas as frases de um passo — para o manual da equipa e para formação. */
export function upsellScripts(kind: PosUpsellStepKind): readonly string[] {
  return UPSELL_SCRIPTS[kind];
}
