// Visor do cliente (mostrador de duas linhas virado para quem paga).
//
// O POS manda semantica ("TOTAL" a esquerda, "450 MT" a direita) e este modulo
// decide a largura, o alinhamento e os bytes. Mesma divisao de trabalho que a
// impressao: trocar o visor por outro modelo nao obriga a mexer no POS.
//
// DECISAO: escrita na porta serie sem modulo nativo. `serialport` traz um
// binding `.node` que o empacotamento SEA do bridge (build:sea) nao consegue
// embutir — o visor partiria o .exe que ja esta a correr nas lojas. Em Windows
// configura-se a porta com `mode.com` e escreve-se em `\\.\COMx` como ficheiro,
// que e o que o driver da porta serie expoe.
import { execFile } from 'node:child_process';
import { createWriteStream, type WriteStream } from 'node:fs';

export type DisplayLine = { left: string; right?: string };

export type DisplayProtocol = 'cd5220' | 'escpos';

export interface CustomerDisplayConfig {
  /** Porta serie ('COM3'), 'sim' para consola, ou vazio = visor desligado. */
  port: string;
  baud: number;
  columns: number;
  protocol: DisplayProtocol;
  /** O que anda de um lado ao outro quando nao ha venda. */
  idleText: string;
  idleSubtext: string;
  /** Milissegundos por passo do texto a andar. */
  idleStepMs: number;
  /** Sem tramas do POS durante este tempo, volta sozinho ao ocioso. */
  idleAfterMs: number;
}

/**
 * Estes visores falam meia tabela de caracteres. Um "c cedilha" ou um "a til"
 * sai como simbolo aleatorio no meio do total — vale mais tirar o acento do que
 * mostrar lixo a quem esta a pagar.
 */
const SUBSTITUTOS = new Map<number, string>([
  [0x2018, "'"], [0x2019, "'"],
  [0x201c, '"'], [0x201d, '"'],
  [0x2013, '-'], [0x2014, '-'],
  [0x00a0, ' '],
]);

export function sanitize(text: string): string {
  // Tudo decidido por codepoint, e o ficheiro fica em ASCII puro. E a mesma
  // razao pela qual o escpos.ts usa escapes: um editor que reguarde o ficheiro
  // noutra codificacao nao desfaz o que aqui esta escrito.
  let out = '';
  for (const char of text.normalize('NFD')) {
    const code = char.codePointAt(0) as number;
    if (code >= 0x0300 && code <= 0x036f) continue; // acento ja separado da letra
    if (code >= 0x20 && code <= 0x7e) {
      out += char;
      continue;
    }
    out += SUBSTITUTOS.get(code) ?? ' ';
  }
  return out;
}

/**
 * Esquerda encostada a esquerda, direita encostada a direita, e o que nao cabe
 * corta-se a esquerda: o valor em dinheiro nunca desaparece por causa de um
 * nome de produto comprido.
 */
export function composeLine(line: DisplayLine, columns: number): string {
  const right = sanitize(line.right ?? '').trim();
  const room = Math.max(0, columns - (right.length > 0 ? right.length + 1 : 0));
  const left = sanitize(line.left).trim().slice(0, room);
  if (right.length === 0) return left.padEnd(columns).slice(0, columns);
  return `${left.padEnd(room)} ${right}`.slice(0, columns);
}

const ESC = 0x1b;

function encodeLines(top: string, bottom: string, protocol: DisplayProtocol): Buffer {
  const upper = Buffer.from(top, 'latin1');
  const lower = Buffer.from(bottom, 'latin1');
  if (protocol === 'cd5220') {
    // CD5220: ESC Q A <linha> CR na linha de cima, ESC Q B <linha> CR na de baixo.
    return Buffer.concat([
      Buffer.from([ESC, 0x51, 0x41]), upper, Buffer.from([0x0d]),
      Buffer.from([ESC, 0x51, 0x42]), lower, Buffer.from([0x0d]),
    ]);
  }
  // Epson DM-D (ESC/POS): limpa (FF) e posiciona o cursor com US $ coluna linha.
  return Buffer.concat([
    Buffer.from([0x0c]),
    Buffer.from([0x1f, 0x24, 0x01, 0x01]), upper,
    Buffer.from([0x1f, 0x24, 0x01, 0x02]), lower,
  ]);
}

export function encodeFrame(
  top: DisplayLine,
  bottom: DisplayLine,
  config: Pick<CustomerDisplayConfig, 'columns' | 'protocol'>,
): Buffer {
  return encodeLines(
    composeLine(top, config.columns),
    composeLine(bottom, config.columns),
    config.protocol,
  );
}

/**
 * A janela do texto a andar. O texto leva um intervalo de brancos atras para o
 * "HAWSMASH" atravessar o visor em vez de saltar de canto a canto.
 */
