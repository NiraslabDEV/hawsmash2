/**
 * O papel como uma lista de instruções — sem bytes, sem Node.
 *
 * Os formatos (`tickets.ts`) descrevem o talão com estas instruções: texto,
 * negrito, tamanho, alinhamento, QR, logo, corte. Quem imprime converte-as em
 * ESC/POS (`encode.ts`, no mini-PC); quem pré-visualiza converte-as em linhas
 * de ecrã (`preview.ts`, no painel). O mesmo código desenha os dois — é o que
 * garante que o que o dono vê no painel é o que sai na impressora.
 *
 * Papel de 80 mm: 48 colunas em letra normal, 24 a dobrar a largura.
 */

import { cents, formatMT } from '@delivery/core';

export const WIDTH = 48;
/**
 * A dobrar a largura, cabe metade: 48 -> 24. Quem escreve uma linha a dobrar
 * tem de partir o texto por aqui, senão a impressora parte-o sozinha a meio de
 * uma palavra.
 */
export const WIDTH_DOUBLE = 24;

/**
 * Papel a avançar antes do corte.
 *
 * A lâmina fica ~15 mm ACIMA da cabeça de impressão. Com pouco avanço, a
 * última linha impressa acaba na própria aresta do corte — o talão sai com o
 * texto na pontinha e não se lê. Seis linhas dão margem para ler o fim e para
 * segurar o papel sem tapar o texto. Vale para todos os formatos.
 */
export const FEED_BEFORE_CUT = 6;

/** normal · a dobrar (largura e altura) · a triplicar · só a altura a dobrar. */
export type TextSize = 'normal' | 'double' | 'triple' | 'tall';

export type Op =
  /** Reinicia a impressora e escolhe CP1252. `kanjiOff` desliga o modo chinês (ver encode.ts). */
  | { t: 'init'; kanjiOff: boolean }
  | { t: 'align'; value: 'left' | 'center' }
  | { t: 'bold'; on: boolean }
  | { t: 'size'; value: TextSize }
  /** Texto cru; cada `\n` é uma linha impressa. */
  | { t: 'text'; value: string }
  | { t: 'feed'; lines: number }
  | { t: 'qr'; data: string; size: number }
  /** O logo da instalação ou, sem ele, o nome da marca — decide quem imprime. */
  | { t: 'brand' }
  | { t: 'cut' };

export const INIT: Op = { t: 'init', kanjiOff: true };
/** O início do formato herdado (mesa, teste): sem o cancelamento do modo Kanji. */
export const INIT_LEGACY: Op = { t: 'init', kanjiOff: false };
export const ALIGN_LEFT: Op = { t: 'align', value: 'left' };
export const ALIGN_CENTER: Op = { t: 'align', value: 'center' };
export const BOLD_ON: Op = { t: 'bold', on: true };
export const BOLD_OFF: Op = { t: 'bold', on: false };
export const SIZE_NORMAL: Op = { t: 'size', value: 'normal' };
export const SIZE_DOUBLE: Op = { t: 'size', value: 'double' };
export const SIZE_TRIPLE: Op = { t: 'size', value: 'triple' };
/**
 * Só a altura a dobrar: mantém as 48 colunas. É o corpo dos artigos no talão
 * completo — lê-se de relance e o preço continua a caber na mesma linha.
 */
export const SIZE_TALL: Op = { t: 'size', value: 'tall' };
export const BRAND: Op = { t: 'brand' };
export const CUT: Op = { t: 'cut' };

export function line(value = ''): Op {
  return { t: 'text', value: `${value}\n` };
}

export function feed(lines: number): Op {
  return { t: 'feed', lines };
}

/** QR code nativo da impressora — é o firmware que o desenha, não é imagem. */
export function qr(data: string, size = 5): Op {
  return { t: 'qr', data, size };
}

export function rule(character = '-'): string {
  return character.repeat(WIDTH);
}

export function twoColumns(left: string, right: string): string {
  const safeRight = right.slice(0, WIDTH - 1);
  const maxLeft = WIDTH - safeRight.length - 1;
  const safeLeft = left.slice(0, Math.max(0, maxLeft));
  return `${safeLeft}${' '.repeat(Math.max(1, WIDTH - safeLeft.length - safeRight.length))}${safeRight}`;
}

export function wrap(value: string, width = WIDTH): string[] {
  const lines: string[] = [];
  let current = '';
  for (const originalWord of value.trim().split(/\s+/).filter(Boolean)) {
    let word = originalWord;
    while (word.length > width) {
      if (current) lines.push(current);
      current = '';
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!current) current = word;
    else if (`${current} ${word}`.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

export function maputoTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Africa/Maputo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function mt(value: number): string {
  return formatMT(cents(value));
}

export function signedMT(value: number): string {
  return value < 0 ? `-${mt(Math.abs(value))}` : mt(value);
}
