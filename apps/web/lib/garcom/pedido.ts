/**
 * O pedido que o garçom monta no telemóvel (1122).
 *
 * O carrinho é o do balcão (`lib/pos/cart.ts`): a mesma regra de preço da
 * variante, a mesma identidade de linha, o mesmo payload de ids e quantidades.
 * Aqui só está o que o telemóvel acrescenta:
 *
 *  - pôr um artigo já com variante, extras e nota de uma vez (no POS os extras
 *    entram depois, no funil; no telemóvel escolhe-se tudo no mesmo ecrã);
 *  - o rascunho por mesa guardado no telemóvel, com o `clientSaleId` — um
 *    ecrã que recarrega a meio, ou rede que cai no envio, não perde o pedido
 *    nem o lança duas vezes (Regra 4);
 *  - o que está pronto para levar à mesa;
 *  - o que o mini POS pode mostrar: retirar e cobrar (1127).
 */

import { z } from 'zod';

import {
  cartKey,
  cartLines,
  resolveSellable,
  salePayloadItems,
  type Cart,
  type CartLine,
  type PosAddon,
  type PosVariant,
  type Sellable,
} from '@/lib/pos/cart';
import type { PosMenuItem } from '@/lib/pos/offline-store';
import { enabledPaymentMethods, resolvePosSettings } from '@/lib/pos/settings';
import type { PosTable, TableOrder } from '@/lib/pos/tables';

/**
 * Um artigo com variante, extras e nota, pronto para o carrinho. Igual ao que
 * o POS faz com `resolveSellable` + `toggleLineAddon`: os extras pela ordem do
 * Cardápio, o preço deles somado ao do lanche, e na identidade da linha.
 */
export function buildSellable(
  item: PosMenuItem,
  variant: PosVariant | null,
  addonIds: readonly string[],
  notes: string | null,
): Sellable {
  const base = resolveSellable(item, variant, notes);
  const escolhidos = new Set(addonIds);
  const addons: PosAddon[] = (item.addons ?? []).filter((addon) => escolhidos.has(addon.id));
  if (addons.length === 0) return base;
  return {
    ...base,
    id: cartKey(item.id, variant?.id ?? null, base.notes, addons.map((addon) => addon.id)),
    addons,
    price_cents: base.price_cents + addons.reduce((soma, addon) => soma + addon.price_cents, 0),
  };
}

/** Escolher no ecrã só quando há escolha a fazer: duas variantes ou algum extra. */
export function needsItemSheet(item: PosMenuItem): boolean {
  return (item.variants?.length ?? 0) > 1 || (item.addons?.length ?? 0) > 0;
}

// ─── Rascunho por mesa ────────────────────────────────────────────────────────

/** Um rascunho esquecido de ontem não deve aparecer no turno de hoje. */
export const RASCUNHO_MAX_IDADE_MS = 12 * 60 * 60 * 1000;

export type Rascunho = {
  tableId: string;
  /** A chave do envio. Só muda depois de a cozinha ter recebido o pedido. */
  clientSaleId: string;
  cart: Cart;
  customerName: string;
  /** Da conta, como o nome (1129). O garçom escreve-o, mas não lê o que lá está. */
  customerPhone: string;
  /** A característica do cliente, "camisa azul" (1129). */
  tabNote: string;
  notes: string;
  /**
   * As pessoas da mesa, pela ordem em que o garçom as juntou (1137). Vazio =
   * pedido da mesa toda, como antes.
   */
  pessoas: string[];
  /** Para quem vão os próximos toques. Null = a mesa toda. */
  pessoa: string | null;
  /**
   * O envio saiu e não se sabe se chegou (rede caiu, servidor não respondeu).
   * Enquanto estiver assim o pedido não se mexe: reenviar com a mesma chave
   * devolve o pedido que já lá estiver, mas um pedido alterado não seria
   * reenviado — ficava na cozinha a versão antiga sem ninguém saber.
   */
  pendente: boolean;
  updatedAt: number;
};

export const rascunhoKey = (tableId: string) => `garcom:rascunho:${tableId}`;

const addonSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  price_cents: z.number().int().nonnegative(),
  photo_url: z.string().nullable().optional(),
});

const lineSchema = z.object({
  id: z.string().min(1),
  menuItemId: z.string().min(1),
  variantId: z.string().nullable(),
  name: z.string().min(1),
  price_cents: z.number().int().nonnegative(),
  station: z.enum(['kitchen', 'bar']),
  photo_url: z.string().nullable(),
  notes: z.string().nullable(),
  addons: z.array(addonSchema).optional(),
  person: z.string().max(40).nullable().optional(),
  qty: z.number().int().min(1).max(99),
});

