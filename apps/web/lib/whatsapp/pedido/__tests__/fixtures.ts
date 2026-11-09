import type { Catalogue, PublicStore } from "@/lib/agents/service";
import type { TurnContext, TurnInput } from "../engine";

export const ID = {
  catBurger: "10000000-0000-4000-8000-000000000001",
  catDrink: "10000000-0000-4000-8000-000000000002",
  smash: "20000000-0000-4000-8000-000000000001",
  soda: "20000000-0000-4000-8000-000000000002",
  soldOut: "20000000-0000-4000-8000-000000000003",
  normal: "30000000-0000-4000-8000-000000000001",
  grande: "30000000-0000-4000-8000-000000000002",
  ponto: "40000000-0000-4000-8000-000000000001",
  bemPassado: "50000000-0000-4000-8000-000000000001",
  malPassado: "50000000-0000-4000-8000-000000000002",
  bacon: "60000000-0000-4000-8000-000000000001",
  zone: "70000000-0000-4000-8000-000000000001",
  order: "80000000-0000-4000-8000-000000000001",
  inbound: "90000000-0000-4000-8000-000000000001",
};

const hours = [0, 1, 2, 3, 4, 5, 6].map((dow) => ({ dow, opens: "11:00:00", closes: "23:00:00", active: true }));

export function catalogue(over: { open?: boolean; emola?: boolean; provider?: string } = {}): { menu: Catalogue; store: PublicStore } {
  const store: PublicStore = {
    slug: "loja-teste", name: "PLACEHOLDER Loja", short_name: "Loja", address: null, phone: "+258 84 000 0001", maps_url: null,
    accepting_orders: true, delivery_enabled: true, pickup_enabled: true, open_now: over.open ?? true, hours,
  };
  const menu = {
    store: { id: "00000000-0000-4000-8000-000000000001", slug: "loja-teste", name: "PLACEHOLDER Loja", delivery_enabled: true, pickup_enabled: true },
    accepting_orders: true,
    categories: [
      {
        id: ID.catBurger, name: "Hambúrgueres", items: [
          {
            id: ID.smash, name: "Smash", description: "Carne smash", price_cents: 40000, available: true,
            variants: [
              { id: ID.normal, name: "Normal", price_cents: 40000, is_default: true },
              { id: ID.grande, name: "Grande", price_cents: 50000 },
            ],
            addons: [{ id: ID.bacon, name: "Bacon", price_cents: 5000 }],
            modifier_groups: [{
              id: ID.ponto, name: "Ponto", selection_type: "single", min_select: 1, max_select: 1, free_quantity: 0, extra_price_cents: 0,
              options: [{ id: ID.bemPassado, name: "Bem passado", price_cents: 0 }, { id: ID.malPassado, name: "Mal passado", price_cents: 1000 }],
            }],
          },
          { id: ID.soldOut, name: "Esgotado", price_cents: 1000, available: false, variants: [], addons: [], modifier_groups: [] },
        ],
      },
      { id: ID.catDrink, name: "Bebidas", items: [{ id: ID.soda, name: "Refresco", price_cents: 8000, available: true, variants: [], addons: [], modifier_groups: [] }] },
    ],
    zones: [{ id: ID.zone, name: "Centro", fee_cents: 10000 }],
    hours,
    payment_provider: over.provider ?? "manual",
    emola_provider: null,
    mpesa_number: "84 000 0000",
    mpesa_name: "PLACEHOLDER Titular",
    emola_number: over.emola ? "86 000 0000" : null,
    emola_name: null,
  } as Catalogue;
  return { menu, store };
}

export function context(over: Parameters<typeof catalogue>[0] & { ai?: boolean } = {}): TurnContext {
  return { ...catalogue(over), baseUrl: "https://loja.test", handoffPhone: "+258860000000", aiEnabled: over.ai ?? false };
}

let clock = Date.UTC(2026, 10, 5, 12, 0, 0);
export function input(over: Partial<TurnInput>): TurnInput {
  clock += 1000;
  return {
    inboundId: ID.inbound, now: clock, text: null, replyId: null, media: null, contentType: "text",
    profileName: "Ana Maria", optOut: false, ...over,
  };
}
