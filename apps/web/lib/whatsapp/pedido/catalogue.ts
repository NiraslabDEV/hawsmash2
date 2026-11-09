import { cents, formatMT, getPaymentMode } from "@delivery/core";
import { usableItem, type Catalogue, type CatalogueItem, type PublicStore } from "@/lib/agents/service";

/** Leitura do catálogo para a conversa: o mesmo `get_menu` público do site, nada mais. */

export type Category = Catalogue["categories"][number];
export const fmt = (value: number) => formatMT(cents(value));

export function usableCategories(menu: Catalogue): Array<Category & { usable: CatalogueItem[] }> {
  return menu.categories
    .map((category) => ({ ...category, usable: category.items.filter(usableItem) }))
    .filter((category) => category.usable.length > 0);
}

export function findItem(menu: Catalogue, id: string): { item: CatalogueItem; category: Category } | null {
  for (const category of menu.categories) {
    const item = category.items.find((entry) => entry.id === id);
    if (item) return { item, category };
  }
  return null;
}

export const activeVariants = (item: CatalogueItem) => item.variants.filter((v) => v.active !== false);
export const activeAddons = (item: CatalogueItem) => item.addons.filter((a) => a.active !== false);
/** Grupos onde há alguma coisa para escolher (máximo 0 = grupo sem escolhas possíveis). */
export const activeGroups = (item: CatalogueItem) =>
  item.modifier_groups.filter((g) => g.active !== false && g.max_select > 0 && g.options.some((o) => o.active !== false));
export const activeOptions = (group: CatalogueItem["modifier_groups"][number]) => group.options.filter((o) => o.active !== false);

export function priceLabel(item: CatalogueItem): string {
  const variants = activeVariants(item);
  if (!variants.length) return fmt(item.price_cents);
  const min = Math.min(...variants.map((v) => v.price_cents));
  return variants.length > 1 ? `desde ${fmt(min)}` : fmt(min);
}

export type ManualMethod = { method: "mpesa" | "emola"; label: string; number: string; holder: string | null };

/** Meios que a conversa aceita: pagamento manual (comprovativo) com número configurado na loja. */
export function manualMethods(menu: Catalogue): ManualMethod[] {
  const out: ManualMethod[] = [];
  const candidates = [
    { method: "mpesa" as const, label: "M-Pesa", number: menu.mpesa_number, holder: menu.mpesa_name },
    { method: "emola" as const, label: "e-Mola", number: menu.emola_number, holder: menu.emola_name },
  ];
  for (const c of candidates) {
    const number = c.number?.trim();
    if (!number) continue;
    if (getPaymentMode(menu.payment_provider ?? "manual", menu.emola_provider ?? null, c.method) !== "manual") continue;
    out.push({ method: c.method, label: c.label, number, holder: c.holder?.trim() || null });
  }
  return out;
}

export function channels(menu: Catalogue, store: PublicStore): Array<"delivery" | "pickup"> {
  const out: Array<"delivery" | "pickup"> = [];
  if (menu.store.delivery_enabled && store.delivery_enabled && menu.zones.length) out.push("delivery");
  if (menu.store.pickup_enabled && store.pickup_enabled) out.push("pickup");
  return out;
}

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "Abrimos hoje às 11:00" / "Abrimos sexta às 11:00" — no fuso de Maputo, a partir do horário público. */
export function nextOpeningText(hours: Catalogue["hours"], now: number): string | null {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Maputo", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(now));
  const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dow = dowNames.indexOf(parts.find((p) => p.type === "weekday")?.value ?? "");
  const hhmm = `${parts.find((p) => p.type === "hour")?.value ?? "00"}:${parts.find((p) => p.type === "minute")?.value ?? "00"}`;
  if (dow < 0) return null;
  for (let offset = 0; offset < 7; offset++) {
    const day = (dow + offset) % 7;
    const slot = hours.find((h) => h.dow === day && h.active);
    if (!slot) continue;
    const opens = slot.opens.slice(0, 5);
    if (offset === 0 && opens <= hhmm) continue;
    return offset === 0 ? `Abrimos hoje às ${opens}.` : offset === 1 ? `Abrimos amanhã às ${opens}.` : `Abrimos ${WEEKDAYS[day]} às ${opens}.`;
  }
  return null;
}