const rascunhoSchema = z.object({
  tableId: z.string().min(1),
  clientSaleId: z.string().uuid(),
  cart: z.record(z.string(), lineSchema),
  customerName: z.string().max(60).default(''),
  customerPhone: z.string().max(20).default(''),
  tabNote: z.string().max(120).default(''),
  notes: z.string().max(300).default(''),
  pessoas: z.array(z.string().min(1).max(40)).max(30).default([]),
  pessoa: z.string().max(40).nullable().default(null),
  pendente: z.boolean().default(false),
  updatedAt: z.number(),
});

export function novoRascunho(tableId: string, clientSaleId: string, now: number): Rascunho {
  return {
    tableId,
    clientSaleId,
    cart: {},
    customerName: '',
    customerPhone: '',
    tabNote: '',
    notes: '',
    pessoas: [],
    pessoa: null,
    pendente: false,
    updatedAt: now,
  };
}

/**
 * O rascunho guardado desta mesa, ou null. Tolerante: lixo, outra mesa ou um
 * rascunho velho dão null em vez de rebentar o ecrã.
 *
 * Excepção à idade: um envio pendente nunca se deita fora sozinho — pode já
 * estar na cozinha, e só o reenvio com a mesma chave o diz.
 */
export function lerRascunho(raw: string | null, tableId: string, now: number): Rascunho | null {
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = rascunhoSchema.safeParse(json);
  if (!parsed.success || parsed.data.tableId !== tableId) return null;
  const rascunho = parsed.data as Rascunho;
  if (!rascunho.pendente && now - rascunho.updatedAt > RASCUNHO_MAX_IDADE_MS) return null;
  return rascunho;
}

// ─── Pessoas da mesa (1137) ──────────────────────────────────────────────────

export const MAX_PESSOA = 40;

const mesmaPessoa = (a: string, b: string) => a.toLocaleLowerCase('pt') === b.toLocaleLowerCase('pt');

/**
 * O nome que fica: aparado e curto. Em branco, "Pessoa N", para o garçom poder
 * juntar alguém sem escrever. Null se já houver alguém com esse nome.
 */
export function nomeDePessoa(escrito: string, pessoas: readonly string[], ignorar?: string): string | null {
  const nome = escrito.trim().replace(/\s+/g, ' ').slice(0, MAX_PESSOA);
  const outras = pessoas.filter((p) => p !== ignorar);
  if (nome) return outras.some((p) => mesmaPessoa(p, nome)) ? null : nome;
  for (let n = pessoas.length + 1; ; n++) {
    const sugestao = `Pessoa ${n}`;
    if (!outras.some((p) => mesmaPessoa(p, sugestao))) return sugestao;
  }
}

const prefixo = (pessoa: string) => `p:${pessoa.toLocaleLowerCase('pt')}|`;

/** O artigo, mas para esta pessoa: o mesmo Classic da Ana e do Rui são duas linhas. */
export function naPessoa(sellable: Sellable, pessoa: string | null): Sellable {
  const actual = sellable.person ? prefixo(sellable.person) : '';
  const base = actual && sellable.id.startsWith(actual) ? sellable.id.slice(actual.length) : sellable.id;
  if (!pessoa) return { ...sellable, id: base, person: null };
  return { ...sellable, id: prefixo(pessoa) + base, person: pessoa };
}


/** Mudar de nome leva os pratos dela consigo. */
export function renomearPessoa(r: Rascunho, de: string, para: string): Rascunho {
  const cart: Cart = {};
  for (const linha of cartLines(r.cart)) {
    const nova = linha.person === de ? { ...naPessoa(linha, para), qty: linha.qty } : linha;
    cart[nova.id] = nova;
  }
  return {
    ...r,
    cart,
    pessoas: r.pessoas.map((p) => (p === de ? para : p)),
    pessoa: r.pessoa === de ? para : r.pessoa,
  };
}

/** Tirar alguém da mesa: os pratos dela ficam, passam para a mesa toda. */
export function tirarPessoa(r: Rascunho, nome: string): Rascunho {
  const cart: Cart = {};
  for (const linha of cartLines(r.cart)) {
    const nova = linha.person === nome ? { ...naPessoa(linha, null), qty: linha.qty } : linha;
    const existente = cart[nova.id];
    cart[nova.id] = existente ? { ...existente, qty: Math.min(99, existente.qty + nova.qty) } : nova;
  }
  return { ...r, cart, pessoas: r.pessoas.filter((p) => p !== nome), pessoa: r.pessoa === nome ? null : r.pessoa };
}

/** Quantos pratos tem cada pessoa (null = a mesa toda). */
export function pratosDe(cart: Cart, pessoa: string | null): number {
  return cartLines(cart)
    .filter((linha) => (linha.person ?? null) === pessoa)
    .reduce((soma, linha) => soma + linha.qty, 0);
}

