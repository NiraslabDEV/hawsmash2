import { describe, expect, it, vi } from 'vitest';
import { EmolaSimulator } from '@delivery/payments';
import { runPaymentReconciliation, type ReconciliationOrder } from '../reconcile';

describe('reconciliação de e-Mola em processos independentes', () => {
  it('recupera confirmação tardia pela referência persistida, sem voltar a cobrar', async () => {
    const first = new EmolaSimulator();
    const charged = await first.charge({ amountCents: 12345, msisdn: '258871234568', reference: 'PLACEHOLDER_ATTEMPT', description: 'Ensaio' });
    expect(charged.status).toBe('pending');
    const order: ReconciliationOrder = { id: '20000000-0000-4000-8000-000000000001', store_id: '10000000-0000-4000-8000-000000000001', storeSlug: 'loja-a', total_cents: 12345, payment_method: 'emola', payment_reference: 'PLACEHOLDER_ATTEMPT', payment_provider_ref: charged.providerRef, created_at: '2026-09-10T10:00:00.000Z' };
    const second = new EmolaSimulator();
    const charge = vi.spyOn(second, 'charge');
    const confirm = vi.fn(async () => ({ ok: true, result: 'ok', error: null }));
    const configForStore = vi.fn(async () => ({ provider: 'emola_sim' as const, apiKey: null, webhookSecret: null, mpesa: null }));
    const result = await runPaymentReconciliation({ listPage: async ({ after }) => after ? [] : [order], configForStore, buildProvider: () => second, confirm });
    expect(result).toMatchObject({ confirmed: 1, completed: true });
    expect(configForStore).toHaveBeenCalledWith('loja-a', expect.any(AbortSignal), 'emola');
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ method: 'emola', provider: 'emola_sim', amountCents: 12345, providerRef: charged.providerRef }), expect.any(AbortSignal));
    expect(charge).not.toHaveBeenCalled();
  });
});
