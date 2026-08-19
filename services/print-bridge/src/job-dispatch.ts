import type { PrinterEndpoint } from './config';
import { sendDrawerPulse } from './drawer';
import { sendToPrinter } from './printer-client';
import type { PrintJob, PrintPayload } from './types';

interface DispatchDependencies {
  print(
    printer: PrinterEndpoint,
    kind: PrintJob['kind'],
    payload: PrintPayload,
    requestId: string,
  ): Promise<boolean>;
  drawer(printer: PrinterEndpoint, requestId: string): Promise<boolean>;
}

const defaultDependencies: DispatchDependencies = {
  print: (printer, kind, payload, requestId) =>
    sendToPrinter(printer.ip, printer.port, payload, requestId, kind),
  drawer: sendDrawerPulse,
};

export function dispatchPrintJob(
  job: PrintJob,
  printer: PrinterEndpoint,
  dependencies: DispatchDependencies = defaultDependencies,
): Promise<boolean> {
  if (job.kind === 'drawer') return dependencies.drawer(printer, job.id);
  return dependencies.print(printer, job.kind, job.payload, job.id);
}
