import type { BridgeConfig } from './config';
import type { PrinterTarget } from './printer-target';
import type { PrintJob } from './types';

export function resolvePrinter(job: PrintJob, config: BridgeConfig): PrinterTarget {
  if (job.kind === 'order' && job.station !== 'counter') {
    return config.printers.kitchen;
  }
  return config.printers.counter;
}
