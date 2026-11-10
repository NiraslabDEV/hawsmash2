/**
 * Em que coluna do kanban fica cada conversa do WhatsApp.
 *
 * As colunas mudam sozinhas: lêem o passo em que o bot está
 * (`whatsapp_conversations.state.step`, ADR 0012) e a hora da última mensagem
 * do cliente. Nada aqui escreve na conversa: o quadro só mostra.
 *
 * Sem zod nem o motor da conversa de propósito: este ficheiro entra no bundle
 * do browser, e o motor traz o despacho do servidor.
 */

export const KANBAN_COLUMNS = ['novas', 'a_pedir', 'comprovativo', 'humano', 'fechadas'] as const;
export type KanbanColumn = (typeof KANBAN_COLUMNS)[number];

export const COLUMN_LABEL: Record<KanbanColumn, string> = {
  novas: 'Novas',
  a_pedir: 'A pedir (bot)',
  comprovativo: 'À espera do comprovativo',
  humano: 'Precisa de humano',
  fechadas: 'Fechadas',
};

export const COLUMN_HINT: Record<KanbanColumn, string> = {
  novas: 'Escreveram e ainda não começaram um pedido.',
  a_pedir: 'O bot está a montar o pedido com o cliente.',
  comprovativo: 'Pedido criado: falta o comprovativo do M-Pesa/e-Mola.',
  humano: 'O cliente disse que algo correu mal. Ler e responder.',
  fechadas: 'Pedido entregue ao bot, ou sem resposta há mais de 24 h.',
};

/** A Meta só deixa responder livremente nas 24 h depois da última mensagem do cliente. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

const STEP_LABEL: Record<string, string> = {
  idle: 'No menu',
  item: 'A escolher o produto',
  qty: 'A escolher a quantidade',
  fulfillment: 'Entrega ou levantamento',
  zone: 'A escolher a zona',
  address: 'A dar a morada',
  name: 'A dar o nome',
  payment: 'A escolher o pagamento',
  confirm: 'Resumo à espera do "Confirmar"',
  proof: 'À espera do comprovativo',
  feedback: 'Disse que correu mal',
};

const BUILDING = new Set(['item', 'qty', 'fulfillment', 'zone', 'address', 'name', 'payment', 'confirm']);

export interface ConversationRow {
  id: string;
  phone: string;
  profile_name: string | null;
  last_inbound_at: string | null;
  updated_at: string;
  state: unknown;
}

export interface KanbanCard {
  id: string;
  phone: string;
  name: string | null;
  column: KanbanColumn;
  stepLabel: string;
  cartItems: number;
  orderNumber: string | null;
  lastInboundAt: string | null;
  /** Ainda dá para responder fora de template. */
  windowOpen: boolean;
}

function readState(raw: unknown): { step: string; cart: number; order: string | null } {
  const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const step = typeof s.step === 'string' && s.step in STEP_LABEL ? s.step : 'idle';
  const cart = Array.isArray(s.cart) ? s.cart.length : 0;
  const order = s.order && typeof s.order === 'object' ? (s.order as Record<string, unknown>).number : null;
  return { step, cart, order: typeof order === 'string' ? order : null };
}

export function toCard(row: ConversationRow, now = Date.now()): KanbanCard {
  const { step, cart, order } = readState(row.state);
  const last = row.last_inbound_at ? Date.parse(row.last_inbound_at) : NaN;
  const windowOpen = Number.isFinite(last) && now - last < SERVICE_WINDOW_MS;

  let column: KanbanColumn;
  // O que pede uma pessoa ou um pagamento não sai do quadro por ter passado o dia.
  if (step === 'feedback') column = 'humano';
  else if (step === 'proof') column = 'comprovativo';
  else if (!windowOpen) column = 'fechadas';
  else if (BUILDING.has(step) || cart > 0) column = 'a_pedir';
  else if (order) column = 'fechadas';
  else column = 'novas';

  return {
    id: row.id,
    phone: row.phone,
    name: row.profile_name,
    column,
    stepLabel: cart > 0 && step === 'idle' ? 'Com carrinho, no menu' : STEP_LABEL[step],
    cartItems: cart,
    orderNumber: order,
    lastInboundAt: row.last_inbound_at,
    windowOpen,
  };
}

/** Os cartões por coluna, o mais recente primeiro. */
export function groupByColumn(rows: ConversationRow[], now = Date.now()): Record<KanbanColumn, KanbanCard[]> {
  const out = Object.fromEntries(KANBAN_COLUMNS.map((c) => [c, [] as KanbanCard[]])) as Record<KanbanColumn, KanbanCard[]>;
  const cards = rows.map((r) => toCard(r, now));
  cards.sort((a, b) => (Date.parse(b.lastInboundAt ?? '') || 0) - (Date.parse(a.lastInboundAt ?? '') || 0));
  for (const card of cards) out[card.column].push(card);
  return out;
}

/**
 * O que o bot respondeu, legível no painel: o texto e, se houver, os botões
 * ("[Confirmar] [Alterar]"). Um aviso (template) não tem payload: fica null e
 * o ecrã mostra o nome do evento.
 */
export function outboundText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const text = typeof p.text === 'string' ? p.text : null;
  if (!text) return null;
  const titles: string[] = [];
  if (Array.isArray(p.buttons)) for (const b of p.buttons) if (b && typeof b === 'object' && typeof (b as { title?: unknown }).title === 'string') titles.push((b as { title: string }).title);
  if (typeof p.button === 'string') titles.push(p.button);
  if (typeof p.displayText === 'string') titles.push(p.displayText);
  return titles.length ? `${text}\n${titles.map((t) => `[${t}]`).join(' ')}` : text;
}

/** "há 5 min", "há 3 h", "há 2 dias". */
export function since(iso: string | null, now = Date.now()): string {
  if (!iso) return '—';
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} ${d === 1 ? 'dia' : 'dias'}`;
}
