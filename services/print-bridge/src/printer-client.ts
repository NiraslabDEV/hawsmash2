// TCP printer client com retry/backoff.
import { createConnection } from 'net';
import { createPrintDocument } from './escpos';
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
  ip: string,
  port: number,
  job: PrintPayload,
  jobId: string,
  kind = 'order',
  opts: SendOptions = {},
): Promise<boolean> {
  return sendBufferToPrinter(ip, port, createPrintDocument(kind, job), jobId, opts);
}

export async function sendBufferToPrinter(
  ip: string,
  port: number,
  bytes: Buffer,
  jobId: string,
  opts: SendOptions = {},
): Promise<boolean> {
  const attempts = opts.attempts ?? RETRY_ATTEMPTS;
  const backoffMs = opts.backoffMs ?? INITIAL_BACKOFF;
  const timeoutMs = opts.timeoutMs ?? CONNECT_TIMEOUT;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await sendOnce(ip, port, bytes, timeoutMs);
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

  console.error(`[Printer ${jobId}] FALHOU após ${attempts} tentativas em ${ip}:${port}`);
  return false;
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
