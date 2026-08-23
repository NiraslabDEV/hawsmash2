// Cliente de impressora com retry/backoff.
//
// Tres destinos possiveis (ver `printer-target.ts`): TCP para as impressoras de
// rede das lojas, fila do Windows para a impressora acoplada ao PC touch, e
// porta serie. O retry e o backoff sao os mesmos para os tres — falhar a
// imprimir nunca pode travar nem esconder a venda (CLAUDE §8.2).
import { createConnection } from 'net';
import { createPrintDocument } from './escpos';
import { describeTarget, sendToSerialPrinter, sendToWindowsQueue, type PrinterTarget } from './printer-target';
import type { PrintPayload } from './types';

const RETRY_ATTEMPTS = 3;
const INITIAL_BACKOFF = 1000;
const CONNECT_TIMEOUT = 5000;

export interface SendOptions {
  attempts?: number;
  backoffMs?: number;
  timeoutMs?: number;
}

export async function sendToPrinter(
  target: PrinterTarget,
  job: PrintPayload,
  jobId: string,
  kind = 'order',
  opts: SendOptions = {},
): Promise<boolean> {
  return sendBufferToPrinter(target, createPrintDocument(kind, job), jobId, opts);
}

export async function sendBufferToPrinter(
  target: PrinterTarget,
  bytes: Buffer,
  jobId: string,
  opts: SendOptions = {},
): Promise<boolean> {
  const attempts = opts.attempts ?? RETRY_ATTEMPTS;
  const backoffMs = opts.backoffMs ?? INITIAL_BACKOFF;
  const timeoutMs = opts.timeoutMs ?? CONNECT_TIMEOUT;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await deliver(target, bytes, timeoutMs);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Printer ${jobId}] Tentativa ${attempt}/${attempts} falhou: ${message}`);
      if (attempt < attempts) {
        const delay = backoffMs * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.error(
    `[Printer ${jobId}] FALHOU após ${attempts} tentativas em ${describeTarget(target)}`,
  );
  return false;
}

function deliver(target: PrinterTarget, bytes: Buffer, timeoutMs: number): Promise<void> {
  switch (target.kind) {
    case 'tcp':
      return sendOnce(target.ip, target.port, bytes, timeoutMs);
    case 'windows':
      return sendToWindowsQueue(target.share, bytes);
    case 'serial':
      return sendToSerialPrinter(target.port, target.baud, bytes);
  }
}

function sendOnce(ip: string, port: number, bytes: Buffer, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: ip, port });
    let settled = false;

    const finish = (err?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    const timer = setTimeout(
      () => finish(new Error(`timeout de impressão em ${ip}:${port}`)),
      timeoutMs,
    );

    socket.on('connect', () => {
      socket.write(bytes, () => socket.end());
    });
    socket.on('close', (hadError) => {
      if (!hadError) finish();
    });
    socket.on('error', (err) => finish(err));
  });
}
