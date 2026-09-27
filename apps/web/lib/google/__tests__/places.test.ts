import { describe, expect, it, vi } from 'vitest';

import { fetchPlaceSummary } from '../places';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Places API — nota e avaliações', () => {
  it('pede só os campos do resumo, com a chave no cabeçalho', async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        displayName: { text: 'Loja Exemplo' },
        rating: 4.7,
        userRatingCount: 312,
        googleMapsUri: 'https://maps.google.com/?cid=1',
      }),
    );

    const result = await fetchPlaceSummary('ChIJ-exemplo', 'CHAVE', fetchImpl as unknown as typeof fetch);

    expect(result).toEqual({
      ok: true,
      place: {
        name: 'Loja Exemplo',
        rating: 4.7,
        reviewCount: 312,
        mapsUri: 'https://maps.google.com/?cid=1',
      },
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://places.googleapis.com/v1/places/ChIJ-exemplo');
    expect(init.headers).toMatchObject({
      'X-Goog-Api-Key': 'CHAVE',
      'X-Goog-FieldMask': 'displayName,rating,userRatingCount,googleMapsUri',
    });
  });

  it('perfil sem avaliações não vira zero inventado', async () => {
    const result = await fetchPlaceSummary(
      'ChIJ-exemplo',
      'CHAVE',
      (async () => json({ displayName: { text: 'Loja nova' } })) as unknown as typeof fetch,
    );
    expect(result).toMatchObject({ ok: true, place: { rating: null, reviewCount: null } });
  });

  it('erro do Google devolve o motivo, sem lançar', async () => {
    const result = await fetchPlaceSummary(
      'ChIJ-exemplo',
      'CHAVE',
      (async () => json({ error: { message: 'API key not valid' } }, 400)) as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('http_400');
  });

  it('rede em baixo devolve erro, sem lançar', async () => {
    const result = await fetchPlaceSummary(
      'ChIJ-exemplo',
      'CHAVE',
      (async () => {
        throw new Error('fetch failed');
      }) as unknown as typeof fetch,
    );
    expect(result).toEqual({ ok: false, error: 'fetch failed' });
  });
});
