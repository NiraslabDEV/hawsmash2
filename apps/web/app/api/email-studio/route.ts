import {
  SYSTEM_EMAILS,
  defaultSystemTemplate,
  systemTemplateSchema,
} from "@/lib/email/system-catalog";
import { systemPreviews } from "@/lib/email/system-previews";
import { getBrand } from "@/lib/brand/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { staffFromRequest } from "@/lib/auth/staff-request";
import { flowSchema } from "@/lib/email/studio";
import { verifyStudioSmtp } from "@/lib/email/studio-transport";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailFlow } from "@/lib/email/studio";

export const dynamic = "force-dynamic";
const settingsSchema = z.object({
  enabled: z.boolean(),
  host: z
    .string()
    .regex(/^(?!localhost$)[a-z0-9][a-z0-9.-]+\.[a-z]{2,}$/i)
    .max(253),
  port: z.union([z.literal(465), z.literal(587)]),
  username: z.string().min(1).max(320),
  from_name: z.string().max(120),
  from_email: z.string().email(),
  reply_to: z.union([z.literal(""), z.string().email()]),
  password: z.string().max(1000).optional(),
});
const id = z.object({ id: z.string().uuid() });
const contact = z.object({
  email: z.string().email().max(320),
  name: z.string().max(120),
  consent_source: z.string().trim().min(3).max(500),
});

async function loadFlows(client: SupabaseClient, storeId: string) {
  const flows: EmailFlow[] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await client
      .from("email_flows")
      .select("id,store_id,name,kind,trigger,status,steps,updated_at")
      .eq("store_id", storeId)
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .order("id")
      .range(offset, offset + 199);
    if (page.error) return { data: null, error: page.error };
    flows.push(...(page.data as EmailFlow[]));
    if (page.data.length < 200) return { data: flows, error: null };
  }
}

export async function GET(request: Request) {
  const staff = await staffFromRequest(request);
  if (!staff.ok)
    return NextResponse.json({ error: staff.error }, { status: staff.status });
  if (staff.role !== "owner")
    return NextResponse.json(
      { error: "Só o dono pode gerir emails." },
      { status: 403 },
    );
  const url = new URL(request.url);
  const store = z.string().uuid().safeParse(url.searchParams.get("store"));
  const offset = Math.max(
    0,
    Math.min(1000000, Math.floor(Number(url.searchParams.get("offset")) || 0)),
  );
  if (!store.success) {
    const { data, error } = await staff.client
      .from("stores")
      .select("id,name")
      .order("sort");
    return NextResponse.json(
      error ? { error: "Não foi possível carregar lojas." } : { stores: data },
      { status: error ? 500 : 200 },
    );
  }
  const queries = await Promise.all([
    staff.client
      .from("email_settings")
      .select(
        "store_id,enabled,host,port,username,from_name,from_email,reply_to,password_configured",
      )
      .eq("store_id", store.data)
      .maybeSingle(),
    loadFlows(staff.client, store.data),
    staff.client
      .from("email_contacts")
      .select("id,email,name,consent_source,consent_at,unsubscribed_at", {
        count: "exact",
      })
      .eq("store_id", store.data)
      .order("consent_at", { ascending: false })
      .order("id")
      .range(offset, offset + 49),
    staff.client
      .from("email_jobs")
      .select(
        "id,flow_id,recipient,step_index,status,due_at,sent_at,error,created_at",
        { count: "exact" },
      )
      .eq("store_id", store.data)
      .order("created_at", { ascending: false })
      .order("id")
      .range(offset, offset + 49),
    staff.client
      .from("stores")
      .select("owner_email,name,slug")
      .eq("id", store.data)
      .single(),
  ]);
  if (queries.some((q) => q.error))
    return NextResponse.json(
      {
        error:
          "Não foi possível carregar o módulo de emails. Verifica a migration 1104.",
      },
      { status: 503 },
    );
  const { data: firstStore } = await staff.client
    .from("stores")
    .select("id,name")
    .order("sort")
    .order("id")
    .limit(1)
    .maybeSingle();
  const [templates, globalTemplates, knowledge, delivery] = await Promise.all([
    staff.client
      .from("email_system_templates")
      .select("key,mode,enabled,template_id,step")
      .eq("store_id", store.data),
    staff.client
      .from("email_system_templates")
      .select("key,mode,enabled,template_id,step")
      .eq("store_id", firstStore?.id ?? store.data),
    staff.client
      .from("email_campaign_knowledge")
      .select("notes")
      .eq("store_id", store.data)
      .maybeSingle(),
    staff.client
      .from("email_delivery_log")
      .select("id,event,recipient,status,created_at", { count: "exact" })
      .eq("store_id", store.data)
      .order("created_at", { ascending: false })
      .order("id")
      .range(offset, offset + 49),
  ]);
  if ([templates, globalTemplates, knowledge, delivery].some((q) => q.error))
    return NextResponse.json(
      {
        error:
          "N?o foi poss?vel carregar os emails do sistema. Verifica a migration 1105.",
      },
      { status: 503 },
    );
  const brand = await getBrand();
  return NextResponse.json({
    systemTemplates: SYSTEM_EMAILS.map(
      (e) =>
        (e.scope === "global" ? globalTemplates.data : templates.data)?.find(
          (t) => t.key === e.key,
        ) ?? defaultSystemTemplate(e.key),
    ),
    previews: systemPreviews(queries[4].data?.name ?? "", brand.name),
    globalStoreName: firstStore?.name ?? "",
    knowledge: knowledge.data?.notes ?? "",
    delivery: delivery.data ?? [],
    deliveryCount: delivery.count ?? 0,
    brandContext: {
      name: brand.name,
      tagline: brand.tagline,
      store: queries[4].data?.name ?? "",
    },
    settings: queries[0].data,
    flows: queries[1].data,
    contacts: queries[2].data,
    contactCount: queries[2].count,
    jobs: queries[3].data,
    jobCount: queries[3].count,
    ownerEmail: queries[4].data?.owner_email ?? "",
    centralOwnerEmail: process.env.OWNER_EMAIL ?? "",
  });
}

