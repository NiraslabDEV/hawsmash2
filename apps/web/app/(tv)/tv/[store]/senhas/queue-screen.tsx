'use client';

import { useBrand } from '@/lib/brand/context';
import { FACTORY_TV_CONFIG } from '@/lib/tv/settings';

import { SenhasFull, SenhasHighlight, TvHeader } from '../../_screen/senhas-views';
import { useStoreQueue } from '../../_screen/use-store-queue';

const OPCOES = FACTORY_TV_CONFIG.senhas;

/**
 * Ecrã de senhas do balcão com os valores de fábrica. Continua a existir para
 * as TVs que já apontam para `/tv/[loja]/senhas`; a TV configurável (título,
 * tempos, vídeos) é `/tv/[loja]/[tv]`, gerida na aba TVs do painel (1090).
 */
export function QueueScreen({ storeSlug, storeName }: { storeSlug: string; storeName: string }) {
  const brand = useBrand();
  const { queue, stale, highlight } = useStoreQueue(storeSlug, { highlightSeconds: OPCOES.highlightSeconds });

  return (
    <main className="relative flex h-screen flex-col overflow-hidden">
      <TvHeader title={`${brand.name} ${storeName}`} showClock={false} stale={stale} right={OPCOES.title} />
      <div className="min-h-0 flex-1">
        <SenhasFull ready={queue?.ready ?? []} preparing={queue?.preparing ?? []} options={OPCOES} />
      </div>
      {highlight && <SenhasHighlight entry={highlight} options={OPCOES} />}
    </main>
  );
}
