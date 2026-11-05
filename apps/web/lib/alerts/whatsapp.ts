import { cents, formatMT } from "@delivery/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ALERT_COOLDOWN_MINUTES, ALERT_LABELS, type SystemAlert } from "./digest";

/**
 * Alertas e resumo do dia também por WhatsApp (F4, ADR 0011). O email continua a ser o caminho principal: nada
 * daqui pode impedir um alerta de sair nem o cron de responder. Sai pelo número da loja do alerta, para os
 * telemóveis que o dono escolheu no painel (`stores.whatsapp_alert_phones`, 1126). Loja sem WhatsApp ligado:
 * `whatsapp_enqueue` devolve null e não acontece nada.
 */

type EnqueueJob = {
  storeId: string;
  subjectType: string;
  subjectId: string;
  event: string;
  recipient: string;
  vars: Record<string, string | number>;
  expiresAt: string;
  idempotencyKey: string;
};

const MINUTE = 60_000;

/** Um por telefone. A janela de arrefecimento entra na chave: o mesmo alerta volta a sair só na janela seguinte. */
export function alertJobs(alerts: SystemAlert[], phonesByStore: Map<string, string[]>, nowMs: number): EnqueueJob[] {
  const bucket = Math.floor(nowMs / (ALERT_COOLDOWN_MINUTES * MINUTE));
  const expiresAt = new Date(nowMs + 60 * MINUTE).toISOString();
  return alerts.flatMap((alert) =>
    (phonesByStore.get(alert.store_id) ?? []).map((recipient) => ({
      storeId: alert.store_id,
      subjectType: "alert",
      subjectId: `${alert.kind}:${bucket}`,
      event: "alert.system",
      recipient,
      vars: { loja: alert.store_name, alerta: ALERT_LABELS[alert.kind] ?? alert.kind, detalhe: alert.message },
      expiresAt,
      idempotencyKey: `alert:${alert.store_id}:${alert.kind}:${recipient}:${bucket}`,
    })),
  );
}

export type DigestLine = { store_id: string; store_name: string; orders_count: number; revenue_cents: number };

/** Um resumo por dia, por loja e por telefone: repetir o cron no mesmo dia não manda outro. */
export function digestJobs(day: string, stores: DigestLine[], phonesByStore: Map<string, string[]>, nowMs: number): EnqueueJob[] {
  const expiresAt = new Date(nowMs + 6 * 60 * MINUTE).toISOString();
  return stores.flatMap((store) =>
    (phonesByStore.get(store.store_id) ?? []).map((recipient) => ({
      storeId: store.store_id,
      subjectType: "digest",
      subjectId: day,
      event: "digest.daily",
      recipient,
      vars: { dia: day, loja: store.store_name, pedidos: store.orders_count, total: formatMT(cents(store.revenue_cents)) },
      expiresAt,
      idempotencyKey: `digest:${store.store_id}:${day}:${recipient}`,
    })),
  );
}

/** Telemóveis por loja. Em consulta à parte: sem a 1126 aplicada falha aqui, e os emails nem dão por isso. */
export async function alertPhones(svc: SupabaseClient, storeIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!storeIds.length) return out;
  const { data, error } = await svc.from("stores").select("id,whatsapp_alert_phones").in("id", storeIds);
  if (error) return out;
  for (const row of (data ?? []) as Array<{ id: string; whatsapp_alert_phones: string[] | null }>) {
    if (row.whatsapp_alert_phones?.length) out.set(row.id, row.whatsapp_alert_phones);
  }
  return out;
}

/** Enfileira e devolve quantos entraram. Nunca rebenta: a fila é um extra do email. */
export async function enqueueOwnerMessages(svc: SupabaseClient, jobs: EnqueueJob[]): Promise<number> {
  let queued = 0;
  for (const job of jobs) {
    try {
      const { data, error } = await svc.rpc("whatsapp_enqueue", {
        p_store_id: job.storeId,
        p_subject_type: job.subjectType,
        p_subject_id: job.subjectId,
        p_event: job.event,
        p_recipient: job.recipient,
        p_vars: job.vars,
        p_kind: "utility",
        p_expires_at: job.expiresAt,
        p_idempotency_key: job.idempotencyKey,
      });
      if (!error && data) queued++;
    } catch {
      // O alerta já seguiu por email.
    }
  }
  return queued;
}