/**
 * O pedido arrumado por pessoa, pela ordem em que se juntaram; o que é da mesa
 * toda vai no fim. Pessoas sem nada não aparecem.
 */
export function porPessoa(r: Pick<Rascunho, 'cart' | 'pessoas'>): Array<{ pessoa: string | null; linhas: CartLine[] }> {
  const linhas = cartLines(r.cart);
  const grupos = [...r.pessoas, null].map((pessoa) => ({
    pessoa,
    linhas: linhas.filter((linha) => (linha.person ?? null) === pessoa),
  }));
  // Uma linha de alguém que já não está na lista (rascunho antigo) não se perde.
  const conhecidas = new Set(r.pessoas);
  const orfas = linhas.filter((linha) => linha.person && !conhecidas.has(linha.person));
  if (orfas.length > 0) grupos[grupos.length - 1].linhas.push(...orfas);
  return grupos.filter((g) => g.linhas.length > 0);
}

/** O que vai ao servidor: os ids do balcão e, quando há, de quem é cada prato. */
export function itensDoEnvio(linhas: CartLine[]) {
  return salePayloadItems(linhas).map((item, i) => {
    const pessoa = linhas[i].person?.trim();
    return pessoa ? { ...item, person: pessoa } : item;
  });
}

/**
 * O envio falhou: ficou decidido que não entrou, ou não se sabe?
 *
 * A RPC é uma transacção: uma resposta da rota com o código da BD (409),
 * pedido inválido (400) ou sessão terminada (401) quer dizer que nada foi
 * gravado — pode-se corrigir o pedido. Sem resposta, ou com um 5xx do proxy,
 * a cozinha pode já o ter: só se reenvia, igual.
 */
export function falhaDeEnvio(status: number): 'recusado' | 'incerto' {
  return status === 400 || status === 401 || status === 409 ? 'recusado' : 'incerto';
}

// ─── Mesas ───────────────────────────────────────────────────────────────────

export const ESTADO_PEDIDO: Record<string, string> = {
  in_preparation: 'Na cozinha',
  ready: 'Pronto',
  delivered: 'Servido',
  cancelled: 'Cancelado',
};

/** Quem lançou o pedido: "Garçom Ana", "QR" ou "Balcão". */
export function origemPedido(order: Pick<TableOrder, 'origin' | 'waiter_name'>): string {
  if (order.waiter_name) return order.waiter_name;
  return order.origin === 'qr' ? 'QR' : 'Balcão';
}

/** O que está pronto para levar às mesas, do mais antigo para o mais recente. */
export function prontosParaServir(tables: readonly PosTable[]): Array<{ table: PosTable; order: TableOrder }> {
  return tables
    .flatMap((table) => table.orders.filter((order) => order.status === 'ready').map((order) => ({ table, order })))
    .sort((a, b) => new Date(a.order.created_at).getTime() - new Date(b.order.created_at).getTime());
}

/** Pedidos que ficaram prontos desde a última leitura — é quando o telemóvel vibra. */
export function novosProntos(antes: ReadonlySet<string>, tables: readonly PosTable[]): string[] {
  return prontosParaServir(tables)
    .map(({ order }) => order.id)
    .filter((id) => !antes.has(id));
}

/** Pode o garçom marcar "Servido"? Só o que já foi para a cozinha e não foi servido. */
export function podeServir(order: Pick<TableOrder, 'status'>): boolean {
  return order.status === 'in_preparation' || order.status === 'ready';
}

/**
 * Pode o garçom retirar deste pedido? Só o que ele lançou, ainda na cozinha e
 * dentro do limite da loja (1127). É só para o ecrã não mostrar um botão que vai
 * ser recusado: quem decide é `waiter_remove_item`, com o relógio do servidor.
 */
export function podeRetirar(
  order: Pick<TableOrder, 'status' | 'created_at' | 'waiter_id'>,
  waiterId: string,
  limiteMinutos: number,
  now: number,
): boolean {
  if (order.waiter_id !== waiterId || order.status !== 'in_preparation' || limiteMinutos <= 0) return false;
  return now - new Date(order.created_at).getTime() <= limiteMinutos * 60_000;
}

/** Os meios com que o garçom pode cobrar: os ligados na loja, sem dinheiro em notas. */
export function meiosDeCobrar(raw: unknown): Array<{ id: 'mpesa' | 'emola' | 'credit_card'; label: string }> {
  return enabledPaymentMethods(resolvePosSettings(raw ?? {})).flatMap((m) =>
    m.id === 'cash' ? [] : [{ id: m.id, label: m.label }],
  );
}
