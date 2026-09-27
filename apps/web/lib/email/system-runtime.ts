import { createClient } from '@supabase/supabase-js';
import { getBrand } from '@/lib/brand/server';
import {
  SYSTEM_EMAILS,
  applySystemTemplate,
  systemTemplateSchema,
  type SystemEmailKey,
} from './system-catalog';

function client() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  )
    return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function prepareSystemEmail(input: {
  event?: SystemEmailKey;
  storeId?: string;
  subject: string;
  html: string;
  variables?: Record<string, string>;
}) {
  const fallback = {
    subject: input.subject,
    html: input.html,
    enabled: true,
    storeId: input.storeId,
  };
  if (!input.event) return fallback;
  try {
    const svc = client();
    if (!svc) return fallback;
    const global =
      SYSTEM_EMAILS.find((e) => e.key === input.event)?.scope === 'global';
    const query = svc
      .from('stores')
      .select('id,name,slug')
      .order('sort')
      .order('id')
      .limit(1);
    const { data: store } = await (
      global || !input.storeId ? query : query.eq('id', input.storeId)
    ).maybeSingle();
    if (!store) return fallback;
    const { data } = await svc
      .from('email_system_templates')
      .select('key,mode,enabled,template_id,step')
      .eq('store_id', store.id)
      .eq('key', input.event)
      .maybeSingle();
    const parsed = systemTemplateSchema.safeParse(data);
    if (!parsed.success) return { ...fallback, storeId: store.id };
    const base =
      process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_BASE_URL || '';
    const content = applySystemTemplate(parsed.data, input, {
      loja: global ? (await getBrand()).name : store.name,
      menu_url: `${base}/l/${encodeURIComponent(store.slug)}`,
      ...input.variables,
    });
    return { ...content, enabled: parsed.data.enabled, storeId: store.id };
  } catch {
    return fallback;
  } // Email nunca reverte uma venda se a configuração falhar.
}
export async function logSystemEmail(
  event: SystemEmailKey | undefined,
  storeId: string | undefined,
  recipients: string[],
  status: 'sent' | 'failed' | 'disabled',
) {
  if (!event || !storeId) return;
  try {
    await client()
      ?.from('email_delivery_log')
      .insert(
        recipients.map((recipient) => ({
          store_id: storeId,
          event,
          recipient,
          status,
        })),
      );
  } catch {
    /* best-effort; nunca guardar corpo ou código de acesso */
  }
}
