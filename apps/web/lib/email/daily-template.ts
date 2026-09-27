import { formatMT, type Cents } from "@delivery/core";
export type DigestStore = {
  store_id: string;
  store_name: string;
  owner_email: string | null;
  orders_count: number;
  revenue_cents: number;
  payments: Record<string, number>;
  cancelled_count: number;
  cash_closes: Array<{
    closed_at: string;
    expected_cash_cents: number;
    counted_cash_cents: number;
    difference_cents: number;
    difference_reason: string | null;
  }>;
  incidents: number;
};

const mt = (value: number) => formatMT(value as Cents);

const METHOD_LABELS: Record<string, string> = {
  cash: "Dinheiro",
  mpesa: "M-Pesa",
  emola: "e-Mola",
  credit_card: "Cartão",
};

export function digestHtml(
  day: string,
  stores: DigestStore[],
  brandName: string,
): string {
  const blocks = stores.map((store) => {
    const payments = Object.entries(store.payments)
      .map(
        ([method, total]) =>
          `<li>${METHOD_LABELS[method] ?? method}: ${mt(total)}</li>`,
      )
      .join("");
    const closes = store.cash_closes
      .map(
        (close) =>
          `<li>Fecho: esperado ${mt(close.expected_cash_cents)} · contado ${mt(
            close.counted_cash_cents,
          )} · diferença ${mt(close.difference_cents)}${
            close.difference_reason ? ` (${close.difference_reason})` : ""
          }</li>`,
      )
      .join("");

    return `<h2 style="color:#e5a93c;font-size:16px;margin:24px 0 8px">${store.store_name}</h2>
      <p><strong>${store.orders_count}</strong> pedidos · <strong>${mt(store.revenue_cents)}</strong> facturado
      ${store.cancelled_count > 0 ? ` · ${store.cancelled_count} anulado(s)` : ""}</p>
      <ul>${payments || "<li>Sem pagamentos registados</li>"}</ul>
      <ul>${closes || "<li>Sem fecho de caixa neste dia</li>"}</ul>
      <p style="color:#847e72;font-size:12px">Incidentes registados: ${store.incidents}</p>`;
  });

  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <h1 style="color:#e5a93c;font-size:20px">${brandName} · resumo de ${day}</h1>
      ${blocks.join("")}
      <p style="color:#847e72;font-size:12px">Email automático do sistema.</p>
    </div>`;
}

/** Digest diário ao dono: vendas por loja, fecho de caixa e incidentes. */
