import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  describeTarget,
  parsePrinterTarget,
  sendToWindowsQueue,
} from '../printer-target';
import { loadBridgeConfig } from '../config';

const baseEnv = {
  SUPABASE_URL: 'https://exemplo.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  STORE_ID: '00000000-0000-4000-8000-000000000101',
  BRIDGE_DEVICE_ID: '00000000-0000-4000-8000-0000000001ff',
  LOCAL_TOKEN: 'token-local-de-teste-com-32-caracteres',
  LOCAL_ALLOWED_ORIGINS: 'https://staging.hawsmash.test',
};

describe('destino da impressora', () => {
  it('o IP nu continua a significar TCP — os .env das lojas não podem partir', () => {
    expect(parsePrinterTarget('192.168.1.50', 9100)).toEqual({
      kind: 'tcp', ip: '192.168.1.50', port: 9100,
    });
    expect(parsePrinterTarget('tcp://192.168.1.50:9101', 9100)).toEqual({
      kind: 'tcp', ip: '192.168.1.50', port: 9101,
    });
  });

  // O caso do PC touch do HAWSMASH: a impressora acoplada não tem IP, é uma
  // fila de impressão do Windows (BLOQUEIOS B-006).
  it('reconhece a impressora acoplada por fila do Windows', () => {
    expect(parsePrinterTarget('windows://POS80', 9100)).toEqual({
      kind: 'windows', share: 'POS80',
    });
  });

  it('reconhece impressora em porta série, com e sem velocidade', () => {
    expect(parsePrinterTarget('serial://COM3', 9100)).toEqual({
      kind: 'serial', port: 'COM3', baud: 9600,
    });
    expect(parsePrinterTarget('serial://com4@19200', 9100)).toEqual({
      kind: 'serial', port: 'COM4', baud: 19_200,
    });
  });

  it('recusa nomes de partilha que não são nomes de partilha', () => {
    expect(() => parsePrinterTarget('windows://POS80 & del C:', 9100)).toThrow();
    expect(() => parsePrinterTarget('windows://', 9100)).toThrow();
    expect(() => parsePrinterTarget('serial://LPT1', 9100)).toThrow();
  });

  it('descreve o destino de forma legível no arranque', () => {
    expect(describeTarget({ kind: 'tcp', ip: '192.168.1.50', port: 9100 })).toBe('192.168.1.50:9100');
    expect(describeTarget({ kind: 'windows', share: 'POS80' })).toContain('POS80');
  });
});

describe('configuração das estações', () => {
  it('PRINTER_* ganha ao PRINTER_IP_*, e cada estação escolhe o seu destino', () => {
    const config = loadBridgeConfig({
      ...baseEnv,
      PRINTER_IP_KITCHEN: '192.168.1.50',
      PRINTER_IP_COUNTER: '192.168.1.51',
      PRINTER_COUNTER: 'windows://POS80',
    });

    expect(config.printers.kitchen).toEqual({ kind: 'tcp', ip: '192.168.1.50', port: 9100 });
    expect(config.printers.counter).toEqual({ kind: 'windows', share: 'POS80' });
  });

  it('um .env antigo, só com IPs, continua a carregar', () => {
    const config = loadBridgeConfig({
      ...baseEnv,
      PRINTER_IP_KITCHEN: '192.168.1.50',
      PRINTER_IP_COUNTER: '192.168.1.51',
    });

    expect(config.printers.counter).toEqual({ kind: 'tcp', ip: '192.168.1.51', port: 9100 });
  });

  it('um destino inválido falha no arranque e não a meio de uma venda', () => {
    expect(() =>
      loadBridgeConfig({ ...baseEnv, PRINTER_IP_KITCHEN: '1.2.3.4', PRINTER_COUNTER: 'windows://' }),
    ).toThrow(/PRINTER_COUNTER/);
  });
});

describe('entrega na fila do Windows', () => {
  // O copy /b é o único caminho que entrega ESC/POS sem o Windows o rasterizar.
  it('copia os bytes em bruto para a partilha e limpa o ficheiro', async () => {
    let escrito: Buffer | null = null;
    let destino = '';
    const exec = vi.fn(async (_file: string, args: string[]) => {
      escrito = await readFile(args[3]);
      destino = args[4];
    });

    await sendToWindowsQueue('POS80', Buffer.from([0x1b, 0x40, 0x41]), exec);

    expect(exec).toHaveBeenCalledOnce();
    expect(exec.mock.calls[0][1].slice(0, 3)).toEqual(['/c', 'copy', '/b']);
    expect(escrito).toEqual(Buffer.from([0x1b, 0x40, 0x41]));
    expect(destino).toBe('\\\\localhost\\POS80');
  });

  it('propaga a falha para o retry em vez de a engolir', async () => {
    const exec = vi.fn(async () => {
      throw new Error('O nome da rede não foi encontrado');
    });

    await expect(sendToWindowsQueue('POS80', Buffer.from([0x41]), exec)).rejects.toThrow(
      /rede/,
    );
  });

  // Um `copy` para uma fila do Windows pode ficar pendurado para sempre
  // (impressora desligada, spooler encravado). Sem tecto de tempo o poll
  // ficava preso nesse job e o bridge deixava de imprimir tudo, em silencio.
  // O comando REAL tem de correr com timeout — se alguem o tirar, isto falha.
  it('o comando real corre com tecto de tempo', async () => {
    const ficheiro = await readFile(
      new URL('../printer-target.ts', import.meta.url),
      'utf8',
    );
    const chamada = ficheiro.slice(
      ficheiro.indexOf('const runCommand'),
      ficheiro.indexOf('const runCommand') + 400,
    );
    expect(chamada).toMatch(/execFile\([^)]*\{\s*timeout:/s);
  });
});