export function marqueeWindow(text: string, offset: number, columns: number): string {
  const clean = sanitize(text).trim() || ' ';
  const track = `${clean}${' '.repeat(columns)}`;
  const start = ((offset % track.length) + track.length) % track.length;
  return `${track}${track}`.slice(start, start + columns).padEnd(columns);
}

export interface DisplayPort {
  write(chunk: Buffer): Promise<void>;
  close(): void;
}

/** Visor em modo simulador: sai na consola, para se desenvolver sem hardware. */
export function createConsolePort(columns: number): DisplayPort {
  return {
    async write(chunk) {
      const text = chunk.toString('latin1').replace(/[^\x20-\x7e]/g, '.');
      console.log(`[Visor ${columns}] ${text}`);
    },
    close() {},
  };
}

/**
 * Porta serie em Windows. Se a porta nao existir ou o cabo sair, `write`
 * devolve normalmente e a stream e deitada fora — a proxima trama volta a
 * tentar abrir. Nunca lanca: o visor e best-effort.
 */
export function createWindowsSerialPort(portName: string, baud: number): DisplayPort {
  const device = `\\\\.\\${portName}`;
  let stream: WriteStream | null = null;
  let configured = false;

  function configure(): void {
    if (configured) return;
    configured = true;
    execFile(
      'mode.com',
      [
        `${portName}:`,
        `BAUD=${baud}`, 'PARITY=n', 'DATA=8', 'STOP=1',
        'xon=off', 'octs=off', 'odsr=off', 'idsr=off', 'dtr=on', 'rts=on',
      ],
      (error) => {
        if (error) console.warn(`[Visor] mode.com falhou em ${portName}: ${error.message}`);
      },
    );
  }

  function open(): WriteStream | null {
    if (stream) return stream;
    try {
      configure();
      const opened = createWriteStream(device);
      opened.on('error', (error) => {
        console.warn(`[Visor] ${portName} indisponivel: ${error.message}`);
        stream = null;
      });
      stream = opened;
      return opened;
    } catch (error) {
      console.warn(`[Visor] nao abriu ${portName}: ${(error as Error).message}`);
      stream = null;
      return null;
    }
  }

  return {
    async write(chunk) {
      const target = open();
      if (!target) return;
      await new Promise<void>((resolve) => {
        target.write(chunk, () => resolve());
      });
    },
    close() {
      stream?.destroy();
      stream = null;
    },
  };
}

export function createDisplayPort(config: CustomerDisplayConfig): DisplayPort | null {
  if (!config.port) return null;
  if (config.port === 'sim') return createConsolePort(config.columns);
  return createWindowsSerialPort(config.port, config.baud);
}

/**
 * O visor propriamente dito.
 *
 * O texto a andar vive aqui e nao no POS de proposito: se o operador fechar o
 * separador, se o PC bloquear o ecra ou se o browser adormecer o temporizador,
 * o nome da casa continua a andar para quem esta do outro lado do balcao.
 */
export class CustomerDisplay {
  private readonly config: CustomerDisplayConfig;
  private readonly port: DisplayPort | null;
  private marqueeTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private offset = 0;
  private lastFrame = '';

  constructor(config: CustomerDisplayConfig, port: DisplayPort | null = createDisplayPort(config)) {
    this.config = config;
    this.port = port;
  }

  get enabled(): boolean {
    return this.port !== null;
  }

  show(top: DisplayLine, bottom: DisplayLine): void {
    if (!this.port) return;
    this.stopMarquee();
    this.armWatchdog();
    void this.paint(top, bottom);
  }

  idle(): void {
    if (!this.port) return;
    if (this.marqueeTimer) return;
    this.clearWatchdog();
    this.offset = 0;
    this.paintMarquee();
    this.marqueeTimer = setInterval(() => this.paintMarquee(), this.config.idleStepMs);
    this.marqueeTimer.unref?.();
  }

  stop(): void {
    this.stopMarquee();
    this.clearWatchdog();
    this.port?.close();
  }

  private paintMarquee(): void {
    const top = marqueeWindow(this.config.idleText, this.offset, this.config.columns);
    this.offset += 1;
    void this.paint({ left: top }, { left: this.config.idleSubtext });
  }

  private async paint(top: DisplayLine, bottom: DisplayLine): Promise<void> {
    if (!this.port) return;
    const buffer = encodeFrame(top, bottom, this.config);
    const key = buffer.toString('latin1');
    if (key === this.lastFrame) return;
    this.lastFrame = key;
    try {
      await this.port.write(buffer);
    } catch {
      // Best-effort: um visor que nao escreve nao pode partir o bridge.
    }
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    this.watchdog = setTimeout(() => this.idle(), this.config.idleAfterMs);
    this.watchdog.unref?.();
  }

  private clearWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
  }

  private stopMarquee(): void {
    if (this.marqueeTimer) clearInterval(this.marqueeTimer);
    this.marqueeTimer = null;
  }
}
