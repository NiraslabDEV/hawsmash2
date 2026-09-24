'use client';
import { useEffect, useState } from 'react';
import { cents, formatMT } from '@delivery/core';
import { createClient } from '@/utils/supabase/client';
import { analysisPeriodStart } from '@/lib/admin/analysis-period';
import { InsightPanel, InsightEmpty, MetricCard } from './insights-ui';
type Report = {
  orders: number; units: number; revenue_cents: number; margin_cents: number | null;
  views: number; accepts: number; lines_without_cost: number;
  products: Array<{ views:number; accepts:number; menu_item_id: string; name_snapshot: string; kind: string; placement: string; units: number; orders: number; revenue_cents: number; margin_cents: number | null; lines_without_cost: number }>;
};
const money = (v: number) => formatMT(cents(v));
const placements: Record<string,string> = { online_companion: 'Online · acompanhamento', online_upgrade: 'Online · upgrade', pos_acompanhar: 'POS · acompanhamento', pos_sobremesa: 'POS · sobremesa', pos_companion: 'POS · acompanhamento', pos_dessert: 'POS · sobremesa' };
export function UpsellInsights({period,storeId,origin}: {period:'day'|'week'|'month'|'all';storeId:string|null;origin:'all'|'online'|'pos'}) {
  const [report,setReport] = useState<Report|null>(null);
  const [error,setError] = useState(false);
  const [loading,setLoading] = useState(true);
  const [attempt,setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(false); setReport(null);
    void (async () => {
      try {
        const {data,error:err} = await createClient().rpc('get_upsell_metrics', {p_from:analysisPeriodStart(period),p_store_id:storeId,p_origin:origin});
        if (!active) return;
        if (err || !data) setError(true); else setReport(data as Report);
      } catch { if (active) setError(true); }
      finally { if (active) setLoading(false); }
    })();
    return () => {active=false;};
  },[period,storeId,origin,attempt]);
  return <section aria-label="Desempenho dos upsells" className="mt-6">
    <InsightPanel title="O que os upsells acrescentam" description={`Ofertas ${origin === 'pos' ? 'do POS' : origin === 'online' ? 'online' : 'online e do POS'} · dados recolhidos desde a activação do rastreio.`}>
      {loading ? <p role="status">A carregar upsells…</p> : error ? <div role="alert" className="insight-notice"><p>Não foi possível carregar os upsells.</p><button className="insight-button" onClick={() => setAttempt(n=>n+1)}>Repetir upsells</button></div> : report && <>
        <div className="insight-grid">
          <MetricCard label="Ofertas vistas" value={report.views.toLocaleString('pt-PT')} detail={`${report.accepts} aceitações · ${report.views ? (report.accepts/report.views*100).toLocaleString('pt-PT',{maximumFractionDigits:1})+'%' : '—'} de aceitação`} icon="globe" />
          <MetricCard label="Pedidos com upsell" value={report.orders.toLocaleString('pt-PT')} detail={`${report.units} unidades em pedidos confirmados`} icon="orders" />
          <MetricCard label="Receita dos upsells" value={money(report.revenue_cents)} detail="Upgrades: só a diferença de preço" icon="ticket" />
          <MetricCard label="Margem bruta estimada" value={report.margin_cents === null ? 'Por apurar' : money(report.margin_cents)} detail={report.lines_without_cost ? `${report.lines_without_cost} linhas sem custo comparável` : 'Receita menos custo dos ingredientes'} icon="chart" />
        </div>
        <p className="insight-subtitle my-4">A aceitação mede cliques na oferta; só os pedidos confirmados entram na receita. Descontos são repartidos pelos artigos. A margem não inclui pessoal, renda, impostos ou outras despesas. Upgrades sem custo diferencial ficam por apurar.</p>
        {report.products.length === 0 ? <InsightEmpty title="Ainda não há upsells confirmados">As novas ofertas aceites aparecerão aqui depois da confirmação do pedido. O histórico sem rastreio não é estimado.</InsightEmpty> : <div className="insight-table-scroll" tabIndex={0} role="region" aria-label="Produtos e resultado dos upsells"><table className="w-full text-sm"><thead><tr>{['Produto','Oferta','Vistas / aceites','Unidades','Pedidos','Receita adicional','Margem bruta'].map(h=><th scope="col" className="p-3 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{report.products.map(r=><tr className="border-t border-white/10" key={`${r.menu_item_id}-${r.kind}-${r.placement}`}><td className="p-3">{r.name_snapshot}</td><td className="p-3">{placements[r.placement] ?? r.placement}</td><td className="p-3">{r.views ?? 0} / {r.accepts ?? 0}</td><td className="p-3">{r.units}</td><td className="p-3">{r.orders}</td><td className="p-3">{money(r.revenue_cents)}</td><td className="p-3">{r.margin_cents === null ? 'Por apurar' : money(r.margin_cents)}</td></tr>)}</tbody></table></div>}
      </>}
    </InsightPanel>
  </section>;
}
