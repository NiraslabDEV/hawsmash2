'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { initTracking, grantConsent, hasConsent, type MarketingConfig } from './track';

/**
 * Carrega a config de marketing (do /api/menu → marketing) e, havendo
 * consentimento, inicializa GTM/GA4/Meta/Ads. Renderiza o banner de consentimento.
 * Colocado dentro do QueryClientProvider (ver app/providers.tsx).
 */
export function AnalyticsProvider() {
  const [decided, setDecided] = useState(true); // evita flash até montar
  const [consented, setConsented] = useState(false);

  const { data } = useQuery({
    queryKey: ['menu'],
    queryFn: async () => {
      const res = await fetch('/api/menu');
      if (!res.ok) throw new Error('menu fetch failed');
      return res.json();
    },
    staleTime: 5 * 60_000,
  });

  const config: MarketingConfig | null = data?.marketing ?? null;
  // Há algo configurado? Se não, nem mostramos o banner.
  const hasAnyTag =
    !!config &&
    Object.values(config).some((v) => typeof v === 'string' && v.length > 0);

  useEffect(() => {
    const already = hasConsent();
    setConsented(already);
    setDecided(already || !hasAnyTag); // só "indeciso" se há tags e ainda não decidiu
  }, [hasAnyTag]);

  // Inicializa quando há consentimento + config.
  useEffect(() => {
    if (consented && config) initTracking(config);
  }, [consented, config]);

  function accept() {
    grantConsent();
    setConsented(true);
    setDecided(true);
  }

  function reject() {
    // Sem cookie de consentimento → nenhum script de marketing carrega.
    setDecided(true);
  }

  if (decided || !hasAnyTag) return null;

  return (
    // O atributo é o gancho para cada pele o levantar do fundo quando tem
    // barra flutuante (ver (public)/_hawsmash/landing.css).
    <div data-consent-banner className="fixed bottom-0 inset-x-0 z-50 p-4">
      <div className="max-w-2xl mx-auto bg-[#1a1612] border border-[#e5a93c]/30 rounded-xl p-4 shadow-2xl flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <p className="text-sm text-gray-300 flex-1">
          Usamos cookies para medir e melhorar a sua experiência. Pode aceitar ou continuar sem
          rastreio de marketing.
        </p>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={reject}
            className="px-4 py-2 rounded-lg border border-[#e5a93c]/20 text-gray-300 hover:text-white text-sm"
          >
            Recusar
          </button>
          <button
            onClick={accept}
            className="px-4 py-2 rounded-lg bg-[#e5a93c] hover:bg-[#d4a035] text-[#0a0807] font-semibold text-sm"
          >
            Aceitar
          </button>
        </div>
      </div>
    </div>
  );
}
