import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), rpc: vi.fn(), range: vi.fn(), order: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mock.createClient }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }));
import { GET } from '../../../app/api/reports/export-sales/route';

const row = { store_name: 'PLACEHOLDER_LOJA', sale_date: '2026-09-24', sale_time: '12:00', order_number: 'TESTE-1', daily_number: 1, channel: 'counter', order_status: 'paid', customer_name: '', customer_phone: null, subtotal_cents: 100, delivery_fee_cents: 0, order_total_cents: 100, payment_method: 'cash', payment_amount_cents: 100, payment_status: 'confirmed', payment_reference: null };
const request = (query = '', token = 'PLACEHOLDER_TOKEN') => new Request(`http://localhost/api/reports/export-sales?store_id=all&from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:3020');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'PLACEHOLDER_ANON');
  mock.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  mock.range.mockResolvedValue({ data: [row], count: 1, error: null });
  const chain = { order: mock.order, range: mock.range };
  mock.order.mockReturnValue(chain); mock.rpc.mockReturnValue(chain);
  mock.createClient.mockReturnValue({ auth: { getUser: mock.getUser }, rpc: mock.rpc });
});

describe('GET export-sales', () => {
  it('exporta com a sessão Bearer do painel, sem depender de cookies ou service key', async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(mock.createClient).toHaveBeenCalledWith('http://127.0.0.1:3020', 'PLACEHOLDER_ANON', expect.objectContaining({ global: { headers: { Authorization: 'Bearer PLACEHOLDER_TOKEN' } } }));
    expect(mock.getUser).toHaveBeenCalledWith('PLACEHOLDER_TOKEN');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(await res.text()).toContain('TESTE-1');
  });
  it('sem sessão ou com sessão inválida não chama a RPC', async () => {
    expect((await GET(request('', ''))).status).toBe(401);
    mock.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } });
    expect((await GET(request())).status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it('preserva a recusa da RPC para outra loja/perfil', async () => {
    mock.range.mockResolvedValue({ data: null, error: { code: 'P0403', message: 'export_access_denied' } });
    expect((await GET(request())).status).toBe(403);
  });
  it.each(['&from=invalid', '&to=2020-01-01T00:00:00Z', '&format=winrest', '&layout=unknown', '&store_id=wrong'])('recusa parâmetros inválidos: %s', async (params) => {
    // Substituir os parâmetros originais, sem ambiguidade de query duplicada.
    const req = request(); const url = new URL(req.url);
    new URLSearchParams(params.slice(1)).forEach((value, key) => url.searchParams.set(key, value));
    expect((await GET(new Request(url, { headers: req.headers }))).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it('encaminha a loja concreta e o período normalizado para a RPC autorizada', async () => {
    const req = request(); const url = new URL(req.url);
    url.searchParams.set('store_id', '10000000-0000-4000-8000-000000000002');
    const response = await GET(new Request(url, { headers: req.headers }));
    expect(response.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith('export_sales_for_accounting', { p_store_id: '10000000-0000-4000-8000-000000000002', p_from: '2026-09-01T00:00:00.000Z', p_to: '2026-10-01T00:00:00.000Z' }, { count: 'exact' });
  });
  it('recusa contagem ausente e conjuntos acima do limite sem truncar', async () => {
    mock.range.mockResolvedValueOnce({ data: [row], count: null, error: null });
    expect((await GET(request())).status).toBe(503);
    mock.range.mockResolvedValueOnce({ data: [row], count: 50001, error: null });
    expect((await GET(request())).status).toBe(413);
  });
  it('não expõe dados internos numa falha de rede ou dados inválidos', async () => {
    mock.range.mockRejectedValueOnce(new Error('PLACEHOLDER_INTERNAL_SECRET'));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('PLACEHOLDER_INTERNAL_SECRET');
    mock.range.mockResolvedValueOnce({ data: [{ ...row, payment_amount_cents: 12.5 }], count: 1, error: null });
    expect((await GET(request())).status).toBe(503);
  });
  it('exporta mais de mil pagamentos, mesmo com um limite de página inferior ao pedido', async () => {
    mock.range.mockImplementation(async (from: number) => ({ data: Array.from({ length: Math.min(200, 1201 - from) }, (_, i) => ({ ...row, order_number: `TESTE-${from + i}` })), count: 1201, error: null }));
    const res = await GET(request());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('TESTE-1200');
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(1202);
    expect(mock.range).toHaveBeenCalledTimes(7);
  });
  it('não devolve CSV parcial se a segunda página falhar ou a contagem mudar', async () => {
    mock.range.mockResolvedValueOnce({ data: [row], count: 2, error: null }).mockResolvedValueOnce({ data: null, count: null, error: { message: 'timeout' } });
    const res = await GET(request());
    expect(res.status).toBe(503); expect(res.headers.get('content-type')).toContain('application/json');
    mock.range.mockResolvedValueOnce({ data: [row], count: 2, error: null }).mockResolvedValueOnce({ data: [row], count: 3, error: null });
    expect((await GET(request())).status).toBe(409);
  });
});
