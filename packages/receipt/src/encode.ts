/**
 * Instruções (`ops.ts`) → bytes ESC/POS, montados à mão.
 *
 * DECISÃO: não usamos `esc-pos-encoder` (arrasta `canvas`, binding nativo
 * Cairo). Acentos: CP1252 (WPC1252) seleccionada na impressora; texto em
 * latin1, cujos bytes coincidem com CP1252 para os acentos do português.
 *
 * Cada instrução produz exactamente os bytes que o `escpos.ts` do bridge
 * produzia com as suas constantes — é isso que mantém o papel igual.
 * Sem Node: devolve `Uint8Array`, e o bridge faz o `Buffer` por cima.
 */

import type { Op, TextSize } from './ops';

const ESC = 0x1b;
const GS = 0x1d;
const FS = 0x1c;

const SIZE_BYTE: Record<TextSize, number> = {
  normal: 0x00,
  double: 0x11,
  triple: 0x22,
  tall: 0x01,
};

// Caracteres CP1252 0x80-0x9F que NÃO coincidem com latin1.
const CP1252_EXTRA: Record<string, number> = {
  '€': 0x80, // €
  '‚': 0x82, // ‚
  'ƒ': 0x83, // ƒ
  '„': 0x84, // „
  '…': 0x85, // …
  '†': 0x86, // †
  '‡': 0x87, // ‡
  'ˆ': 0x88, // ˆ
  '‰': 0x89, // ‰
  'Š': 0x8a, // Š
  '‹': 0x8b, // ‹
  'Œ': 0x8c, // Œ
  'Ž': 0x8e, // Ž
  '‘': 0x91, // ‘
  '’': 0x92, // ’
  '“': 0x93, // “
  '”': 0x94, // ”
  '•': 0x95, // •
  '–': 0x96, // –
  '—': 0x97, // —
  '˜': 0x98, // ˜
  '™': 0x99, // ™
  'š': 0x9a, // š
  '›': 0x9b, // ›
  'œ': 0x9c, // œ
  'ž': 0x9e, // ž
  'Ÿ': 0x9f, // Ÿ
};

export interface EncodeOptions {
  /** O logo da instalação em raster (GS v 0). Vazio = sem logo. */
  logo?: Uint8Array | null;
  /** Sem logo, o nome da marca em corpo triplo. Sem nenhum, fica só a loja. */
  brandName?: string | null;
}

class ByteWriter {
  private readonly parts: number[] = [];
  private readonly blocks: Uint8Array[] = [];

  push(...bytes: number[]): void {
    for (const byte of bytes) this.parts.push(byte);
  }

  pushBlock(block: Uint8Array): void {
    this.flush();
    this.blocks.push(block);
  }

  text(value: string): void {
    for (const ch of value) {
      const cp = ch.codePointAt(0) ?? 0x3f;
      if (cp <= 0xff) this.parts.push(cp);
      else this.parts.push(CP1252_EXTRA[ch] ?? 0x3f);
    }
  }

  private flush(): void {
    if (this.parts.length === 0) return;
    this.blocks.push(Uint8Array.from(this.parts));
    this.parts.length = 0;
  }

  result(): Uint8Array {
    this.flush();
    const total = this.blocks.reduce((sum, block) => sum + block.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const block of this.blocks) {
      out.set(block, offset);
      offset += block.length;
    }
    return out;
  }
}

/** QR code nativo (GS ( k): modelo 2, tamanho do módulo, correcção M, dados, imprimir. */
function writeQr(w: ByteWriter, data: string, size: number): void {
  const bytes: number[] = [];
  for (let i = 0; i < data.length; i++) bytes.push(data.charCodeAt(i) & 0xff); // latin1
  const storeLen = bytes.length + 3;
  w.push(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00); // modelo 2
  w.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size); // tamanho do módulo
  w.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31); // correcção de erro M
  w.push(GS, 0x28, 0x6b, storeLen & 0xff, (storeLen >> 8) & 0xff, 0x31, 0x50, 0x30);
  w.push(...bytes);
  w.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30); // imprimir
}

export function encodeEscPos(ops: Op[], options: EncodeOptions = {}): Uint8Array {
  const w = new ByteWriter();
  for (const op of ops) {
    switch (op.t) {
      case 'init':
        w.push(ESC, 0x40);
        // FS . cancela o modo Kanji. É ESSENCIAL nas térmicas chinesas (a
        // XP-T80Q tem "Chinese character: Yes"): sem isto os bytes >=0x80 dos
        // acentos são lidos como início de um caractere de duplo-byte e sai
        // lixo no papel. Lição aprendida em produção no 1.0 — não repetir.
        if (op.kanjiOff) w.push(FS, 0x2e);
        w.push(ESC, 0x74, 16); // CP1252
        break;
      case 'align':
        w.push(ESC, 0x61, op.value === 'center' ? 1 : 0);
        break;
      case 'bold':
        w.push(ESC, 0x45, op.on ? 1 : 0);
        break;
      case 'size':
        w.push(GS, 0x21, SIZE_BYTE[op.value]);
        break;
      case 'text':
        w.text(op.value);
        break;
      case 'feed':
        w.push(ESC, 0x64, op.lines);
        break;
      case 'qr':
        writeQr(w, op.data, op.size);
        break;
      case 'brand': {
        const nome = options.brandName?.trim();
        if (options.logo && options.logo.length > 0) {
          w.pushBlock(options.logo);
          w.push(ESC, 0x64, 1);
        } else if (nome) {
          w.push(ESC, 0x45, 1, GS, 0x21, 0x22);
          w.text(`${nome.toUpperCase()}\n`);
          w.push(GS, 0x21, 0x00, ESC, 0x45, 0);
        }
        break;
      }
      case 'cut':
        w.push(GS, 0x56, 0x00);
        break;
    }
  }
  return w.result();
}
