import { formatMT, type Cents } from '@delivery/core';

/**
 * O resumo do mês ao dono (1096): vendas de cada loja e, no mesmo email, como
 * está cada loja no Google.
 *
 * Domínio puro: os números chegam do `get_monthly_digest` e do Google por
 * parâmetro, e a marca também — quem faz I/O é a rota do cron (CLAUDE §18.2).
 */

export type MonthlyItem = {
  name: string;
  variant: string | null;
  qty: number;
  total_cents: number;
};

export type GoogleSnapshot = {
  rating: number | null;
  review_count: number | null;
  captured_at: string;
};

export type MonthlyStore = {
  store_id: string;
  store_name: string;
  owner_email: string | null;
  google_place_id: string | null;
  orders_count: number;
  revenue_cents: number;
  previous_orders_count: number;
  previous_revenue_cents: number;
  cancelled_count: number;
  channels: Record<string, { orders: number; revenue_cents: number }>;
  payments: Record<string, number>;
  top_items: MonthlyItem[];
  google_snapshot: GoogleSnapshot | null;
  google_previous: GoogleSnapshot | null;
};

export type MonthlyDigest = {
  month: string;
  previous_month: string;
  stores: MonthlyStore[];
};

/** O que o email diz do Google em cada loja. Nunca falta: no pior caso, diz porquê. */
export type GoogleSection =
  | {
      status: 'ok';
      rating: number | null;
      reviewCount: number | null;
      previous: GoogleSnapshot | null;
      mapsUri: string | null;
    }
  | { status: 'no_place_id' }
  | { status: 'no_key' }
  | { status: 'not_captured' }
  | { status: 'failed' };

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const CHANNEL_LABELS: Record<string, string> = {
  counter: 'Balcão',
  delivery: 'Entrega',
  pickup: 'Levantamento',
  dine_in: 'Mesa',
};

const METHOD_LABELS: Record<string, string> = {
  cash: 'Dinheiro',
  mpesa: 'M-Pesa',
  emola: 'e-Mola',
  credit_card: 'Cartão',
};

const mt = (value: number) => formatMT(value as Cents);

const escapeHtml = (value: string) =>
  value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]!);

/** `2026-09-01` → `Setembro de 2026`. Lê o texto: um `Date` mudaria de dia com o fuso. */
export function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return `${MONTHS[monthNumber - 1]} de ${year}`;
}

const monthName = (month: string) => MONTHS[Number(month.split('-')[1]) - 1];

/** `?month=2026-09` → `2026-09-01`. Vazio → null (o último mês fechado). */
export function parseMonthParam(
  value: string | null,
): { ok: true; month: string | null } | { ok: false } {
  if (!value) return { ok: true, month: null };
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  return match ? { ok: true, month: `${match[1]}-${match[2]}-01` } : { ok: false };
}

/**
 * O último mês fechado no fuso de Maputo. O Google só dá o número de hoje:
 * só esse mês pode ser lido na hora — um mês antigo lido hoje mentia.
 */
export function lastClosedMonth(now: Date = new Date()): string {
  const [year, month] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Maputo',
    year: 'numeric',
    month: '2-digit',
  })
    .format(now)
    .split('-')
    .map(Number);
  return month === 1 ? `${year - 1}-12-01` : `${year}-${String(month - 1).padStart(2, '0')}-01`;
}

/** Variação em %, arredondada. Sem base de comparação, não há percentagem. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Avaliações que entraram no mês: a diferença entre duas fotografias seguidas. */
export function reviewsGained(section: GoogleSection): number | null {
  if (section.status !== 'ok') return null;
  if (section.reviewCount === null || section.previous?.review_count == null) return null;
  return section.reviewCount - section.previous.review_count;
}

/** O email da casa (`OWNER_EMAIL`) e o de cada loja, sem repetidos. */
export function reportRecipients(
  ownerEmail: string | undefined,
  stores: Array<Pick<MonthlyStore, 'owner_email'>>,
): string[] {
  return Array.from(
    new Set(
      [ownerEmail, ...stores.map((store) => store.owner_email)].filter(
        (value): value is string => Boolean(value && value.includes('@')),
      ),
    ),
  );
}

export function monthlySubject(brandName: string, month: string): string {
  return `${brandName} · resumo de ${monthLabel(month)}`;
}

const rating = (value: number) =>
  value.toLocaleString('pt-MZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function changeHtml(current: number, previous: number, previousMonth: string): string {
  const change = percentChange(current, previous);
  if (change === null) return '';
  const color = change >= 0 ? '#2f8f4e' : '#c0392b';
  const arrow = change > 0 ? '↑' : change < 0 ? '↓' : '=';
  return ` <span style="color:${color};font-size:13px">${arrow} ${Math.abs(change)}% face a ${monthName(previousMonth)}</span>`;
}

