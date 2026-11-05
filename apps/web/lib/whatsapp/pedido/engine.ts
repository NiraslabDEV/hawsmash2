import { compactSession, LIMITS, normalizeWord, type InboundMedia, type ListRow, type ReplyButton, type SessionContent } from "@delivery/whatsapp";
import { encodeAgentHandoff } from "@/lib/agents/handoff";
import { AgentToolError, priceItems, quoteLine, type Catalogue, type CatalogueItem, type PublicStore } from "@/lib/agents/service";
import {
  activeAddons, activeGroups, activeOptions, activeVariants, channels, findItem, fmt, manualMethods,
  nextOpeningText, priceLabel, usableCategories, type ManualMethod,
} from "./catalogue";
import { expireState, type CartLine, type ConversationState, type Draft } from "./state";

/**
 * A conversa de pedido do WhatsApp (ADR 0012). Função pura sobre o estado: os efeitos (criar o pedido,
 * guardar o comprovativo, perguntar à IA) entram por `deps` — testável sem rede nem BD.
 *
 * Regras que não se dobram:
 * - Os números (preço, total, taxa) vêm do catálogo e, no fim, do create_order. A IA só conversa.
 * - O pedido só nasce com o "Confirmar" de um resumo concreto (`checkoutId`), uma única vez.
 * - Nada aqui bloqueia a loja: se algo falha, a pessoa recebe uma frase e pode continuar ou ir ao site.
 */

export interface TurnInput {
  inboundId: string;
  now: number;
  text: string | null;
  replyId: string | null;
  media: InboundMedia | null;
  contentType: string;
  profileName: string | null;
  optOut: boolean;
}

export interface TurnContext {
  menu: Catalogue;
  store: PublicStore;
  /** Origem pública do site (https), para links de acompanhamento e de checkout. */
  baseUrl: string;
  /** Número para falar com uma pessoa (o WhatsApp da loja que fica na app). */
  handoffPhone: string | null;
  aiEnabled: boolean;
}

export type CreateOrderResult =
  | { ok: true; orderId: string; orderNumber: string; totalCents: number; method: "mpesa" | "emola"; created: boolean }
  | { ok: false; code: string };
export type ProofResult = "ok" | "already" | "invalid_type" | "error";
export interface PendingOrder { orderId: string; orderNumber: string; totalCents: number; method: "mpesa" | "emola" | string }

export type AiItem = Pick<CartLine, "menuItemId" | "qty" | "variantId" | "addonIds" | "modifiers">;
export interface AiIntent {
  reply: string;
  action: "add_items" | "show_menu" | "show_category" | "show_cart" | "checkout" | "human" | "order_status" | "none";
  items?: AiItem[];
  categoryId?: string;
}

export interface TurnDeps {
  newId(): string;
  createOrder(checkoutId: string, payload: Record<string, unknown>): Promise<CreateOrderResult>;
  pendingOrder(): Promise<PendingOrder | null>;
  attachProof(orderId: string, media: InboundMedia): Promise<ProofResult>;
  interpret?(request: { text: string; state: ConversationState; ctx: TurnContext }): Promise<AiIntent | null>;
}

export const AI_CALLS_PER_HOUR = 20;
const PAGE = 8;
const MAX_QTY = 20;

const GREETINGS = /^(OLA|OI|BOM DIA|BOA TARDE|BOA NOITE|BOAS|HELLO|HI|HEY|SALAM|ALO|E AI|EAI)\b/;
const COMMANDS: Record<string, string> = {
  MENU: "menu", CARDAPIO: "menu", PEDIR: "menu", "FAZER PEDIDO": "menu", INICIO: "menu", COMECAR: "menu",
  CARRINHO: "cart", "VER CARRINHO": "cart",
  CANCELAR: "clear", LIMPAR: "clear", RECOMECAR: "clear", ESVAZIAR: "clear",
  AJUDA: "human", ATENDENTE: "human", HUMANO: "human", PESSOA: "human", "FALAR COM ALGUEM": "human",
  ESTADO: "status", "MEU PEDIDO": "status", "ONDE ESTA O MEU PEDIDO": "status",
  FINALIZAR: "checkout", "FECHAR PEDIDO": "checkout",
};

