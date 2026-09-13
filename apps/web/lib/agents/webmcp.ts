import { z } from 'zod';
import { CART_STORE_KEY } from '@/lib/cart-store';
import { serializeStoreCookie } from '@/lib/store-context';
import { agentOrderSchema, type AgentOrderInput } from './schemas';

export const AGENT_CHECKOUT_KEY = 'agent_checkout_v1';
const PUBLIC_NAMES = ['list_stores', 'get_menu', 'quote_order', 'prepare_checkout'];

type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type AgentCart = { storeSlug: string | null; items: AgentOrderInput['items']; notice: string };

/** Tipagem local enquanto a API experimental ainda não faz parte de lib.dom. */
export interface BrowserTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint: boolean; consequentialHint?: boolean; untrustedContentHint?: boolean };
  execute: (args: Record<string, unknown>, context?: { signal?: AbortSignal }) => Promise<unknown>;
}

export interface ModelContextDocument {
  modelContext?: { registerTool: (tool: BrowserTool, options: { signal: AbortSignal }) => Promise<unknown> | void };
}

/** Best-effort: suporte ausente ou registo recusado nunca afectam a loja. */
export function registerBrowserTools(doc: ModelContextDocument, tools: BrowserTool[]): () => void {
  const controller = new AbortController();
  try {
    const context = doc.modelContext;
    if (typeof context?.registerTool === 'function') {
      for (const tool of tools) {
        try {
          void Promise.resolve(context.registerTool(tool, { signal: controller.signal })).catch(() => {});
        } catch { /* API experimental desactivada: o checkout normal continua. */ }
      }
    }
  } catch { /* Alguns browsers podem recusar o acesso à API por política. */ }
  return () => controller.abort();
}

export function isAgentOrderingPath(pathname: string): boolean {
  return ['/', '/menu', '/upsell', '/checkout', '/pedido-assistido'].includes(pathname)
    || /^\/l\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/.test(pathname)
    || /^\/menu\/[a-zA-Z0-9-]+\/?$/.test(pathname);
}

export async function callPublicAgentTool(
  name: string,
  args: unknown,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  if (!PUBLIC_NAMES.includes(name)) throw new Error('Ferramenta pública inválida.');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, 15_000);
  try {
    const response = await fetcher('/api/agents/tools', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      body: JSON.stringify({ name, arguments: args }),
      signal: controller.signal,
    });
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') throw new Error('Resposta inválida da loja.');
    if (!response.ok) {
      const error = 'error' in body && typeof body.error === 'string' ? body.error : 'Não foi possível consultar a loja. Tenta novamente.';
      throw new Error(error);
    }
    if (!('result' in body) || !body.result || typeof body.result !== 'object' || Array.isArray(body.result)) throw new Error('Resposta inválida da loja.');
    return body.result as Record<string, unknown>;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('A consulta foi interrompida. Tenta novamente.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

/** Navegação só para a revisão desta instalação, sem parâmetros de dados pessoais. */
export function safeAgentReviewUrl(value: unknown, origin: string): string {
  if (typeof value !== 'string' || value.length > 24_000) throw new Error('Ligação de revisão inválida.');
  const url = new URL(value, origin);
  if (url.origin !== origin || url.pathname !== '/pedido-assistido' || url.search || url.hash.length < 2 || url.username || url.password) throw new Error('Ligação de revisão inválida.');
  return `${url.pathname}${url.hash}`;
}

/** O agente só lê selecções públicas; notas livres podem conter dados pessoais. */
export function readAgentCart(storage: Pick<Storage, 'getItem'>): AgentCart {
  const notice = 'Selecção guardada neste browser; preços e disponibilidade precisam de nova consulta. As notas não são partilhadas.';
  try {
    const raw: unknown = JSON.parse(storage.getItem('cart') || '[]');
    const owner = storage.getItem(CART_STORE_KEY);
    const storeSlug = owner && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(owner) ? owner : null;
    if (!Array.isArray(raw) || raw.length > 50) return { storeSlug, items: [], notice };
    const items = raw.map((line: unknown) => {
      if (!line || typeof line !== 'object') throw new Error('Carrinho inválido.');
      const value = line as Record<string, unknown>;
      return {
        menuItemId: value.menuItemId, qty: value.qty,
        ...(value.variantId ? { variantId: value.variantId } : {}),
        ...(value.addonIds ? { addonIds: value.addonIds } : {}),
        ...(value.modifiers ? { modifiers: value.modifiers } : {}),
      };
    });
    if (!items.length) return { storeSlug, items: [], notice };
    const parsed = agentOrderSchema.safeParse({ storeSlug: storeSlug || 'sem-loja', fulfillmentType: 'pickup', items });
    return { storeSlug, items: parsed.success ? parsed.data.items : [], notice };
  } catch {
    return { storeSlug: null, items: [], notice };
  }
}

const checkoutPreferencesSchema = z.object({
  storeSlug: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  fulfillmentType: z.enum(['pickup', 'delivery']),
  deliveryZoneId: z.string().uuid().optional(),
}).strict();

/** Só o botão humano da revisão chama este método. Não cria pedidos nem pagamentos. */
export function saveReviewedAgentCart(
  input: AgentOrderInput,
  storage: StorageAccess,
  session: StorageAccess,
  setCookie: (cookie: string) => void,
): string {
  const selection = agentOrderSchema.parse(input);
  const previous = { cart: storage.getItem('cart'), owner: storage.getItem(CART_STORE_KEY), preferences: session.getItem(AGENT_CHECKOUT_KEY) };
  const restore = (target: StorageAccess, key: string, value: string | null) => value === null ? target.removeItem(key) : target.setItem(key, value);
  try {
    session.setItem(AGENT_CHECKOUT_KEY, JSON.stringify({
      storeSlug: selection.storeSlug,
      fulfillmentType: selection.fulfillmentType,
      ...(selection.deliveryZoneId ? { deliveryZoneId: selection.deliveryZoneId } : {}),
    }));
    storage.setItem(CART_STORE_KEY, selection.storeSlug);
    storage.setItem('cart', JSON.stringify(selection.items));
    setCookie(serializeStoreCookie(selection.storeSlug));
  } catch {
    try { restore(storage, 'cart', previous.cart); } catch { /* Storage pode estar indisponível. */ }
    try { restore(storage, CART_STORE_KEY, previous.owner); } catch { /* Conserva o que ainda é recuperável. */ }
    try { restore(session, AGENT_CHECKOUT_KEY, previous.preferences); } catch { /* Sem navegação em caso de erro. */ }
    throw new Error('Não foi possível guardar o carrinho neste browser. Tenta novamente.');
  }
  return `/checkout?store=${encodeURIComponent(selection.storeSlug)}`;
}

/** Consume uma vez, após o checkout conhecer as zonas da loja seleccionada. */
export function consumeAgentCheckout(
  session: StorageAccess,
  storeSlug: string,
  zoneIds: string[],
): { fulfillmentType: 'pickup' | 'delivery'; deliveryZoneId: string } | null {
  try {
    const raw = session.getItem(AGENT_CHECKOUT_KEY);
    session.removeItem(AGENT_CHECKOUT_KEY);
    if (!raw) return null;
    const parsed = checkoutPreferencesSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.storeSlug !== storeSlug) return null;
    const { fulfillmentType, deliveryZoneId } = parsed.data;
    return { fulfillmentType, deliveryZoneId: fulfillmentType === 'delivery' && deliveryZoneId && zoneIds.includes(deliveryZoneId) ? deliveryZoneId : '' };
  } catch { return null; }
}
