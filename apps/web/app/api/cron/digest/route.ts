import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { isEmailConfigured, sendMail } from "@/lib/email/transport";
import { digestHtml, type DigestStore } from "@/lib/email/daily-template";
import { getBrand } from "@/lib/brand/server";
import { cronUnauthorized } from "@/lib/cron/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = cronUnauthorized(request);
  if (denied) return denied;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: "supabase_not_configured" },
      { status: 503 },
    );
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { searchParams } = new URL(request.url);
  const day = searchParams.get("day");

  const { data, error } = await supabase.rpc("get_daily_digest", {
    p_day: day,
  });
  if (error) {
    console.error("[cron/digest]", error.message);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  const payload = data as { day: string; stores: DigestStore[] };
  const recipients = Array.from(
    new Set(
      [
        process.env.OWNER_EMAIL,
        ...payload.stores.map((store) => store.owner_email),
      ].filter((value): value is string =>
        Boolean(value && value.includes("@")),
      ),
    ),
  );

  let delivery: "sent" | "skipped_no_key" | "skipped_no_recipient" | "failed" =
    "sent";

  const brandName = (await getBrand()).name;
  if (!(await isEmailConfigured())) delivery = "skipped_no_key";
  else if (recipients.length === 0) delivery = "skipped_no_recipient";
  else {
    const result = await sendMail({
      event: "digest",
      to: recipients,
      subject: `${brandName} · resumo de ${payload.day}`,
      html: digestHtml(payload.day, payload.stores, brandName),
    });
    if (!result.ok) {
      console.error("[cron/digest] envio falhou:", result.error);
      delivery = "failed";
    }
  }

  await supabase.from("event_log").insert(
    payload.stores.map((store) => ({
      store_id: store.store_id,
      type: "digest.sent",
      payload: {
        day: payload.day,
        orders_count: store.orders_count,
        revenue_cents: store.revenue_cents,
        delivery,
      },
    })),
  );

  return NextResponse.json({
    ok: true,
    day: payload.day,
    stores: payload.stores.length,
    delivery,
  });
}