export async function runTurn(
  initial: ConversationState,
  input: TurnInput,
  ctx: TurnContext,
  deps: TurnDeps,
): Promise<{ state: ConversationState; replies: SessionContent[] }> {
  let s: ConversationState = expireState(initial, input.now);
  const out: SessionContent[] = [];
  const say = (m: SessionContent) => { if (out.length < 4) out.push(m); };
  const { menu, store } = ctx;
  const methods = manualMethods(menu);

  // ── Textos e mensagens ──────────────────────────────────────────────────
  const cartCount = () => s.cart.reduce((n, l) => n + l.qty, 0);
  const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0]?.slice(0, 30) ?? "";

  function cartTotal(): { text: string; subtotal: number } | { error: string } {
    try {
      const { lines, subtotalCents } = priceItems(menu, s.cart);
      const text = lines.map((l, i) => {
        const extras = [l.variantName, ...l.addonNames, ...l.modifierNames].filter(Boolean).join(" · ");
        return `${i + 1}. ${l.qty}× ${l.name} — ${fmt(l.lineTotalCents)}${extras ? `\n     _${extras}_` : ""}`;
      }).join("\n");
      return { text, subtotal: subtotalCents };
    } catch (error) {
      return { error: error instanceof AgentToolError ? error.message : "Não consegui calcular o carrinho." };
    }
  }

  function welcome(prefix?: string) {
    const name = firstName(input.profileName ?? s.name);
    const closed = !store.open_now ? `\n\n🕒 Agora estamos fechados. ${nextOpeningText(menu.hours, input.now) ?? ""}`.trimEnd() : "";
    const ai = ctx.aiEnabled ? "\nTambém podes escrever o que te apetece, por exemplo: _«quero 2 hambúrgueres e um refrigerante»_." : "";
    const text = `${prefix ? `${prefix}\n\n` : ""}Olá${name ? `, ${name}` : ""}! 👋 Bem-vindo à *${store.name}*.\nPodes fazer o pedido aqui mesmo, sem sair do WhatsApp.${ai}${closed}`;
    const cats = usableCategories(menu);
    if (!cats.length) {
      say({ type: "buttons", text, buttons: [{ id: "human", title: "💬 Falar com a loja" }] });
      return;
    }
    // O cardápio vem já no botão das boas-vindas: um passo a menos é uma mensagem a menos a pagar.
    const rows = cats.slice(0, PAGE).map(categoryRow);
    if (cats.length > PAGE) rows.push({ id: "catp:1", title: "➡️ Mais categorias" });
    rows.push(s.cart.length ? { id: "cart", title: `🛒 Carrinho (${cartCount()})` } : { id: "human", title: "💬 Falar com a loja" });
    say({ type: "list", text, button: "Ver cardápio", sections: [{ rows }] });
  }

  function categoryRow(c: ReturnType<typeof usableCategories>[number]): ListRow {
    return { id: `cat:${c.id}`, title: c.name, description: `${c.usable.length} ${c.usable.length === 1 ? "opção" : "opções"}` };
  }

  /**
   * O corpo com botões leva 1.024 caracteres e o corte é pelo fim — onde estão o total e a morada.
   * O que não couber vai em texto à parte (até 4.096) e os botões seguem numa mensagem curta.
   */
  function sayLong(text: string, buttons: ReplyButton[], short: string) {
    if (Array.from(text).length <= LIMITS.interactiveBody) {
      say({ type: "buttons", text, buttons });
    } else {
      say({ type: "text", text });
      say({ type: "buttons", text: short, buttons });
    }
  }

  function categoryList(page = 0, prefix?: string) {
    const cats = usableCategories(menu);
    if (!cats.length) {
      say({ type: "text", text: "O cardápio não está disponível neste momento. Tenta daqui a pouco 🙏" });
      return;
    }
    const slice = cats.slice(page * PAGE, page * PAGE + PAGE);
    const rows: ListRow[] = slice.map(categoryRow);
    if ((page + 1) * PAGE < cats.length) rows.push({ id: `catp:${page + 1}`, title: "➡️ Mais categorias" });
    if (s.cart.length) rows.push({ id: "cart", title: `🛒 Carrinho (${cartCount()})` });
    say({ type: "list", text: `${prefix ? `${prefix}\n\n` : ""}Escolhe uma categoria 👇`, button: "Ver categorias", sections: [{ rows }] });
  }

  function itemList(categoryId: string, page = 0) {
    const cat = usableCategories(menu).find((c) => c.id === categoryId);
    if (!cat) return categoryList(0, "Essa categoria já não está disponível.");
    const slice = cat.usable.slice(page * PAGE, page * PAGE + PAGE);
    const rows: ListRow[] = slice.map((item) => ({
      id: `item:${item.id}`, title: item.name,
      description: [priceLabel(item), item.description ?? ""].filter(Boolean).join(" · "),
    }));
    if ((page + 1) * PAGE < cat.usable.length) rows.push({ id: `items:${cat.id}:${page + 1}`, title: "➡️ Mais produtos" });
    rows.push({ id: "menu", title: "⬅️ Categorias" });
    say({ type: "list", text: `*${cat.name}* — escolhe o produto 👇`, button: "Ver produtos", sections: [{ rows }] });
  }

  // ── Configurar um produto ───────────────────────────────────────────────
  function startItem(itemId: string, preset?: Partial<Draft>) {
    const found = findItem(menu, itemId);
    if (!found || !found.item.available || found.item.available_delivery === false) {
      return categoryList(0, "Esse produto está esgotado ou indisponível agora 😕");
    }
    s = {
      ...s, step: "item",
      draft: {
        menuItemId: itemId, addonIds: [], modifiers: [], doneGroups: [], addonsDone: false, page: 0, ...preset,
      },
    };
    askNext(found.item, true);
  }

  function itemHeader(item: CatalogueItem) {
    const desc = item.description?.trim() ? `\n${item.description.trim().slice(0, 200)}` : "";
    return `*${item.name}* — ${priceLabel(item)}${desc}`;
  }

  function askNext(item: CatalogueItem, withHeader = false) {
    const d = s.draft!;
    const head = withHeader ? `${itemHeader(item)}\n\n` : "";
    const variants = activeVariants(item);
    if (variants.length && !d.variantId) {
      if (variants.length === 1) { s = { ...s, draft: { ...d, variantId: variants[0].id } }; return askNext(item, withHeader); }
      const page = d.page;
      const rows: ListRow[] = variants.slice(page * PAGE, page * PAGE + PAGE).map((v) => ({ id: `var:${v.id}`, title: v.name, description: fmt(v.price_cents) }));
      if ((page + 1) * PAGE < variants.length) rows.push({ id: "pg:next", title: "➡️ Mais opções" });
      say({ type: "list", text: `${head}Escolhe o tamanho/versão:`, button: "Escolher", sections: [{ rows }] });
      return;
    }
    const group = activeGroups(item).find((g) => !d.doneGroups.includes(g.id));
    if (group) {
      const chosen = d.modifiers.find((m) => m.groupId === group.id)?.optionIds ?? [];
      const options = activeOptions(group);
      const page = d.page;
      const rows: ListRow[] = options.slice(page * PAGE, page * PAGE + PAGE).map((o) => ({
        id: `opt:${group.id}:${o.id}`,
        title: `${chosen.includes(o.id) ? "✅ " : ""}${o.name}`,
        description: o.price_cents > 0 ? `+ ${fmt(o.price_cents)}` : "",
      }));
      if ((page + 1) * PAGE < options.length) rows.push({ id: "pg:next", title: "➡️ Mais opções" });
      const multi = group.selection_type === "multi" && group.max_select > 1;
      if (chosen.length >= group.min_select && (multi || group.min_select === 0)) {
        rows.push({ id: `grp:${group.id}`, title: chosen.length ? "✔️ Concluir" : `Sem ${group.name.toLowerCase()}` });
      }
      const rule = multi
        ? `Escolhe até ${group.max_select}${group.min_select ? ` (mínimo ${group.min_select})` : ""}.`
        : group.min_select ? "Escolhe uma opção." : "Opcional.";
      const free = group.free_quantity > 0 && group.extra_price_cents > 0
        ? ` ${group.free_quantity} incluída(s); cada extra + ${fmt(group.extra_price_cents)}.` : "";
      const picked = chosen.length
        ? `\nJá escolhido: ${options.filter((o) => chosen.includes(o.id)).map((o) => o.name).join(", ")}.` : "";
      say({ type: "list", text: `${head}*${group.name}* — ${rule}${free}${picked}`, button: "Escolher", sections: [{ rows }] });
      return;
    }
    const addons = activeAddons(item);
    if (addons.length && !d.addonsDone) {
      const page = d.page;
      const rows: ListRow[] = addons.slice(page * PAGE, page * PAGE + PAGE).map((a) => ({
        id: `add:${a.id}`, title: `${d.addonIds.includes(a.id) ? "✅ " : ""}${a.name}`, description: `+ ${fmt(a.price_cents)}`,
      }));
      if ((page + 1) * PAGE < addons.length) rows.push({ id: "pg:next", title: "➡️ Mais adicionais" });
      rows.push({ id: "addok", title: d.addonIds.length ? "✔️ Concluir" : "Sem adicionais" });
      say({ type: "list", text: `${head}Queres adicionar alguma coisa?`, button: "Adicionais", sections: [{ rows }] });
      return;
    }
    s = { ...s, step: "qty" };
    say({
      type: "buttons",
      text: `${head}Quantas *${item.name}*? Toca num número ou escreve outro (até ${MAX_QTY}).`,
      buttons: [{ id: "qty:1", title: "1" }, { id: "qty:2", title: "2" }, { id: "qty:3", title: "3" }],
    });
  }

  function draftItem(): CatalogueItem | null {
    if (!s.draft) return null;
    return findItem(menu, s.draft.menuItemId)?.item ?? null;
  }

  function sameLine(a: CartLine, b: CartLine) {
    const key = (l: CartLine) => JSON.stringify([
      l.menuItemId, l.variantId ?? null, [...(l.addonIds ?? [])].sort(),
      [...(l.modifiers ?? [])].map((m) => [m.groupId, [...m.optionIds].sort()]).sort(),
    ]);
    return key(a) === key(b);
  }

  function addToCart(line: CartLine): { ok: true; summary: string } | { ok: false; error: string } {
    const found = findItem(menu, line.menuItemId);
    if (!found) return { ok: false, error: "Esse produto já não está no cardápio." };
    let lineInfo;
    try { lineInfo = quoteLine(line, found.item); } catch (error) {
      return { ok: false, error: error instanceof AgentToolError ? error.message : "Escolhas inválidas." };
    }
    const existing = s.cart.findIndex((l) => sameLine(l, line));
    const cart = existing >= 0
      ? s.cart.map((l, i) => (i === existing ? { ...l, qty: Math.min(l.qty + line.qty, 50) } : l))
      : [...s.cart, line];
    if (cart.length > 20) return { ok: false, error: "O carrinho chegou ao limite de 20 produtos diferentes." };
    if (cart.reduce((n, l) => n + l.qty, 0) > 100) return { ok: false, error: "O pedido está limitado a 100 unidades." };
    try { priceItems(menu, cart); } catch (error) {
      return { ok: false, error: error instanceof AgentToolError ? error.message : "Não consegui juntar ao carrinho." };
    }
    s = { ...s, cart };
    const extras = [lineInfo.variantName, ...lineInfo.addonNames, ...lineInfo.modifierNames].filter(Boolean).join(" · ");
    return { ok: true, summary: `${line.qty}× ${lineInfo.name}${extras ? ` (${extras})` : ""} — ${fmt(lineInfo.lineTotalCents)}` };
  }

  function afterAdd(lines: string[]) {
    const total = cartTotal();
    const subtotal = "subtotal" in total ? `\n\n🛒 *Carrinho* — ${cartCount()} ${cartCount() === 1 ? "item" : "itens"} · *${fmt(total.subtotal)}*` : "";
    s = { ...s, step: "idle", draft: undefined, checkoutId: undefined };
    say({
      type: "buttons",
      text: `✅ Adicionado:\n${lines.join("\n")}${subtotal}`,
      buttons: [{ id: "menu", title: "➕ Pedir mais" }, { id: "checkout", title: "✅ Finalizar" }, { id: "cart", title: "🛒 Ver carrinho" }],
    });
  }

  function finishDraft(qty: number) {
    const d = s.draft;
    const item = draftItem();
    if (!d || !item) return categoryList(0, "Vamos recomeçar: escolhe o produto.");
    const line: CartLine = {
      menuItemId: d.menuItemId, qty,
      ...(d.variantId ? { variantId: d.variantId } : {}),
      ...(d.addonIds.length ? { addonIds: d.addonIds } : {}),
      ...(d.modifiers.some((m) => m.optionIds.length) ? { modifiers: d.modifiers.filter((m) => m.optionIds.length) } : {}),
    };
    const added = addToCart(line);
    if (!added.ok) {
      s = { ...s, step: "idle", draft: undefined };
      say({ type: "buttons", text: `⚠️ ${added.error}`, buttons: [{ id: "menu", title: "🍔 Ver cardápio" }, { id: "cart", title: "🛒 Ver carrinho" }] });
      return;
    }
    afterAdd([added.summary]);
  }

  // ── Carrinho ────────────────────────────────────────────────────────────
  function showCart(prefix?: string) {
    if (!s.cart.length) {
      say({ type: "buttons", text: `${prefix ? `${prefix}\n\n` : ""}O carrinho está vazio.`, buttons: [{ id: "menu", title: "🍔 Ver cardápio" }] });
      return;
    }
    const total = cartTotal();
    if ("error" in total) {
      s = { ...s, cart: [] };
      say({ type: "buttons", text: `⚠️ ${total.error}\nEsvaziei o carrinho para recomeçares.`, buttons: [{ id: "menu", title: "🍔 Ver cardápio" }] });
      return;
    }
    sayLong(
      `${prefix ? `${prefix}\n\n` : ""}🛒 *O teu carrinho*\n${total.text}\n\nSubtotal: *${fmt(total.subtotal)}*\n_A taxa de entrega e as promoções entram no resumo final._`,
      [{ id: "checkout", title: "✅ Finalizar" }, { id: "menu", title: "➕ Pedir mais" }, { id: "rm", title: "🗑️ Remover item" }],
      "O que queres fazer?",
    );
  }

  function removeMenu() {
    const total = cartTotal();
    if (!s.cart.length || "error" in total) return showCart();
    const { lines } = priceItems(menu, s.cart);
    const rows: ListRow[] = lines.slice(0, 9).map((l, i) => ({ id: `rm:${i}`, title: `${l.qty}× ${l.name}`, description: fmt(l.lineTotalCents) }));
    rows.push({ id: "clear", title: "🧹 Esvaziar carrinho" });
    say({ type: "list", text: "Qual queres remover?", button: "Remover", sections: [{ rows }] });
  }

  function clearAll(note?: string) {
    s = { ...s, step: "idle", cart: [], draft: undefined, checkoutId: undefined, fulfillment: undefined, zoneId: undefined, address: undefined, paymentMethod: undefined };
    const pending = s.order ? `\n\nO pedido *${s.order.number}* continua registado. Para o cancelar, fala com a loja.` : "";
    say({ type: "buttons", text: `${note ?? "🧹 Carrinho esvaziado."}${pending}`, buttons: [{ id: "menu", title: "🍔 Ver cardápio" }, { id: "human", title: "💬 Falar com a loja" }] });
  }

  // ── Fechar o pedido ─────────────────────────────────────────────────────
  function siteLink(): string {
    const base = ctx.baseUrl.replace(/\/$/, "");
    const fulfillment = s.fulfillment ?? (channels(menu, store).includes("pickup") ? "pickup" : undefined);
    if (s.cart.length && fulfillment && (fulfillment === "pickup" || s.zoneId)) {
      try {
        return `${base}/pedido-assistido${encodeAgentHandoff({
          storeSlug: store.slug, fulfillmentType: fulfillment,
          ...(fulfillment === "delivery" ? { deliveryZoneId: s.zoneId } : {}),
          items: s.cart,
        })}`;
      } catch { /* carrinho grande demais para o link: cai no cardápio */ }
    }
    return `${base}/l/${store.slug}`;
  }

  function sendToSite(text: string) {
    say({ type: "cta_url", text, displayText: "Abrir no site", url: siteLink() });
  }

  function checkout() {
    if (!s.cart.length) return showCart();
    if (!menu.accepting_orders || !store.accepting_orders) {
      say({ type: "text", text: "😕 A loja não está a aceitar pedidos neste momento. Tenta daqui a pouco." });
      return;
    }
    const total = cartTotal();
    if ("error" in total) return showCart();
    const options = channels(menu, store);
    if (!options.length) return sendToSite("Este serviço não está disponível agora pelo WhatsApp. Podes concluir no site:");
    if (!s.fulfillment) {
      if (options.length === 1) s = { ...s, fulfillment: options[0] };
      else {
        s = { ...s, step: "fulfillment" };
        say({ type: "buttons", text: "Como queres receber?", buttons: [{ id: "ful:delivery", title: "🛵 Entrega" }, { id: "ful:pickup", title: "🏃 Levantar na loja" }] });
        return;
      }
    }
    if (s.fulfillment === "delivery") {
      if (s.zoneId && !menu.zones.some((z) => z.id === s.zoneId)) s = { ...s, zoneId: undefined, address: undefined };
      if (!s.zoneId) {
        const last = s.last;
        const lastZone = last?.zoneId ? menu.zones.find((z) => z.id === last.zoneId) : undefined;
        if (lastZone && last?.address && s.step !== "zone") {
          s = { ...s, step: "address" };
          say({
            type: "buttons", text: `Entregamos no mesmo sítio da última vez?\n📍 ${last.address}\n(${lastZone.name} · entrega ${fmt(lastZone.fee_cents)})`,
            buttons: [{ id: "addr:last", title: "✅ Sim, aí" }, { id: "addr:new", title: "📍 Outra morada" }],
          });
          return;
        }
        return zoneList(0);
      }
      if (!s.address) {
        s = { ...s, step: "address" };
        say({ type: "text", text: "📍 Escreve a *morada de entrega*: bairro, rua, número e um ponto de referência." });
        return;
      }
    }
    if (!s.name) {
      s = { ...s, step: "name" };
      const suggested = suggestedName();
      if (suggested) {
        say({ type: "buttons", text: `O pedido fica em nome de *${suggested}*?`, buttons: [{ id: "name:ok", title: "✅ Sim" }, { id: "name:new", title: "✏️ Outro nome" }] });
      } else {
        say({ type: "text", text: "👤 Em nome de quem fica o pedido? Escreve o teu nome." });
      }
      return;
    }
    if (!s.paymentMethod) {
      if (!methods.length) return sendToSite("O pagamento deste pedido faz-se no site. Abre o link para concluir:");
      if (methods.length === 1) s = { ...s, paymentMethod: methods[0].method };
      else {
        s = { ...s, step: "payment" };
        say({ type: "buttons", text: "💳 Como vais pagar?", buttons: methods.map((m) => ({ id: `pay:${m.method}`, title: m.label })) });
        return;
      }
    }
    summary();
  }

  /** O nome do último pedido; senão o do perfil WhatsApp, se tiver letras. */
  function suggestedName(): string | null {
    const candidate = (s.last?.name ?? input.profileName ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    return candidate.length >= 2 && /\p{L}/u.test(candidate) ? candidate : null;
  }

  function zoneList(page: number) {
    s = { ...s, step: "zone" };
    const rows: ListRow[] = menu.zones.slice(page * PAGE, page * PAGE + PAGE).map((z) => ({ id: `zone:${z.id}`, title: z.name, description: `Entrega ${fmt(z.fee_cents)}` }));
    if ((page + 1) * PAGE < menu.zones.length) rows.push({ id: `zonep:${page + 1}`, title: "➡️ Mais zonas" });
    rows.push({ id: "ful:pickup", title: "🏃 Prefiro levantar" });
    say({ type: "list", text: "Em que zona é a entrega? 👇", button: "Ver zonas", sections: [{ rows }] });
  }

  function methodInfo(method: string): ManualMethod | undefined {
    return methods.find((m) => m.method === method);
  }

  function summary() {
    const total = cartTotal();
    if ("error" in total) return showCart();
    const zone = s.fulfillment === "delivery" ? menu.zones.find((z) => z.id === s.zoneId) : undefined;
    const fee = zone?.fee_cents ?? 0;
    const checkoutId = deps.newId();
    s = { ...s, step: "confirm", checkoutId };
    const where = s.fulfillment === "delivery" ? `🛵 Entrega em ${zone?.name ?? ""}: ${s.address}` : `🏃 Levantar na loja (${store.name})`;
    const closed = !store.open_now ? `\n\n🕒 Estamos fechados agora. ${nextOpeningText(menu.hours, input.now) ?? ""} Para agendar, usa o site.`.trimEnd() : "";
    sayLong(
      [
        "🧾 *Resumo do pedido*",
        total.text,
        "",
        `Subtotal: ${fmt(total.subtotal)}`,
        ...(zone ? [`Entrega: ${fmt(fee)}`] : []),
        `*Total: ${fmt(total.subtotal + fee)}*`,
        "",
        where,
        `👤 ${s.name}`,
        `💳 ${methodInfo(s.paymentMethod ?? "")?.label ?? ""}`,
        "",
        "_Promoções da loja aplicam-se ao confirmar._",
      ].join("\n") + closed,
      [{ id: `ok:${checkoutId}`, title: "✅ Confirmar" }, { id: "edit", title: "✏️ Alterar" }, { id: "clear", title: "❌ Cancelar" }],
      `Confirmas o pedido de *${fmt(total.subtotal + fee)}*?`,
    );
  }

  function paymentInstructions(order: { number: string; totalCents: number; method: string; id: string }, estimate?: number) {
    const m = methodInfo(order.method) ?? methods[0];
    const promo = estimate !== undefined && order.totalCents < estimate ? " _(já com a promoção)_" : "";
    const pay = m
      ? `Paga por *${m.label}* para:\n📱 *${m.number}*${m.holder ? `\n👤 ${m.holder}` : ""}`
      : "Paga para o número da loja indicado no pedido.";
    say({
      type: "cta_url",
      text: `💰 Total a pagar: *${fmt(order.totalCents)}*${promo}\n\n${pay}\n\nDepois manda aqui a *foto ou print do comprovativo* 📸. A loja confere e avisamos-te por aqui.`,
      header: `Pedido ${order.number}`,
      displayText: "Ver o pedido",
      url: `${ctx.baseUrl.replace(/\/$/, "")}/order-status/${order.id}`,
    });
  }

  async function confirm(checkoutId: string) {
    if (s.step !== "confirm" || !s.checkoutId) {
      // "Confirmar" de um resumo antigo, depois de o pedido já ter sido criado.
      if (s.order && s.step === "proof") return paymentInstructions(s.order);
      return checkout();
    }
    if (checkoutId !== s.checkoutId) return summary();
    if (!store.open_now) return sendToSite(`🕒 Estamos fechados agora. ${nextOpeningText(menu.hours, input.now) ?? ""}\nPodes agendar o pedido no site:`);
    const total = cartTotal();
    if ("error" in total) return showCart(`⚠️ ${total.error}`);
    const zone = s.fulfillment === "delivery" ? menu.zones.find((z) => z.id === s.zoneId) : undefined;
    const estimate = total.subtotal + (zone?.fee_cents ?? 0);
    const result = await deps.createOrder(checkoutId, {
      customerName: s.name,
      fulfillmentType: s.fulfillment,
      deliveryZoneId: s.fulfillment === "delivery" ? s.zoneId : null,
      address: s.fulfillment === "delivery" ? s.address : null,
      scheduledFor: null,
      paymentMethod: s.paymentMethod,
      notes: "Pedido pelo WhatsApp",
      items: s.cart.map((line) => ({ ...line, notes: "" })),
    });
    if (!result.ok) return orderFailed(result.code);
    const order = { id: result.orderId, number: result.orderNumber, totalCents: result.totalCents, method: result.method, at: input.now };
    s = {
      ...s, step: "proof", order, cart: [], draft: undefined, checkoutId: undefined,
      last: { zoneId: s.zoneId, address: s.address, name: s.name },
      fulfillment: undefined, zoneId: undefined, address: undefined, paymentMethod: undefined,
    };
    say({ type: "text", text: `✅ *Pedido ${order.number} registado!*` });
    paymentInstructions(order, estimate);
  }

  function orderFailed(code: string) {
    s = { ...s, checkoutId: undefined };
    if (/^(out_of_stock|item_unavailable|invalid_variant|invalid_addon|invalid_modifier)/.test(code)) {
      return showCart("⚠️ Um produto do carrinho esgotou ou mudou entretanto. Revê o carrinho:");
    }
    if (code === "store_closed") return sendToSite(`🕒 A loja acabou de fechar. ${nextOpeningText(menu.hours, input.now) ?? ""}\nPodes agendar no site:`);
    if (code === "store_not_accepting_orders") { s = { ...s, step: "idle" }; return say({ type: "text", text: "😕 A loja deixou de aceitar pedidos agora. Tenta daqui a pouco." }); }
    if (/^delivery_zone/.test(code)) { s = { ...s, zoneId: undefined, address: undefined }; return checkout(); }
    if (code === "payment_not_manual") return sendToSite("O pagamento deste pedido faz-se no site. Abre o link para concluir:");
    s = { ...s, step: "confirm" };
    return summary();
  }

  // ── Comprovativo ────────────────────────────────────────────────────────
  async function handleMedia(media: InboundMedia) {
    const pending = await deps.pendingOrder();
    if (!pending) {
      const gone = s.order && s.step === "proof" ? `O pedido *${s.order.number}* já não está à espera de comprovativo.` : "Recebi o ficheiro, mas não encontrei nenhum pedido teu à espera de pagamento.";
      s = { ...s, step: s.step === "proof" ? "idle" : s.step };
      say({ type: "buttons", text: `${gone}\nPara fazer um pedido, toca em *Ver cardápio*.`, buttons: [{ id: "menu", title: "🍔 Ver cardápio" }, { id: "human", title: "💬 Falar com a loja" }] });
      return;
    }
    const result = await deps.attachProof(pending.orderId, media);
    // Só sai do "à espera de comprovativo"; um pedido novo a meio continua onde estava.
    const after = s.step === "proof" ? "idle" : s.step;
    if (result === "ok") {
      s = { ...s, step: after };
      say({ type: "text", text: `📩 Comprovativo recebido para o pedido *${pending.orderNumber}*. A loja vai conferir e avisamos-te aqui assim que estiver confirmado. Obrigado! 🙏` });
    } else if (result === "already") {
      s = { ...s, step: after };
      say({ type: "text", text: `Já tínhamos o comprovativo do pedido *${pending.orderNumber}*. A loja está a conferir 👍` });
    } else if (result === "invalid_type") {
      say({ type: "text", text: "Manda o comprovativo como *foto* (print do ecrã) ou *PDF*, por favor." });
    } else {
      say({ type: "text", text: "Não consegui guardar o comprovativo agora. Manda outra vez daqui a um minuto, por favor." });
    }
  }

  function remindProof() {
    if (!s.order) return welcome();
    say({ type: "text", text: `Estamos à espera do comprovativo do pedido *${s.order.number}* 📸` });
    paymentInstructions(s.order);
  }

  function human() {
    const phone = (ctx.handoffPhone ?? "").replace(/\D/g, "");
    if (phone.length >= 9) {
      say({ type: "cta_url", text: "Para falar com uma pessoa da loja, toca no botão. Respondemos o mais rápido possível 🙂", displayText: "Falar com a loja", url: `https://wa.me/${phone}` });
    } else if (store.phone) {
      say({ type: "text", text: `Para falar com uma pessoa da loja, liga para *${store.phone}* 📞` });
    } else {
      say({ type: "text", text: "Neste número só fazemos pedidos. Para outras questões, visita a loja ou o nosso site 🙂" });
    }
  }

  function orderStatus() {
    if (!s.order) return say({ type: "buttons", text: "Não encontrei nenhum pedido recente feito por aqui.", buttons: [{ id: "menu", title: "🍔 Ver cardápio" }] });
    say({ type: "cta_url", text: `O estado do pedido *${s.order.number}* está sempre actualizado aqui 👇`, displayText: "Ver o pedido", url: `${ctx.baseUrl.replace(/\/$/, "")}/order-status/${s.order.id}` });
  }

  // ── IA para texto livre ─────────────────────────────────────────────────
  async function interpretFreeText(text: string): Promise<boolean> {
    if (!ctx.aiEnabled || !deps.interpret) return false;
    const windowStart = s.ai && input.now - s.ai.windowStart < 3_600_000 ? s.ai.windowStart : input.now;
    const count = windowStart === s.ai?.windowStart ? s.ai.count : 0;
    if (count >= AI_CALLS_PER_HOUR) return false;
    s = { ...s, ai: { windowStart, count: count + 1 } };
    let intent: AiIntent | null = null;
    try { intent = await deps.interpret({ text, state: s, ctx }); } catch { intent = null; }
    if (!intent) return false;
    const reply = intent.reply?.trim().slice(0, 700);
    switch (intent.action) {
      case "add_items": {
        const added: string[] = [];
        let pendingConfig: AiItem | null = null;
        for (const item of (intent.items ?? []).slice(0, 10)) {
          const found = findItem(menu, item.menuItemId);
          if (!found) continue;
          const qty = Math.min(Math.max(Math.trunc(item.qty || 1), 1), MAX_QTY);
          const line: CartLine = {
            menuItemId: item.menuItemId, qty,
            ...(item.variantId ? { variantId: item.variantId } : {}),
            ...(item.addonIds?.length ? { addonIds: item.addonIds } : {}),
            ...(item.modifiers?.length ? { modifiers: item.modifiers } : {}),
          };
          const result = addToCart(line);
          if (result.ok) added.push(result.summary);
          else if (!pendingConfig) pendingConfig = { ...item, qty };
        }
        if (reply) say({ type: "text", text: reply });
        if (pendingConfig) {
          // Faltou uma escolha (tamanho, molho…): segue pelos botões para esse produto.
          if (added.length) say({ type: "text", text: `✅ Adicionado:\n${added.join("\n")}` });
          const found = findItem(menu, pendingConfig.menuItemId)!;
          const variants = activeVariants(found.item);
          startItem(pendingConfig.menuItemId, {
            ...(pendingConfig.variantId && variants.some((v) => v.id === pendingConfig!.variantId) ? { variantId: pendingConfig.variantId } : {}),
          });
          return true;
        }
        if (added.length) afterAdd(added);
        else categoryList(0, reply ? undefined : "Não encontrei isso no cardápio. Escolhe aqui 👇");
        return true;
      }
      case "show_category":
        if (reply) say({ type: "text", text: reply });
        if (intent.categoryId) itemList(intent.categoryId, 0); else categoryList(0);
        return true;
      case "show_menu": if (reply) say({ type: "text", text: reply }); categoryList(0); return true;
      case "show_cart": if (reply) say({ type: "text", text: reply }); showCart(); return true;
      case "checkout": if (reply) say({ type: "text", text: reply }); checkout(); return true;
      case "human": if (reply) say({ type: "text", text: reply }); human(); return true;
      case "order_status": if (reply) say({ type: "text", text: reply }); orderStatus(); return true;
      default:
        if (!reply) return false;
        say({ type: "buttons", text: reply, buttons: [{ id: "menu", title: "🍔 Ver cardápio" }, ...(s.cart.length ? [{ id: "cart", title: `🛒 Carrinho (${cartCount()})` }] : [])] });
        return true;
    }
  }

  // ── Botões e listas ─────────────────────────────────────────────────────
  async function handleReply(id: string) {
    const [kind, a, b] = id.split(":");
    switch (kind) {
      case "menu": return categoryList(0);
      case "catp": return categoryList(Number(a) || 0);
      case "cat": return itemList(a, 0);
      case "items": return itemList(a, Number(b) || 0);
      case "item": return startItem(a);
      case "cart": return showCart();
      case "rm": {
        if (a === undefined) return removeMenu();
        const index = Number(a);
        if (Number.isInteger(index) && index >= 0 && index < s.cart.length) {
          s = { ...s, cart: s.cart.filter((_, i) => i !== index), checkoutId: undefined, step: "idle" };
        }
        return showCart("🗑️ Removido.");
      }
      case "clear": return clearAll();
      case "checkout": return checkout();
      case "edit":
        s = { ...s, step: "idle", checkoutId: undefined, fulfillment: undefined, zoneId: undefined, address: undefined, paymentMethod: undefined };
        return showCart("Sem problema — altera o que quiseres:");
      case "human": return human();
      case "status": return orderStatus();
      case "ok": return confirm(a ?? "");
      case "ful":
        if (a === "delivery" || a === "pickup") s = { ...s, fulfillment: a, zoneId: a === "pickup" ? undefined : s.zoneId, address: a === "pickup" ? undefined : s.address };
        return checkout();
      case "zone":
        if (menu.zones.some((z) => z.id === a)) s = { ...s, fulfillment: "delivery", zoneId: a, address: undefined };
        return checkout();
      case "zonep": return zoneList(Number(a) || 0);
      case "addr":
        if (a === "last" && s.last?.zoneId && s.last.address) s = { ...s, fulfillment: "delivery", zoneId: s.last.zoneId, address: s.last.address };
        else { s = { ...s, zoneId: undefined, address: undefined }; return zoneList(0); }
        return checkout();
      case "name": {
        const suggested = suggestedName();
        if (a === "ok" && suggested) { s = { ...s, name: suggested }; return checkout(); }
        s = { ...s, step: "name" };
        return say({ type: "text", text: "👤 Escreve o nome para o pedido." });
      }
      case "pay":
        if (methods.some((m) => m.method === a)) s = { ...s, paymentMethod: a as "mpesa" | "emola" };
        return checkout();
      case "fb":
        if (a !== "up") s = { ...s, step: "feedback" };
        return say({ type: "text", text: a === "up" ? "Obrigado! 🙏 Até à próxima." : "Lamentamos 😔 Conta-nos aqui o que correu mal — a loja vai ler." });
      case "contact":
        // Quem tinha o número escondido e acabou de o partilhar: agora é uma conversa normal.
        return welcome("Obrigado! 🙏");
      // Configuração do produto em curso
      case "var": case "opt": case "grp": case "add": case "addok": case "pg": case "qty":
        return handleDraftReply(kind, a, b);
      default:
        return welcome();
    }
  }

  function handleDraftReply(kind: string, a?: string, b?: string) {
    const item = draftItem();
    if (!item || !s.draft) return categoryList(0, "Esse passo já não está activo. Escolhe de novo 👇");
    const d = s.draft;
    if (kind === "qty") {
      const qty = Number(a);
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return askNext(item);
      return finishDraft(qty);
    }
    if (kind === "pg") { s = { ...s, draft: { ...d, page: d.page + 1 } }; return askNext(item); }
    if (kind === "var") {
      if (activeVariants(item).some((v) => v.id === a)) s = { ...s, draft: { ...d, variantId: a, page: 0 } };
      return askNext(item);
    }
    if (kind === "opt" || kind === "grp") {
      const group = activeGroups(item).find((g) => g.id === a);
      if (!group) return askNext(item);
      const chosen = d.modifiers.find((m) => m.groupId === group.id)?.optionIds ?? [];
      const others = d.modifiers.filter((m) => m.groupId !== group.id);
      if (kind === "grp") {
        if (chosen.length < group.min_select) return askNext(item);
        s = { ...s, draft: { ...d, doneGroups: [...d.doneGroups, group.id], page: 0 } };
        return askNext(item);
      }
      if (!activeOptions(group).some((o) => o.id === b)) return askNext(item);
      const single = group.selection_type === "single" || group.max_select <= 1;
      let next = single ? [b!] : chosen.includes(b!) ? chosen.filter((x) => x !== b) : [...chosen, b!];
      if (next.length > group.max_select) next = next.slice(next.length - group.max_select);
      const done = single || next.length >= group.max_select;
      s = { ...s, draft: { ...d, modifiers: [...others, { groupId: group.id, optionIds: next }], doneGroups: done ? [...d.doneGroups, group.id] : d.doneGroups, page: done ? 0 : d.page } };
      return askNext(item);
    }
    if (kind === "add") {
      if (activeAddons(item).some((x) => x.id === a)) {
        const ids = d.addonIds.includes(a!) ? d.addonIds.filter((x) => x !== a) : [...d.addonIds, a!];
        s = { ...s, draft: { ...d, addonIds: ids } };
      }
      return askNext(item);
    }
    if (kind === "addok") { s = { ...s, draft: { ...d, addonsDone: true, page: 0 } }; return askNext(item); }
  }

  // ── Texto escrito ───────────────────────────────────────────────────────
  async function handleText(text: string) {
    const word = normalizeWord(text);
    const command = COMMANDS[word];
    if (command) return handleReply(command);
    // A queixa fica em whatsapp_inbound e o dono lê-a no painel. Não vai à IA nem recebe o menu por resposta.
    if (s.step === "feedback") {
      s = { ...s, step: "idle" };
      return say({ type: "text", text: "Obrigado por nos contares. A loja vai ler a tua mensagem 🙏" });
    }

    if (s.step === "qty" && /^\d{1,3}$/.test(word)) return handleDraftReply("qty", word);
    if (s.step === "address" && !s.zoneId) {
      say({ type: "text", text: "Primeiro escolhe a zona da entrega 👇" });
      return zoneList(0);
    }
    if (s.step === "proof" && s.order && /^(JA )?(PAGUEI|PAGO|TRANSFERI|ENVIEI|MANDEI)\b|^CONFIRMADO\b/.test(word)) {
      say({ type: "text", text: "Obrigado! Para a loja conferir, manda aqui a *foto ou print* do comprovativo 📸" });
      return;
    }
    if (s.step === "address" && s.zoneId) {
      const address = text.replace(/\s+/g, " ").trim();
      if (address.length < 6 || address.length > 300) return say({ type: "text", text: "Escreve a morada completa (bairro, rua, número, referência), por favor." });
      s = { ...s, address };
      return checkout();
    }
    if (s.step === "name") {
      const name = text.replace(/\s+/g, " ").trim();
      if (name.length < 2 || name.length > 60 || !/\p{L}/u.test(name)) return say({ type: "text", text: "Escreve só o nome, por favor (ex.: Ana Silva)." });
      s = { ...s, name };
      return checkout();
    }
    if (s.step === "confirm" && /^(SIM|S|CONFIRMAR|CONFIRMO|OK|PODE|PODE SER)$/.test(word) && s.checkoutId) return confirm(s.checkoutId);
    if (GREETINGS.test(word) && word.split(" ").length <= 4) {
      if (s.step === "proof" && s.order) return remindProof();
      return welcome();
    }
    if (await interpretFreeText(text)) return;
    if (s.step === "proof" && s.order) return remindProof();
    welcome("Não percebi bem 🙂 Usa os botões para escolher:");
  }

  // ── Encaminhar a mensagem ───────────────────────────────────────────────
  if (input.contentType === "reaction") return { state: { ...s, touchedAt: input.now }, replies: [] };
  if (input.optOut) {
    say({ type: "text", text: "Pronto ✅ Não te enviamos mais avisos. Para fazer um pedido, escreve *menu* a qualquer momento." });
  } else if (input.media && (input.contentType === "image" || input.contentType === "document")) {
    await handleMedia(input.media);
  } else if (input.replyId) {
    await handleReply(input.replyId);
  } else if (input.text?.trim()) {
    await handleText(input.text);
  } else {
    say({ type: "buttons", text: "Por aqui só consigo ler texto, botões e fotos do comprovativo 🙂", buttons: [{ id: "menu", title: "🍔 Ver cardápio" }, { id: "human", title: "💬 Falar com a loja" }] });
  }
  if (!out.length) welcome();
  return { state: { ...s, touchedAt: input.now }, replies: compactSession(out) };
}
