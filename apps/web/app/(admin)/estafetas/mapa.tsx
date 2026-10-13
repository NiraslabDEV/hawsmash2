'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

import { isStale, positionAge } from '@/lib/estafeta/tracking';

export type PontoEstafeta = {
  id: string;
  nome: string;
  lat: number;
  lng: number;
  recordedAt: string;
  aCaminho: boolean;
};

// Centro de fábrica quando ainda não há ninguém no mapa: Maputo.
const CENTRO_INICIAL: [number, number] = [-25.9653, 32.5892];

/**
 * Mapa dos estafetas de serviço (OpenStreetMap, sem chave). O Leaflet só
 * carrega no browser; o painel não o puxa para as outras abas.
 */
export function MapaEstafetas({ pontos }: { pontos: PontoEstafeta[] }) {
  const caixa = useRef<HTMLDivElement>(null);
  const mapa = useRef<import('leaflet').Map | null>(null);
  const camada = useRef<import('leaflet').LayerGroup | null>(null);
  const enquadrado = useRef(false);

  useEffect(() => {
    let cancelado = false;
    void import('leaflet').then((L) => {
      if (cancelado || !caixa.current || mapa.current) return;
      mapa.current = L.map(caixa.current, { zoomControl: true, attributionControl: true }).setView(CENTRO_INICIAL, 12);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(mapa.current);
      camada.current = L.layerGroup().addTo(mapa.current);
      desenhar(L);
    });
    return () => {
      cancelado = true;
      mapa.current?.remove();
      mapa.current = null;
      camada.current = null;
      enquadrado.current = false;
    };
    // O mapa cria-se uma vez; os pontos actualizam-se no efeito de baixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void import('leaflet').then((L) => desenhar(L));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pontos]);

  function desenhar(L: typeof import('leaflet')) {
    if (!mapa.current || !camada.current) return;
    camada.current.clearLayers();
    for (const p of pontos) {
      const velho = isStale(p.recordedAt);
      const cor = velho ? '#8A7A69' : p.aCaminho ? '#38bdf8' : '#34d399';
      L.circleMarker([p.lat, p.lng], {
        radius: 10,
        color: '#000',
        weight: 2,
        fillColor: cor,
        fillOpacity: 0.95,
      })
        .bindTooltip(`${p.nome} · ${positionAge(p.recordedAt)}`, { permanent: true, direction: 'top', offset: [0, -10] })
        .addTo(camada.current);
    }
    // Enquadra na primeira vez que há pontos; depois respeita o zoom de quem está a ver.
    if (!enquadrado.current && pontos.length > 0) {
      enquadrado.current = true;
      const bounds = L.latLngBounds(pontos.map((p) => [p.lat, p.lng] as [number, number]));
      mapa.current.fitBounds(bounds.pad(0.3), { maxZoom: 15 });
    }
  }

  // `isolate z-0`: as camadas do Leaflet usam z-index 400+ e passavam por cima
  // dos formulários (Pagar, PIN) do painel.
  return <div ref={caixa} className="relative isolate z-0 h-[340px] w-full overflow-hidden rounded-2xl border border-white/[0.08]" />;
}
