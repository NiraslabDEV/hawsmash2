import { NextResponse } from "next/server";
import { formatMT, type Cents } from "@delivery/core";
import { cronUnauthorized } from "@/lib/cron/auth";
import { serviceClient } from "@/lib/payments/direct";
import { renderMessage, stepSchema } from "@/lib/email/studio";
import { studioSmtp, sendStudioMail } from "@/lib/email/studio-transport";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const denied = cronUnauthorized(request);
  if (denied) return denied;
  const svc = serviceClient();
  const { data: jobs, error } = await svc.rpc("email_claim");
  if (error)
    return NextResponse.json(
      { error: "Não foi possível ler a fila." },
      { status: 503 },
    );
  let sent = 0;
  let failed = 0;
  // Cinco ligações em paralelo, limitadas pelo claim atómico (SKIP LOCKED).
  await Promise.all(
    (jobs ?? []).map(
      async (job: {
        id: string;
        store_id: string;
        flow_id: string;
        recipient: string;
        message: unknown;
        variables: Record<string, string | number>;
      }) => {
        try {
          const [{ data: flow }, smtp, { data: contact }] = await Promise.all([
            svc
              .from("email_flows")
              .select("kind,status")
              .eq("store_id", job.store_id)
              .eq("id", job.flow_id)
              .single(),
            studioSmtp(job.store_id),
            svc
              .from("email_contacts")
              .select("unsubscribe_token,unsubscribed_at")
              .eq("store_id", job.store_id)
              .eq("email", job.recipient)
              .maybeSingle(),
          ]);
          if (
            !flow ||
            flow.status === "archived" ||
            (flow.kind === "marketing" && (!contact || contact.unsubscribed_at))
          ) {
            await svc
              .from("email_jobs")
              .update({ status: "cancelled" })
              .eq("store_id", job.store_id)
              .eq("id", job.id)
              .eq("status", "sending");
            return;
          }
          if (flow.status !== "active" || !smtp) {
            await svc
              .from("email_jobs")
              .update({ status: "queued", claimed_at: null })
              .eq("store_id", job.store_id)
              .eq("id", job.id)
              .eq("status", "sending");
            return;
          }
          const step = stepSchema.parse(job.message);
          const variables = Object.fromEntries(
            Object.entries(job.variables).map(([key, value]) => [
              key,
              String(value),
            ]),
          );
          if (Number.isSafeInteger(job.variables.total_cents))
            variables.total = formatMT(
              Number(job.variables.total_cents) as Cents,
            );
          const base =
            process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_BASE_URL;
          if (
            flow.kind === "marketing" &&
            (!base || !base.startsWith("https://"))
          )
            throw new Error("site_url");
          const { data: store } = await svc
            .from("stores")
            .select("slug")
            .eq("id", job.store_id)
            .single();
          if (base && store)
            variables.menu_url = `${base.replace(/\/$/, "")}/l/${encodeURIComponent(store.slug)}`;
          const unsubscribeUrl =
            flow.kind === "marketing"
              ? `${base!.replace(/\/$/, "")}/email/subscricao?t=${contact!.unsubscribe_token}`
              : undefined;
          const content = renderMessage(step, variables, unsubscribeUrl);
          const result = smtp
            ? await sendStudioMail(smtp, {
                to: job.recipient,
                ...content,
                messageId: `<${job.id}@${smtp.from_email.split("@")[1]}>`,
                unsubscribeUrl,
              })
            : { ok: false, error: "SMTP desligado ou não configurado." };
          const finished = await svc.rpc("email_finish", {
            p_id: job.id,
            p_ok: result.ok,
            p_error: result.ok ? null : result.error,
          });
          if (finished.error) throw new Error("finish_failed");
          if (result.ok) sent++;
          else failed++;
        } catch {
          // Mantém sending: após 10 min fica uncertain; nunca repete um envio de resultado desconhecido.
          failed++;
        }
      },
    ),
  );
  return NextResponse.json(
    { ok: failed === 0, sent, failed, claimed: jobs?.length ?? 0 },
    { status: failed ? 502 : 200 },
  );
}
