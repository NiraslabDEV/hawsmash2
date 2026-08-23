// Para onde vai o papel.
//
// O bridge nasceu a falar TCP 9100 — impressoras de rede, que e o que
// docs/HARDWARE.md sempre previu para a loja: a cozinha imprime mesmo com o PC
// do balcao fechado. Mas o PC touch do HAWSMASH traz uma **impressora
// acoplada**, que em Windows nao e um endereco IP: e uma fila de impressao
// (a POS80 na porta VPORT-USB:, ver BLOQUEIOS B-006).
//
// Sem isto, uma venda ao balcao criava o print_job e ficava-se por ai — o papel
// nunca saia, porque nao havia para onde o mandar.
//
// DECISAO: nada de modulo nativo. Escrever em bruto para uma fila do Windows
// faz-se partilhando a impressora e copiando os bytes para \\localhost\Partilha.
// E a mesma razao do visor: um binding .node partiria o empacotamento SEA.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type PrinterTarget =
  /** Impressora de rede: o que as lojas usam na cozinha e no balcao. */
  | { kind: 'tcp'; ip: string; port: number }
  /** Impressora acoplada ao PC, por fila de impressao partilhada do Windows. */
  | { kind: 'windows'; share: string }
  /** Impressora em porta serie. */
  | { kind: 'serial'; port: string; baud: number };

const SHARE_PATTERN = /^[A-Za-z0-9_$.-]{1,80}$/;
const COM_PATTERN = /^COM\d{1,3}$/i;

export function describeTarget(target: PrinterTarget): string {
  switch (target.kind) {
    case 'tcp':
      return `${target.ip}:${target.port}`;
    case 'windows':
      return `\\\\localhost\\${target.share} (fila do Windows)`;
    case 'serial':
      return `${target.port} @ ${target.baud}`;
  }
}

/**
 * Le um destino do `.env`.
 *
 * Aceita `tcp://192.168.1.50:9100`, `windows://POS80`, `serial://COM3` (ou
 * `serial://COM3@19200`), e um IP nu — que e o formato que os `.env` que ja
 * existem nas lojas usam e que nao pode deixar de funcionar.
 */
export function parsePrinterTarget(value: string, defaultPort: number): PrinterTarget {
  const bruto = value.trim();
  if (!bruto) throw new Error('destino de impressora vazio');

  if (bruto.toLowerCase().startsWith('windows://')) {
    const share = bruto.slice('windows://'.length).replace(/^\/+|\/+$/g, '');
    if (!SHARE_PATTERN.test(share)) {
      throw new Error(`nome de partilha invalido: ${share}`);
    }
    return { kind: 'windows', share };
  }

  if (bruto.toLowerCase().startsWith('serial://')) {
    const [porta, baud] = bruto.slice('serial://'.length).split('@');
    if (!COM_PATTERN.test(porta)) throw new Error(`porta serie invalida: ${porta}`);
    const velocidade = baud ? Number(baud) : 9600;
    if (!Number.isInteger(velocidade) || velocidade <= 0) {
      throw new Error(`velocidade invalida: ${baud}`);
    }
    return { kind: 'serial', port: porta.toUpperCase(), baud: velocidade };
  }

  const semEsquema = bruto.toLowerCase().startsWith('tcp://') ? bruto.slice('tcp://'.length) : bruto;
  const [host, porta] = semEsquema.split(':');
  if (!host) throw new Error(`destino de impressora invalido: ${value}`);
  const numero = porta ? Number(porta) : defaultPort;
  if (!Number.isInteger(numero) || numero <= 0 || numero > 65_535) {
    throw new Error(`porta invalida: ${porta}`);
  }
  return { kind: 'tcp', ip: host, port: numero };
}

export type Executor = (file: string, args: string[]) => Promise<void>;

const runCommand: Executor = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}${stderr ? ` — ${stderr}` : ''}`));
        return;
      }
      resolve();
    });
  });

/**
 * Bytes em bruto para uma fila de impressao do Windows.
 *
 * Passa por ficheiro temporario de proposito: o `copy /b` e o unico caminho
 * que entrega ESC/POS **sem o Windows o rasterizar**. Ligar o driver a
 * "Graphic" ou os "advanced printing features" transforma os bytes numa imagem
 * e o talao sai em branco ou em garatujas (BLOQUEIOS B-006).
 */
export async function sendToWindowsQueue(
  share: string,
  bytes: Buffer,
  exec: Executor = runCommand,
): Promise<void> {
  if (!SHARE_PATTERN.test(share)) throw new Error(`nome de partilha invalido: ${share}`);
  const ficheiro = join(tmpdir(), `hawsmash-print-${randomUUID()}.bin`);
  await writeFile(ficheiro, bytes);
  try {
    await exec('cmd', ['/c', 'copy', '/b', ficheiro, `\\\\localhost\\${share}`]);
  } finally {
    await unlink(ficheiro).catch(() => undefined);
  }
}

/** Bytes em bruto para uma impressora em porta serie. Mesmo caminho do visor. */
export async function sendToSerialPrinter(
  port: string,
  baud: number,
  bytes: Buffer,
  exec: Executor = runCommand,
): Promise<void> {
  if (!COM_PATTERN.test(port)) throw new Error(`porta serie invalida: ${port}`);
  await exec('mode.com', [
    `${port}:`,
    `BAUD=${baud}`, 'PARITY=n', 'DATA=8', 'STOP=1',
    'xon=off', 'octs=off', 'odsr=off', 'idsr=off', 'dtr=on', 'rts=on',
  ]).catch(() => undefined); // configurar e best-effort; escrever e que conta
  await writeFile(`\\\\.\\${port}`, bytes);
}
