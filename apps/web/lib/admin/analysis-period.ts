export type AnalysisPeriod = 'day' | 'week' | 'month' | 'all';

/** Mesmas janelas móveis de get_dashboard_metrics (1037). */
export function analysisPeriodStart(period: AnalysisPeriod, now = new Date()): string {
  if (period === 'all') return '1970-01-01T00:00:00.000Z';
  const days = { day: 1, week: 7, month: 30 }[period];
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

export function maputoDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Maputo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function nextMaputoDay(date: string): string {
  return new Date(new Date(`${date}T00:00:00+02:00`).getTime() + 86_400_000).toISOString();
}
