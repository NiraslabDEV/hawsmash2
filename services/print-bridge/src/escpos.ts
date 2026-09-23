// ESC/POS do bridge — os formatos vivem em `@delivery/receipt` (partilhados com
// a pré-visualização do painel); aqui junta-se o que é do mini-PC: o logo da
// instalação, o nome da marca do `.env` e o layout que a loja escolheu na aba
// POS (`print-layout.ts`). As funções e as assinaturas são as de sempre, e com
// o layout de fábrica os bytes também (`__tests__/talao-bytes.test.ts`).
import {
  buildCashCloseReceipt,
  buildCustomerReceipt,
  buildFullTicket,
  buildKitchenTicket,
  buildPrintDocument,
  buildReceipt,
  encodeEscPos,
  type CashClosePayload,
  type CustomerReceiptPayload,
  type KitchenTicketPayload,
  type Op,
  type PrintLayout,
  type PrintPayload,
} from '@delivery/receipt';
import { LOGO_RASTER } from './logo';
import { currentPrintLayout } from './print-layout';

export { formatPaymentMethod } from '@delivery/receipt';

const ESC = 0x1b;
const GS = 0x1d;

export const CUT_FULL = Buffer.from([GS, 0x56, 0x00]);

/** Lidos a cada talão: o logo e o nome da marca são da instalação, não do código. */
function encode(ops: Op[]): Buffer {
  return Buffer.from(encodeEscPos(ops, { logo: LOGO_RASTER, brandName: process.env.BRAND_NAME }));
}

export function createFullTicket(payload: KitchenTicketPayload, layout: PrintLayout = currentPrintLayout()): Buffer {
  return encode(buildFullTicket(payload, layout));
}

export function createKitchenTicket(payload: KitchenTicketPayload, layout: PrintLayout = currentPrintLayout()): Buffer {
  return encode(buildKitchenTicket(payload, layout));
}

export function createCustomerReceipt(payload: CustomerReceiptPayload): Buffer {
  return encode(buildCustomerReceipt(payload));
}

export function createCashCloseReceipt(payload: CashClosePayload): Buffer {
  return encode(buildCashCloseReceipt(payload));
}

export function createPrintDocument(
  kind: string,
  payload: PrintPayload,
  layout: PrintLayout = currentPrintLayout(),
): Buffer {
  return encode(buildPrintDocument(kind, payload, layout));
}

export function createReceipt(payload: PrintPayload, layout: PrintLayout = currentPrintLayout()): Buffer {
  return encode(buildReceipt(payload, layout));
}

// Caracteres CP1252 0x80-0x9F que NÃO coincidem com latin1 — para devolver o
// texto ao simulador e aos testes.
const CP1252_REVERSE: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…',
  0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š',
  0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’',
  0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ',
  0x9e: 'ž', 0x9f: 'Ÿ',
};

export function decodeReceipt(buffer: Buffer): string {
  let out = "";
  let i = 0;
  while (i < buffer.length) {
    const b = buffer[i];
    if (b === ESC) {
      const cmd = buffer[i + 1];
      if (cmd === 0x40) { i += 2; }
      else if (cmd === 0x74 || cmd === 0x61 || cmd === 0x45 || cmd === 0x64) { i += 3; }
      else { i += 2; }
      continue;
    }
    if (b === GS) {
      const cmd = buffer[i + 1];
      if (cmd === 0x21 || cmd === 0x56) { i += 3; }
      else { i += 2; }
      continue;
    }
    out += CP1252_REVERSE[b] ?? Buffer.from([b]).toString("latin1");
    i += 1;
  }
  return out;
}
