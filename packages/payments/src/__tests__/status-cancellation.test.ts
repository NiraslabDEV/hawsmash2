import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { MpesaProvider } from '../mpesa/mpesa-provider';
import { PaysuiteProvider } from '../paysuite-provider';

afterEach(() => vi.unstubAllGlobals());
describe('consultas de estado canceláveis', () => {
  it('Paysuite cancela o fetch de estado e fica pendente', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const fakeFetch = vi.fn(async (_url, init: RequestInit) => {
      received = init.signal as AbortSignal;
      if (!received) throw new Error('signal_required');
      await new Promise<void>((resolve) => received!.addEventListener('abort', () => resolve(), { once: true }));
      throw new DOMException('cancelado', 'AbortError');
    });
    vi.stubGlobal('fetch', fakeFetch);
    const work = new PaysuiteProvider('PLACEHOLDER_KEY', 'PLACEHOLDER_SECRET').getPaymentStatus('PLACEHOLDER_REFERENCE', { signal: controller.signal });
    await vi.waitFor(() => expect(fakeFetch).toHaveBeenCalled());
    expect(received).toBeDefined(); controller.abort();
    expect(await work).toBe('pending'); expect(received!.aborted).toBe(true);
  });
  it('M-Pesa cancela também a obtenção de sessão e não começa a consulta depois', async () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const config = { apiKey: 'PLACEHOLDER_KEY', publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), serviceProviderCode: 'PLACEHOLDER_CODE', sessionBaseUrl: 'https://session.example', chargeBaseUrl: 'https://charge.example', queryBaseUrl: 'https://query.example' };
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const fakeFetch = vi.fn(async (_url, init: RequestInit) => {
      received = init.signal as AbortSignal;
      await new Promise<void>((resolve) => received!.addEventListener('abort', () => resolve(), { once: true }));
      throw new DOMException('cancelado', 'AbortError');
    });
    vi.stubGlobal('fetch', fakeFetch);
    const work = new MpesaProvider(config).getPaymentStatus('PLACEHOLDER_REFERENCE', { signal: controller.signal });
    await vi.waitFor(() => expect(fakeFetch).toHaveBeenCalled()); controller.abort();
    await vi.waitFor(() => expect(received!.aborted).toBe(true), { timeout: 100 });
    expect(await work).toBe('pending'); expect(fakeFetch).toHaveBeenCalledTimes(1);
  });
});
