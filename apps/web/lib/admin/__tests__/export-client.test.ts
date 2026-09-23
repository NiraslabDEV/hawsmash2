import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn() }));
vi.mock('@/utils/supabase/client', () => ({ createClient: () => ({ auth: mock }) }));
import { fetchAccountingExport } from '../export-client';
const fetchMock = vi.fn();
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch', fetchMock); mock.getSession.mockResolvedValue({ data: { session: { access_token: 'PLACEHOLDER_TOKEN' } }, error: null }); });
afterEach(() => vi.unstubAllGlobals());
describe('autenticação da exportação no navegador', () => {
  it('envia o token no cabeçalho, nunca no URL', async () => {
    fetchMock.mockResolvedValue(new Response('csv'));
    await fetchAccountingExport(new URLSearchParams({ store_id: 'all' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/reports/export-sales?store_id=all', expect.objectContaining({ headers: { Authorization: 'Bearer PLACEHOLDER_TOKEN' }, cache: 'no-store' }));
  });
  it('renova uma sessão expirada e repete uma única vez', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(new Response('csv'));
    mock.refreshSession.mockResolvedValue({ data: { session: { access_token: 'PLACEHOLDER_NEW' } }, error: null });
    expect((await fetchAccountingExport(new URLSearchParams())).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer PLACEHOLDER_NEW');
  });
  it('não pede ficheiro sem sessão nem repete recusas de permissão', async () => {
    mock.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    await expect(fetchAccountingExport(new URLSearchParams())).rejects.toThrow('Volte a entrar');
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(new Response('', { status: 403 }));
    expect((await fetchAccountingExport(new URLSearchParams())).status).toBe(403);
    expect(mock.refreshSession).not.toHaveBeenCalled();
  });
});
