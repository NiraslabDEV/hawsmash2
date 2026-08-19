import type { PrinterEndpoint } from './config';
import { sendBufferToPrinter, type SendOptions } from './printer-client';

export const DRAWER_PULSE = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);

export async function sendDrawerPulse(
  printer: PrinterEndpoint,
  requestId: string,
  options?: SendOptions,
): Promise<boolean> {
  return sendBufferToPrinter(printer.ip, printer.port, DRAWER_PULSE, requestId, options);
}