export async function POST(request: Request) {
  const staff = await staffFromRequest(request);
  if (!staff.ok)
    return NextResponse.json({ error: staff.error }, { status: staff.status });
  if (staff.role !== "owner")
    return NextResponse.json(
      { error: "Só o dono pode gerir emails." },
      { status: 403 },
    );
  const envelope = z
    .object({
      store_id: z.string().uuid(),
      action: z.enum([
        "system",
        "knowledge",
        "settings",
        "flow",
        "contact",
        "enrol",
        "cancel_contact",
        "verify",
        "owner",
      ]),
      data: z.unknown(),
    })
    .safeParse(await request.json().catch(() => null));
  if (!envelope.success)
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  const { store_id, action } = envelope.data;
  const { data: store } = await staff.client
    .from("stores")
    .select("id")
    .eq("id", store_id)
    .maybeSingle();
  if (!store)
    return NextResponse.json(
      { error: "Loja não encontrada." },
      { status: 404 },
    );
  if (action === "system" || action === "knowledge") {
    const schema =
      action === "system"
        ? systemTemplateSchema
        : z.object({ notes: z.string().max(12000) });
    const parsed = schema.safeParse(envelope.data.data);
    if (!parsed.success)
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(" ? ") },
        { status: 400 },
      );
    const result =
      action === "system"
        ? await staff.client.rpc("email_save_system", {
            p_store_id: store_id,
            p_data: parsed.data,
          })
        : await staff.client.rpc("email_save_knowledge", {
            p_store_id: store_id,
            p_notes: (parsed.data as { notes: string }).notes,
          });
    return NextResponse.json(
      result.error
        ? { error: "N?o foi poss?vel guardar a configura??o." }
        : { ok: true },
      { status: result.error ? 400 : 200 },
    );
  }
  if (action === "verify") {
    const result = await verifyStudioSmtp(store_id);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }
  if (action === "owner") {
    const recipient = z
      .object({ email: z.union([z.string().email(), z.literal("")]) })
      .safeParse(envelope.data.data);
    if (!recipient.success)
      return NextResponse.json({ error: "Email inválido." }, { status: 400 });
    const result = await staff.client.rpc("save_store", {
      p_payload: { id: store_id, owner_email: recipient.data.email },
    });
    return NextResponse.json(
      result.error
        ? { error: "Não foi possível guardar o destinatário." }
        : { ok: true },
      { status: result.error ? 400 : 200 },
    );
  }
  const schema =
    action === "settings"
      ? settingsSchema
      : action === "flow"
        ? flowSchema.safeExtend({ id: z.string().uuid().optional() })
        : action === "contact"
          ? contact
          : id;
  const parsed = schema.safeParse(envelope.data.data);
  if (!parsed.success)
    return NextResponse.json(
      {
        error:
          "Revê os campos: " +
          parsed.error.issues.map((i) => i.message).join(" · "),
      },
      { status: 400 },
    );
  const { data, error } = await staff.client.rpc("email_save", {
    p_store_id: store_id,
    p_action: action,
    p_data: parsed.data,
  });
  if (error)
    return NextResponse.json(
      {
        error:
          error.code === "23505"
            ? "Já existe uma sequência para este evento ou contacto."
            : "Não foi possível guardar. Confirma que o funil está activo e os campos estão completos.",
      },
      { status: 400 },
    );
  return NextResponse.json(data);
}
