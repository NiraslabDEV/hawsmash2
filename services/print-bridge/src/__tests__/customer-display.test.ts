import { describe, expect, it, vi } from 'vitest';
import {
  CustomerDisplay,
  composeLine,
  encodeFrame,
  marqueeWindow,
  sanitize,
  type CustomerDisplayConfig,
  type DisplayPort,
} from '../customer-display';

const config: CustomerDisplayConfig = {
  port: 'sim',
  baud: 9600,
  columns: 20,
  protocol: 'cd5220',
  idleText: 'HAWSMASH',
  idleSubtext: 'BEM-VINDO',
  idleStepMs: 300,
  idleAfterMs: 90_000,
};

function memoryPort(): DisplayPort & { frames: string[] } {
  const frames: string[] = [];
  return {
    frames,
    async write(chunk) {
      frames.push(chunk.toString('latin1'));
    },
    close() {},
  };
}

describe('visor do cliente — bytes e alinhamento', () => {
  it('tira os acentos que o visor não sabe desenhar', () => {
    expect(sanitize('Ação · Pão')).toBe('Acao   Pao');
  });

  it('encosta o dinheiro à direita e corta o nome, nunca o valor', () => {
    expect(composeLine({ left: 'TOTAL', right: '1 250 MT' }, 20)).toBe('TOTAL       1 250 MT');
    expect(composeLine({ left: 'Double Brisket Bacon', right: '450 MT' }, 20))
      .toBe('Double Briske 450 MT');
  });

  it('preenche a linha toda mesmo sem valor à direita', () => {
    expect(composeLine({ left: 'OBRIGADO!' }, 20)).toBe('OBRIGADO!           ');
  });

  it('escreve as duas linhas em CD5220', () => {
    const bytes = encodeFrame({ left: 'TOTAL', right: '450 MT' }, { left: 'M-PESA' }, config);
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0x1b, 0x51, 0x41]));
    expect(bytes.includes(Buffer.from([0x1b, 0x51, 0x42]))).toBe(true);
    expect(bytes.toString('latin1')).toContain('450 MT');
  });

  it('escreve as duas linhas em ESC/POS posicionando o cursor', () => {
    const bytes = encodeFrame({ left: 'A' }, { left: 'B' }, { ...config, protocol: 'escpos' });
    expect(bytes[0]).toBe(0x0c);
    expect(bytes.includes(Buffer.from([0x1f, 0x24, 0x01, 0x02]))).toBe(true);
  });

  it('faz o nome da casa atravessar o visor em vez de saltar de canto', () => {
    expect(marqueeWindow('HAWSMASH', 0, 20)).toBe('HAWSMASH            ');
    expect(marqueeWindow('HAWSMASH', 4, 20)).toBe('MASH' + ' '.repeat(16));
    // O texto sai pela esquerda e volta a entrar pela direita depois do intervalo.
    expect(marqueeWindow('HAWSMASH', 20, 20)).toBe(' '.repeat(8) + 'HAWSMASH' + ' '.repeat(4));
    expect(marqueeWindow('HAWSMASH', 28, 20)).toBe(marqueeWindow('HAWSMASH', 0, 20));
  });
});

describe('visor do cliente — comportamento', () => {
  it('desligado quando não há porta configurada, e sem partir nada', () => {
    const display = new CustomerDisplay({ ...config, port: '' }, null);
    expect(display.enabled).toBe(false);
    expect(() => {
      display.show({ left: 'TOTAL' }, { left: '450 MT' });
      display.idle();
      display.stop();
    }).not.toThrow();
  });

  it('não repete a mesma trama na porta série', async () => {
    const port = memoryPort();
    const display = new CustomerDisplay(config, port);

    display.show({ left: 'TOTAL', right: '450 MT' }, { left: 'M-PESA' });
    display.show({ left: 'TOTAL', right: '450 MT' }, { left: 'M-PESA' });
    await Promise.resolve();

    expect(port.frames).toHaveLength(1);
    display.stop();
  });

  // O texto a andar vive no bridge exactamente para isto: continua mesmo que o
  // browser do POS adormeça o temporizador.
  it('anda sozinho no ocioso, sem depender do POS', async () => {
    vi.useFakeTimers();
    const port = memoryPort();
    const display = new CustomerDisplay(config, port);

    display.idle();
    await vi.advanceTimersByTimeAsync(config.idleStepMs * 3);
    display.stop();
    vi.useRealTimers();

    expect(port.frames.length).toBeGreaterThan(2);
    expect(new Set(port.frames).size).toBe(port.frames.length);
  });

  it('volta sozinho ao ocioso se o POS deixar de falar', async () => {
    vi.useFakeTimers();
    const port = memoryPort();
    const display = new CustomerDisplay({ ...config, idleAfterMs: 1_000 }, port);

    display.show({ left: 'TOTAL', right: '450 MT' }, { left: 'M-PESA' });
    await vi.advanceTimersByTimeAsync(1_500);
    display.stop();
    vi.useRealTimers();

    expect(port.frames.length).toBeGreaterThan(1);
    expect(port.frames.at(-1)).toContain('BEM-VINDO');
  });
});
