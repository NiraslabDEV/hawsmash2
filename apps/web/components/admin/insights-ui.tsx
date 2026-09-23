import type { ReactNode } from 'react';
import './insights.css';

export function InsightIcon({ name }: { name: 'chart' | 'orders' | 'ticket' | 'clock' | 'download' | 'arrow' | 'globe' }) {
  const paths = {
    chart: 'M4 19V9m6 10V4m6 15v-7m5 9H2',
    orders: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6',
    ticket: 'M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4V6Zm12 0v3m0 3v1m0 3v2',
    clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    arrow: 'M5 16 16 5M5 5h11v11',
    globe: 'M2 12h20M12 2c6 6 6 14 0 20-6-6-6-14 0-20Zm10 10a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  };
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

export function MetricCard({ label, value, detail, icon, featured = false }: {
  label: string; value: ReactNode; detail: ReactNode; icon: Parameters<typeof InsightIcon>[0]['name']; featured?: boolean;
}) {
  return <article className={`insight-metric${featured ? ' insight-metric-featured' : ''}`}>
    <div className="insight-metric-label"><span>{label}</span><InsightIcon name={icon} /></div>
    <div className="insight-metric-value">{value}</div>
    <div className="insight-metric-detail">{detail}</div>
  </article>;
}

export function InsightPanel({ title, description, children, aside, className = '' }: {
  title: string; description?: string; children: ReactNode; aside?: ReactNode; className?: string;
}) {
  return <section className={`insight-panel ${className}`}>
    <div className="insight-panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{aside}</div>
    {children}
  </section>;
}

export function InsightEmpty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="insight-empty"><InsightIcon name="chart" /><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}
