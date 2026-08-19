// Cliente TCP da impressora (porta ESC/POS, normalmente 9100), com retry/backoff.
import { createConnection } from 'node:net';
import { buildReceipt } from './escpos.js';

const RETRY_ATTEMPTS = 3;
const INITIAL_BACKOFF = 1000; // 1s
const CONNECT_TIMEOUT = 5000; // 5s por tentativa

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Envia o cupom de um pedido para a impressora via TCP.
 * Tenta `attempts` vezes com backoff exponencial. Retorna true se imprimiu.
 * NUNCA lança — a impressão é redundância, nunca bloqueia o pedido.
 */
export async function sendToPrinter(ip, port, order, opts = {}) {
  let bytes;
  try {
    bytes = buildReceipt(order);
  } catch (e) {
    console.error('[Printer] Falha ao montar o cupom:', e.message);
    return false;
  }
  return sendBytes(ip, port, bytes, opts);
}

/** Envia um buffer já montado (ex.: cupom de teste). Mesma lógica de retry. */
export async function sendBytes(ip, port, bytes, opts = {}) {
  const attempts = opts.attempts ?? RETRY_ATTEMPTS;
  const backoffMs = opts.backoffMs ?? INITIAL_BACKOFF;
  const timeoutMs = opts.timeoutMs ?? CONNECT_TIMEOUT;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await sendOnce(ip, port, bytes, timeoutMs);
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[Printer] Tentativa ${attempt}/${attempts} falhou: ${msg}`);
      if (attempt < attempts) await sleep(backoffMs * 2 ** (attempt - 1));
    }
  }
  console.error(`[Printer] FALHOU após ${attempts} tentativas em ${ip}:${port}`);
  return false;
}

function sendOnce(ip, port, bytes, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: ip, port });
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    const timer = setTimeout(() => finish(new Error(`timeout em ${ip}:${port}`)), timeoutMs);

    socket.on('connect', () => {
      // Escreve os bytes e fecha o lado de escrita; o 'close' confirma o envio.
      socket.write(bytes, () => socket.end());
    });
    socket.on('close', (hadError) => {
      if (!hadError) finish();
    });
    socket.on('error', (err) => finish(err));
  });
}
