/**
 * Nota e avaliações de uma loja no Google, pela Places API (New).
 *
 * Só precisa de uma chave de servidor (`GOOGLE_PLACES_API_KEY`) — ao contrário
 * da API do Perfil de Empresa, que só abre depois de o Google aprovar o acesso
 * (B-114). Dá o número de hoje, não o histórico: quem quer o mês guarda uma
 * fotografia por mês (1096).
 *
 * Nunca lança. O Google em baixo não pode impedir o resumo de sair (regra 1).
 */

export type PlaceSummary = {
  name: string | null;
  rating: number | null;
  reviewCount: number | null;
  mapsUri: string | null;
};

export type PlaceResult = { ok: true; place: PlaceSummary } | { ok: false; error: string };

/** Só os campos que o resumo usa: menos campos, SKU mais barato. */
const FIELD_MASK = 'displayName,rating,userRatingCount,googleMapsUri';

const TIMEOUT_MS = 10_000;

type PlaceResponse = {
  displayName?: { text?: string };
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
};

export async function fetchPlaceSummary(
  placeId: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PlaceResult> {
  try {
    const response = await fetchImpl(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: 'no-store',
      },
    );
    if (!response.ok) {
      // O corpo do erro do Google diz o motivo (chave, API desligada, ID errado).
      const detail = await response.text().catch(() => '');
      return { ok: false, error: `http_${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}` };
    }
    const body = (await response.json()) as PlaceResponse;
    return {
      ok: true,
      place: {
        name: body.displayName?.text ?? null,
        rating: typeof body.rating === 'number' ? body.rating : null,
        reviewCount: typeof body.userRatingCount === 'number' ? body.userRatingCount : null,
        mapsUri: body.googleMapsUri ?? null,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