function googleHtml(section: GoogleSection): string {
  const label = '<strong>Google:</strong>';
  switch (section.status) {
    case 'no_place_id':
      return `<p>${label} perfil por ligar — falta o Place ID desta loja na aba Lojas.</p>`;
    case 'no_key':
      return `<p>${label} leitura desligada — falta a chave da Places API no servidor.</p>`;
    case 'not_captured':
      return `<p>${label} sem leitura guardada para este mês.</p>`;
    case 'failed':
      return `<p>${label} o Google não respondeu desta vez. O resto do resumo está completo.</p>`;
    case 'ok': {
      const parts: string[] = [];
      if (section.rating !== null) parts.push(`★ <strong>${rating(section.rating)}</strong>`);
      if (section.reviewCount !== null) parts.push(`${section.reviewCount} avaliações`);
      const gained = reviewsGained(section);
      if (gained !== null) {
        parts.push(gained > 0 ? `+${gained} este mês` : gained === 0 ? 'nenhuma nova este mês' : `${gained} este mês`);
      } else {
        parts.push('primeira leitura — a variação do mês aparece a partir do próximo resumo');
      }
      const previousRating = section.previous?.rating ?? null;
      if (previousRating !== null && section.rating !== null && previousRating !== section.rating) {
        parts.push(`nota era ${rating(previousRating)}`);
      }
      const link = section.mapsUri
        ? ` · <a href="${escapeHtml(section.mapsUri)}" style="color:#e5a93c">ver perfil</a>`
        : '';
      return `<p>${label} ${parts.join(' · ')}${link}</p>`;
    }
  }
}

function storeHtml(store: MonthlyStore, previousMonth: string, google: GoogleSection): string {
  const ticket = store.orders_count > 0 ? Math.round(store.revenue_cents / store.orders_count) : 0;
  const channels = Object.entries(store.channels)
    .sort(([, a], [, b]) => b.revenue_cents - a.revenue_cents)
    .map(
      ([channel, value]) =>
        `${escapeHtml(CHANNEL_LABELS[channel] ?? channel)} ${value.orders} · ${mt(value.revenue_cents)}`,
    )
    .join(' &nbsp;|&nbsp; ');
  const payments = Object.entries(store.payments)
    .sort(([, a], [, b]) => b - a)
    .map(([method, total]) => `<li>${escapeHtml(METHOD_LABELS[method] ?? method)}: ${mt(total)}</li>`)
    .join('');
  const items = store.top_items
    .map(
      (item, index) =>
        `<tr><td style="padding:4px 8px 4px 0">${index + 1}. ${escapeHtml(item.name)}${
          item.variant ? ` ${escapeHtml(item.variant)}` : ''
        }</td><td style="padding:4px 8px;text-align:right">${item.qty}×</td><td style="padding:4px 0;text-align:right">${mt(item.total_cents)}</td></tr>`,
    )
    .join('');

  return `<h2 style="color:#e5a93c;font-size:16px;margin:28px 0 8px">${escapeHtml(store.store_name)}</h2>
      <p><strong>${mt(store.revenue_cents)}</strong> facturado${changeHtml(store.revenue_cents, store.previous_revenue_cents, previousMonth)}<br>
      <strong>${store.orders_count}</strong> pedidos (${monthName(previousMonth)}: ${store.previous_orders_count}) · ticket médio ${mt(ticket)}${
        store.cancelled_count > 0 ? ` · ${store.cancelled_count} anulado(s)` : ''
      }</p>
      ${channels ? `<p style="font-size:13px">${channels}</p>` : ''}
      <ul>${payments || '<li>Sem pagamentos registados</li>'}</ul>
      ${items ? `<p style="margin:12px 0 4px"><strong>Mais vendidos</strong></p><table style="border-collapse:collapse;font-size:14px">${items}</table>` : ''}
      ${googleHtml(google)}`;
}

export function monthlyEmailHtml(input: {
  brandName: string;
  digest: MonthlyDigest;
  google: Record<string, GoogleSection>;
}): string {
  const { brandName, digest, google } = input;
  const blocks = digest.stores.map((store) =>
    storeHtml(store, digest.previous_month, google[store.store_id] ?? { status: 'failed' }),
  );

  let total = '';
  if (digest.stores.length > 1) {
    const revenue = digest.stores.reduce((sum, store) => sum + store.revenue_cents, 0);
    const previous = digest.stores.reduce((sum, store) => sum + store.previous_revenue_cents, 0);
    const orders = digest.stores.reduce((sum, store) => sum + store.orders_count, 0);
    total = `<p style="font-size:15px">As ${digest.stores.length} lojas: <strong>${mt(revenue)}</strong> · ${orders} pedidos${changeHtml(revenue, previous, digest.previous_month)}</p>`;
  }

  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h1 style="color:#e5a93c;font-size:20px">${escapeHtml(brandName)} · ${monthLabel(digest.month)}</h1>
      ${total}
      ${blocks.join('') || '<p>Nenhuma loja activa neste mês.</p>'}
      <p style="color:#847e72;font-size:12px;margin-top:28px">Visualizações do perfil, chamadas e pedidos de direcções no Google entram neste resumo quando o Google libertar o acesso ao Perfil de Empresa.</p>
      <p style="color:#847e72;font-size:12px">Email automático do sistema, no dia 1 de cada mês.</p>
    </div>`;
}
