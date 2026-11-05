'use client';

import { useState } from 'react';

import { InsightIcon } from '@/components/admin/insights-ui';

import { GarconsDesempenho } from '../garcons-desempenho';
import { GarconsSection } from '../garcons-equipa';

type Tab = 'desempenho' | 'equipa';

/** O módulo dos garçons (1122/1123): os números de cada um e a gestão da equipa. */
export default function GarconsPage() {
  const [tab, setTab] = useState<Tab>('desempenho');

  return (
    <div className="insights">
      <header className="insight-header">
        <div>
          <p className="insight-eyebrow">Equipa de sala</p>
          <h1>Garçons</h1>
          <p className="insight-subtitle">
            {tab === 'desempenho'
              ? 'Quem tira mais pedidos, quem vende mais e como corre a sala.'
              : 'Quem entra no telemóvel para tirar pedidos nas mesas.'}
          </p>
        </div>
      </header>
      <nav className="insight-tabs" aria-label="Vistas dos garçons">
        <button aria-pressed={tab === 'desempenho'} onClick={() => setTab('desempenho')}>
          <InsightIcon name="chart" />
          Desempenho
        </button>
        <button aria-pressed={tab === 'equipa'} onClick={() => setTab('equipa')}>
          <InsightIcon name="orders" />
          Equipa
        </button>
      </nav>
      <div className="mt-6 space-y-6">{tab === 'desempenho' ? <GarconsDesempenho /> : <GarconsSection />}</div>
    </div>
  );
}
