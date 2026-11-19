import { periodLabel, shortDate } from './regras';

/** O que `office_alerts_all` (1141) devolve. A `key` identifica o aviso: mesma chave, um email por dia. */
export type OfficeAlert = {
  kind: 'obligation_due' | 'obligation_overdue' | 'document_expiring' | 'document_expired' | 'fiscal_pending' | 'fiscal_failures';
  store_id: string | null;
  key: string;
  title: string;
  period?: string;
  due?: string;
  severity: 'critical' | 'warning';
};

const LABEL: Record<OfficeAlert['kind'], string> = {
  obligation_due: 'Prazo a aproximar-se',
  obligation_overdue: 'Prazo ultrapassado',
  document_expiring: 'Documento a caducar',
  document_expired: 'Documento caducado',
  fiscal_pending: 'Vendas sem factura',
  fiscal_failures: 'Falhas na facturação',
};

/** Só os que ainda não foram avisados hoje. */
export function newAlerts(alerts: OfficeAlert[], sentKeysToday: ReadonlySet<string>): OfficeAlert[] {
  return alerts.filter((alert) => !sentKeysToday.has(alert.key));
}

export function alertLine(alert: OfficeAlert): string {
  const extra = [
    alert.period ? `referente a ${periodLabel(alert.period)}` : null,
    alert.due ? `${alert.kind.startsWith('document') ? 'validade' : 'prazo'} ${shortDate(alert.due)}` : null,
  ].filter(Boolean).join(' · ');
  return `${LABEL[alert.kind]}: ${alert.title}${extra ? ` (${extra})` : ''}`;
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function officeAlertEmail(alerts: OfficeAlert[], brandName: string, panelUrl: string | null): { subject: string; html: string } {
  const critical = alerts.filter((a) => a.severity === 'critical').length;
  const subject = critical
    ? `${brandName} · Escritório: ${critical} assunto(s) urgente(s)`
    : `${brandName} · Escritório: ${alerts.length} prazo(s) a tratar`;
  const items = [...alerts]
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1))
    .map((a) => `<li style="margin:6px 0;color:${a.severity === 'critical' ? '#b42318' : '#333'}">${escapeHtml(alertLine(a))}</li>`)
    .join('');
  const link = panelUrl ? `<p><a href="${escapeHtml(panelUrl)}">Abrir o Escritório no painel</a></p>` : '';
  return {
    subject,
    html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222"><p>Bom dia. O Escritório encontrou isto:</p><ul>${items}</ul>${link}<p style="color:#666;font-size:12px">Marque como feito no painel e o aviso pára. Os prazos são os que estão definidos em Obrigações.</p></div>`,
  };
}
