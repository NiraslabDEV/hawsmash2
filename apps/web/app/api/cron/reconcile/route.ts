import { buildProvider, getPaymentConfig } from '@/lib/payments/config';
import { confirmOrderPaid } from '@/lib/payments/confirm';
import { serviceClient } from '@/lib/payments/direct';
import { createReconciliationRepository, handleReconciliationRequest, runPaymentReconciliation } from '@/lib/payments/reconcile';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Consulta estados por loja; nunca inicia cobranças ou inventa uma falha. */
export async function GET(request: Request) {
  return handleReconciliationRequest(request, {
    secret: process.env.CRON_SECRET,
    run: async (cursor) => {
      const svc = serviceClient();
      return runPaymentReconciliation({
        listPage: createReconciliationRepository(svc),
        configForStore: (slug, signal, method) => getPaymentConfig(slug, { signal, requireStore: true, method }),
        buildProvider,
        confirm: (input, signal) => confirmOrderPaid({ ...input, svc: serviceClient({ signal }) }),
      }, { cursor, signal: request.signal });
    },
  });
}
