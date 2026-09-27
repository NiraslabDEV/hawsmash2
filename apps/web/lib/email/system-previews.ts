import { approvalEmail, rejectionEmail, ownerProofEmail } from "./order-emails";
import { accountEmail } from "./account-template";
import { digestHtml } from "./daily-template";
import {
  cashCloseEmailHtml,
  cashCloseReportFromSession,
  cashDayEmailHtml,
} from "@/lib/cash/report";
import { monthlyEmailHtml, monthlySubject } from "@/lib/reports/monthly";
import { alertEmailHtml } from "@/lib/alerts/digest";
import type { SystemEmailKey } from "./system-catalog";

/** Os mesmos renderers de produção, com dados de demonstração; nunca consulta clientes. */
export function systemPreviews(
  storeName: string,
  brandName: string,
): Record<SystemEmailKey, { subject: string; html: string }> {
  const order = {
    customerName: "Cliente de exemplo",
    orderNumber: "EXEMPLO",
    totalCents: 45000,
    paymentMethod: "mpesa",
    storeName,
  };
  const opened = "2026-01-01T08:00:00Z",
    closed = "2026-01-01T18:00:00Z";
  const cash = cashCloseReportFromSession(
    {
      id: "exemplo",
      store_id: "exemplo",
      shift_label: "Turno de exemplo",
      opened_at: opened,
      closed_at: closed,
      opening_float_cents: 0,
      counted_cash_cents: 0,
      difference_cents: 0,
      difference_reason: null,
      report: {},
    },
    storeName,
    "Equipa de exemplo",
  );
  const month = {
    month: "2026-01",
    previous_month: "2025-12",
    stores: [
      {
        store_id: "exemplo",
        store_name: storeName,
        owner_email: null,
        google_place_id: null,
        orders_count: 0,
        revenue_cents: 0,
        previous_orders_count: 0,
        previous_revenue_cents: 0,
        cancelled_count: 0,
        channels: {},
        payments: {},
        top_items: [],
        google_snapshot: null,
        google_previous: null,
      },
    ],
  };
  return {
    paid: approvalEmail(order),
    cancelled: rejectionEmail({ ...order, reason: "Motivo de exemplo" }),
    proof: ownerProofEmail({ ...order, fulfillmentType: "pickup" }),
    account_code: accountEmail("000000", brandName),
    cash_close: {
      subject: `Fecho de Caixa — ${brandName} ${storeName}`,
      html: cashCloseEmailHtml(cash, brandName),
    },
    cash_day: {
      subject: `Fecho do Dia — ${brandName} ${storeName}`,
      html: cashDayEmailHtml(
        {
          ...cash,
          day_close_id: null,
          business_date: "2026-01-01",
          shifts_count: 0,
          first_opened_at: opened,
          last_shift_closed_at: closed,
          closed_at: closed,
          closed_by_name: "Equipa de exemplo",
          closing_cash_cents: 0,
          troco_inicial_cents: 0,
          shifts: [],
        },
        storeName,
        brandName,
      ),
    },
    digest: {
      subject: `Resumo diário — ${brandName}`,
      html: digestHtml(
        "2026-01-01",
        [
          {
            store_id: "exemplo",
            store_name: storeName,
            owner_email: null,
            orders_count: 0,
            revenue_cents: 0,
            payments: {},
            cancelled_count: 0,
            cash_closes: [],
            incidents: 0,
          },
        ],
        brandName,
      ),
    },
    monthly: {
      subject: monthlySubject(brandName, month.month),
      html: monthlyEmailHtml({
        brandName,
        digest: month,
        google: { exemplo: { status: "no_place_id" } },
      }),
    },
    alerts: {
      subject: `Alertas — ${brandName}`,
      html: alertEmailHtml(
        [
          {
            store_id: "exemplo",
            store_name: storeName,
            kind: "device_silent",
            severity: "warning",
            message: "Alerta de demonstração: dispositivo sem sinal.",
          },
        ],
        [],
        brandName,
      ),
    },
  };
}
