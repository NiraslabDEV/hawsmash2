import type { BridgeConfig, PrinterEndpoint } from './config';
import type { PrintJob } from './types';

export function resolvePrinter(job: PrintJob, config: BridgeConfig): PrinterEndpoint {
  if (job.kind === 'order' && job.station !== 'counter') {
    return config.printers.kitchen;
  }
  return config.printers.counter;
}
