/**
 * Os atalhos de nota ("SEM CEBOLA", "SEM MOLHO") somam-se, não se substituem.
 *
 * Um cliente pede quase sempre mais do que um "sem". Quando o atalho apagava o
 * que já lá estava, a operadora tinha de escolher entre o segundo "sem" e o
 * primeiro — e a cozinha recebia só um deles. Tocar num atalho que já está na
 * nota tira-o: é assim que se corrige um toque errado sem apagar tudo.
 */

const SEPARADOR = ', ';

function partes(nota: string): string[] {
  return nota
    .split(',')
    .map((parte) => parte.trim())
    .filter(Boolean);
}

/** Junta o atalho à nota, ou tira-o se já lá estiver. */
export function toggleNoteChip(nota: string, atalho: string): string {
  const alvo = atalho.trim();
  if (!alvo) return nota.trim();
  const actuais = partes(nota);
  const chave = alvo.toLocaleUpperCase('pt-PT');
  const semEle = actuais.filter((parte) => parte.toLocaleUpperCase('pt-PT') !== chave);
  if (semEle.length !== actuais.length) return semEle.join(SEPARADOR);
  return [...actuais, alvo].join(SEPARADOR);
}

/** O atalho já está na nota? (para o pintar como escolhido) */
export function noteHasChip(nota: string, atalho: string): boolean {
  const chave = atalho.trim().toLocaleUpperCase('pt-PT');
  return partes(nota).some((parte) => parte.toLocaleUpperCase('pt-PT') === chave);
}
