'use client';

import { useEffect, useMemo, useState } from 'react';

import { InsightIcon } from '@/components/admin/insights-ui';

type Icon = Parameters<typeof InsightIcon>[0]['name'];
import { maputoToday } from '@/lib/escritorio/regras';
import { createClient } from '@/utils/supabase/client';

import { Arquivo } from './arquivo';
import { Compras } from './compras';
import { Contabilista } from './contabilista';
import { Documentos } from './documentos';
import { Facturacao } from './facturacao';
import { Obrigacoes } from './obrigacoes';
import { Pessoal } from './pessoal';
import { Resumo } from './resumo';
import type { Role, Store } from './ui';

type Tab = 'resumo' | 'documentos' | 'compras' | 'obrigacoes' | 'arquivo' | 'pessoal' | 'contabilista' | 'facturacao';

const TABS: Array<{ id: Tab; label: string; icon: Icon; ownerOnly?: boolean; subtitle: string }> = [
  { id: 'resumo', label: 'Resumo do mês', icon: 'chart', subtitle: 'Vendas, IVA e o que entregar ao contabilista, mês a mês.' },
  { id: 'documentos', label: 'Facturas', icon: 'orders', subtitle: 'Todas as Facturas-Recibo e Notas de Crédito: pesquisar, imprimir, 2.ª via e NUIT depois.' },
  { id: 'compras', label: 'Compras', icon: 'ticket', subtitle: 'As facturas dos fornecedores, com fotografia, para o IVA a deduzir.' },
  { id: 'obrigacoes', label: 'Obrigações', icon: 'clock', subtitle: 'Prazos do mês e do ano, com aviso antes. Marca como feito e o aviso pára.' },
  { id: 'arquivo', label: 'Arquivo', icon: 'download', subtitle: 'Alvará, licenças, contratos e seguros, com aviso antes de caducarem.' },
  { id: 'pessoal', label: 'Pessoal', icon: 'orders', ownerOnly: true, subtitle: 'A ficha de cada trabalhador para o contabilista: NUIT, INSS e salário base.' },
  { id: 'contabilista', label: 'Contabilista', icon: 'globe', ownerOnly: true, subtitle: 'Uma ligação só de leitura para o contabilista descarregar o mês sem pedir nada.' },
  { id: 'facturacao', label: 'Facturação', icon: 'arrow', ownerOnly: true, subtitle: 'Os dados fiscais da empresa e o interruptor da facturação.' },
];

/**
 * Escritório (ADR 0014): a papelada do restaurante. Dono e gerente; o gerente vê as suas lojas e não vê o pessoal,
 * o acesso do contabilista nem as definições fiscais. A BD diz o mesmo (1140, 1141).
 */
export default function EscritorioPage() {
  const supabase = useMemo(() => createClient(), []);
  const [role, setRole] = useState<Role | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [tab, setTab] = useState<Tab>('resumo');
  const [year, month] = maputoToday().split('-').map(Number);
  const [period, setPeriod] = useState({ year, month });

  useEffect(() => {
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const [{ data: profile }, { data: lojas }] = await Promise.all([
        supabase.from('staff_profiles').select('role').eq('user_id', auth.user.id).maybeSingle(),
        supabase.from('stores').select('id,short_name').order('sort'),
      ]);
      setRole((profile?.role === 'owner' ? 'owner' : 'manager') as Role);
      setStores((lojas ?? []) as Store[]);
    })();
  }, [supabase]);

  const visible = TABS.filter((t) => !t.ownerOnly || role === 'owner');
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="insights">
      <header className="insight-header">
        <div>
          <p className="insight-eyebrow">Gestão</p>
          <h1>Escritório</h1>
          <p className="insight-subtitle">{current.subtitle}</p>
        </div>
      </header>

      <nav className="insight-tabs" aria-label="Vistas do Escritório">
        {visible.map((t) => (
          <button key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            <InsightIcon name={t.icon} />
            {t.label}
          </button>
        ))}
      </nav>

      {!role ? (
        <p className="text-sm text-[#8b8378]">A carregar…</p>
      ) : (
        <div className="space-y-5">
          {tab === 'resumo' && <Resumo period={period} onPeriod={setPeriod} />}
          {tab === 'documentos' && <Documentos stores={stores} role={role} />}
          {tab === 'compras' && <Compras stores={stores} period={period} onPeriod={setPeriod} />}
          {tab === 'obrigacoes' && <Obrigacoes stores={stores} role={role} />}
          {tab === 'arquivo' && <Arquivo stores={stores} role={role} />}
          {tab === 'pessoal' && role === 'owner' && <Pessoal stores={stores} />}
          {tab === 'contabilista' && role === 'owner' && <Contabilista />}
          {tab === 'facturacao' && role === 'owner' && <Facturacao />}
        </div>
      )}
    </div>
  );
}
