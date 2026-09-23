/**
 * Instruções (`ops.ts`) → linhas para desenhar o talão num ecrã.
 *
 * É o outro lado do `encode.ts`: o mesmo documento, em vez de bytes, vira uma
 * lista de linhas com alinhamento, negrito e tamanho — e marcas para o logo,
 * o QR e o corte. O painel (aba POS) desenha isto em 48 colunas; o que lá se
 * vê é o que a impressora faz com as mesmas instruções.
 */

import type { Op, TextSize } from './ops';

export interface PreviewSpan {
  text: string;
  bold: boolean;
  size: TextSize;
}

export type PreviewLine =
  | { kind: 'text'; align: 'left' | 'center'; spans: PreviewSpan[] }
  | { kind: 'blank' }
  | { kind: 'brand'; align: 'left' | 'center' }
  | { kind: 'qr'; align: 'left' | 'center'; data: string }
  | { kind: 'cut' };

export function renderPreview(ops: Op[]): PreviewLine[] {
  const lines: PreviewLine[] = [];
  let align: 'left' | 'center' = 'left';
  let bold = false;
  let size: TextSize = 'normal';
  let spans: PreviewSpan[] = [];
  let lineAlign: 'left' | 'center' = align;

  const flush = () => {
    lines.push({ kind: 'text', align: lineAlign, spans });
    spans = [];
  };

  for (const op of ops) {
    switch (op.t) {
      case 'init':
        align = 'left';
        bold = false;
        size = 'normal';
        break;
      case 'align':
        align = op.value;
        break;
      case 'bold':
        bold = op.on;
        break;
      case 'size':
        size = op.value;
        break;
      case 'text': {
        const partes = op.value.split('\n');
        partes.forEach((parte, indice) => {
          if (spans.length === 0) lineAlign = align;
          if (parte) spans.push({ text: parte, bold, size });
          // Cada `\n` fecha a linha — também uma vazia, que no papel é espaço.
          if (indice < partes.length - 1) flush();
        });
        break;
      }
      case 'feed':
        if (spans.length > 0) flush();
        for (let i = 0; i < op.lines; i++) lines.push({ kind: 'blank' });
        break;
      case 'qr':
        if (spans.length > 0) flush();
        lines.push({ kind: 'qr', align, data: op.data });
        break;
      case 'brand':
        if (spans.length > 0) flush();
        lines.push({ kind: 'brand', align });
        break;
      case 'cut':
        if (spans.length > 0) flush();
        lines.push({ kind: 'cut' });
        break;
    }
  }
  if (spans.length > 0) flush();
  return lines;
}
