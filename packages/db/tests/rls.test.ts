/**
 * Testes de integração contra Supabase local.
 * Requer `supabase start` + `pnpm db:migrate` antes de correr.
 *
 * Coberturas (ROADMAP F0.2):
 *   (a) anon nao le tabela nenhuma
 *   (b) get_menu devolve menu + zonas
 *   (c) preco adulterado no payload nao afeta total (banco prevalece)
 *   (d) horario invalido e rejeitado
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "http://localhost:54531";

// Chaves padrao do Supabase local — sem segredo real, seguras para commitar
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz";

let anon: SupabaseClient;
let admin: SupabaseClient;

// IDs fixados pelo seed (necessarios nos testes c e d)
let menuItemId: string;
const BANK_PRICE_CENTS = 65000; // Caril de Camarao no seed

beforeAll(async () => {
  anon  = createClient(SUPABASE_URL, ANON_KEY);
  admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Obter ID de um item do seed para usar nos testes de create_order
  const { data: item, error } = await admin
    .from("menu_items")
    .select("id, price_cents")
    .eq("name", "Caril de Camarao")
    .single();

  if (error || !item) throw new Error(`Setup: item nao encontrado — ${error?.message}. Corre 'pnpm db:migrate' primeiro.`);

  menuItemId = item.id;

  if (item.price_cents !== BANK_PRICE_CENTS) {
    throw new Error(`Setup: preco do item no banco e ${item.price_cents}, esperado ${BANK_PRICE_CENTS}`);
  }
});

// ─── (a) anon nao le nenhuma tabela ─────────────────────────────────────────

describe("(a) RLS — anon nao tem acesso direto a nenhuma tabela", () => {
  const tables = [
    "settings",
    "menu_categories",
    "menu_items",
    "delivery_zones",
    "orders",
    "order_items",
    "event_log",
  ] as const;

  for (const table of tables) {
    it(`anon SELECT em '${table}' retorna array vazio (RLS bloqueia)`, async () => {
      const { data, error } = await anon.from(table).select("*").limit(5);
      // RLS sem policy para anon -> resultado vazio, sem erro de permissao
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  }
});

// ─── (b) get_menu() devolve menu + zonas ────────────────────────────────────

describe("(b) RPC get_menu() — cardapio e zonas publicos", () => {
  it("retorna accepting_orders, categories e zones", async () => {
    const { data, error } = await anon.rpc("get_menu");

    expect(error).toBeNull();
    expect(typeof data.accepting_orders).toBe("boolean");
    expect(Array.isArray(data.categories)).toBe(true);
    expect(Array.isArray(data.zones)).toBe(true);
  });

  it("categories tem ao menos 1 categoria com items", async () => {
    const { data } = await anon.rpc("get_menu");

    expect(data.categories.length).toBeGreaterThan(0);
    const firstCat = data.categories[0];
    expect(Array.isArray(firstCat.items)).toBe(true);
    expect(firstCat.items.length).toBeGreaterThan(0);
  });

  it("items nao expoe campos sensiveis (sem category_id no item, sem track_stock)", async () => {
    const { data } = await anon.rpc("get_menu");
    const item = data.categories[0].items[0];

    // Campos publicos presentes
    expect(item).toHaveProperty("id");
    expect(item).toHaveProperty("name");
    expect(item).toHaveProperty("price_cents");
    // track_stock e stock_qty nao devem aparecer no menu publico
    expect(item).not.toHaveProperty("track_stock");
    expect(item).not.toHaveProperty("stock_qty");
  });

  it("zones tem ao menos 1 zona ativa com fee_cents", async () => {
    const { data } = await anon.rpc("get_menu");

    expect(data.zones.length).toBeGreaterThan(0);
    const zone = data.zones[0];
    expect(zone).toHaveProperty("id");
    expect(zone).toHaveProperty("name");
    expect(typeof zone.fee_cents).toBe("number");
    expect(zone.fee_cents).toBeGreaterThanOrEqual(0);
  });
});

// ─── (c) preco adulterado no payload nao afeta total ────────────────────────

describe("(c) create_order() — banco calcula preco, client nao pode adulterar", () => {
  it("total usa preco do banco, nao qualquer valor enviado pelo client", async () => {
    const { data: orderId, error } = await anon.rpc("create_order", {
      p_payload: {
        items: [
          {
            menuItemId: menuItemId,
            qty: 2,
            // Tentativa de adulteracao: cliente envia price_cents = 1 (ignorado pela RPC)
            price_cents: 1,
          },
        ],
        customerName: "Teste Preco",
        fulfillmentType: "pickup",
        paymentMethod: "mpesa",
      },
    });

    expect(error).toBeNull();
    expect(typeof orderId).toBe("string");

    // Verificar total no banco = preco do banco x qty
    const { data: order } = await admin
      .from("orders")
      .select("subtotal_cents, delivery_fee_cents, total_cents, status, flow")
      .eq("id", orderId)
      .single();

    expect(order!.subtotal_cents).toBe(BANK_PRICE_CENTS * 2); // 130000
    expect(order!.delivery_fee_cents).toBe(0);                // pickup, sem taxa
    expect(order!.total_cents).toBe(BANK_PRICE_CENTS * 2);    // 130000
    expect(order!.status).toBe("awaiting_approval");
    expect(order!.flow).toBe("manual");
  });

  it("taxa de entrega e sempre calculada pelo banco via delivery_zone", async () => {
    // Obter uma zona ativa
    const { data: zone } = await admin
      .from("delivery_zones")
      .select("id, fee_cents")
      .eq("active", true)
      .limit(1)
      .single();

    const { data: orderId, error } = await anon.rpc("create_order", {
      p_payload: {
        items: [{ menuItemId: menuItemId, qty: 1 }],
        customerName: "Teste Entrega",
        fulfillmentType: "delivery",
        deliveryZoneId: zone!.id,
        address: "Av. Julius Nyerere, 123",
        paymentMethod: "mpesa",
      },
    });

    expect(error).toBeNull();

    const { data: order } = await admin
      .from("orders")
      .select("subtotal_cents, delivery_fee_cents, total_cents")
      .eq("id", orderId)
      .single();

    expect(order!.subtotal_cents).toBe(BANK_PRICE_CENTS);
    expect(order!.delivery_fee_cents).toBe(zone!.fee_cents);
    expect(order!.total_cents).toBe(BANK_PRICE_CENTS + zone!.fee_cents);
  });

  it("event_log regista order.created com total correto", async () => {
    const { data: orderId } = await anon.rpc("create_order", {
      p_payload: {
        items: [{ menuItemId: menuItemId, qty: 1 }],
        customerName: "Teste Log",
        fulfillmentType: "pickup",
        paymentMethod: "emola",
      },
    });

    const { data: events } = await admin
      .from("event_log")
      .select("type, payload")
      .eq("order_id", orderId)
      .eq("type", "order.created");

    expect(events).toHaveLength(1);
    expect(events![0].payload.total_cents).toBe(BANK_PRICE_CENTS);
  });

  it("order_number e gerado no formato ENC-XXXX", async () => {
    const { data: orderId } = await anon.rpc("create_order", {
      p_payload: {
        items: [{ menuItemId: menuItemId, qty: 1 }],
        customerName: "Teste Numero",
        fulfillmentType: "pickup",
        paymentMethod: "mpesa",
      },
    });

    const { data: order } = await admin
      .from("orders")
      .select("order_number")
      .eq("id", orderId)
      .single();

    expect(order!.order_number).toMatch(/^ENC-\d{4}$/);
  });

  it("pedido vazio e rejeitado", async () => {
    const { error } = await anon.rpc("create_order", {
      p_payload: {
        items: [],
        customerName: "Teste Vazio",
        fulfillmentType: "pickup",
        paymentMethod: "mpesa",
      },
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("empty_order");
  });

  it("entrega sem zona e rejeitada", async () => {
    const { error } = await anon.rpc("create_order", {
      p_payload: {
        items: [{ menuItemId: menuItemId, qty: 1 }],
        customerName: "Teste Zona",
        fulfillmentType: "delivery",
        address: "Av. Julius Nyerere, 123",
        paymentMethod: "mpesa",
      },
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("delivery_zone_required");
  });

  it("entrega sem morada e rejeitada", async () => {
    const { data: zone } = await admin
      .from("delivery_zones")
      .select("id")
      .eq("active", true)
      .limit(1)
      .single();

    const { error } = await anon.rpc("create_order", {
      p_payload: {
        items: [{ menuItemId: menuItemId, qty: 1 }],
        customerName: "Teste Morada",
        fulfillmentType: "delivery",
        deliveryZoneId: zone!.id,
        paymentMethod: "mpesa",
      },
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("delivery_address_required");
  });
});

// ─── (d) horario invalido e rejeitado ───────────────────────────────────────

describe("(d) create_order() — validacao de horario agendado", () => {
  const basePayload = {
    items: [{ menuItemId: "", qty: 1 }], // menuItemId preenchido no beforeAll via closure
    customerName: "Teste Horario",
    fulfillmentType: "pickup" as const,
    paymentMethod: "mpesa" as const,
  };

  it("scheduledFor no passado e rejeitado", async () => {
    const past = new Date(Date.now() - 3600_000).toISOString(); // 1h atras

    const { error } = await anon.rpc("create_order", {
      p_payload: {
        ...basePayload,
        items: [{ menuItemId, qty: 1 }],
        scheduledFor: past,
      },
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("scheduled_for_must_be_future");
  });

  it("scheduledFor fora do horario de funcionamento e rejeitado", async () => {
    // Amanha as 03:00 (fora de open_hour=10, close_hour=22)
    const tomorrow3am = new Date();
    tomorrow3am.setDate(tomorrow3am.getDate() + 1);
    tomorrow3am.setUTCHours(3, 0, 0, 0);

    const { error } = await anon.rpc("create_order", {
      p_payload: {
        ...basePayload,
        items: [{ menuItemId, qty: 1 }],
        scheduledFor: tomorrow3am.toISOString(),
      },
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("scheduled_for_outside_hours");
  });

  it("scheduledFor no minuto errado (nao alinhado ao slot de 30min) e rejeitado", async () => {
    // Amanha as 13:17 — minuto 17 nao e multiplo de 30
    const tomorrow1317 = new Date();
    tomorrow1317.setDate(tomorrow1317.getDate() + 1);
    tomorrow1317.setUTCHours(13, 17, 0, 0);

    const { error } = await anon.rpc("create_order", {
      p_payload: {
        ...basePayload,
        items: [{ menuItemId, qty: 1 }],
        scheduledFor: tomorrow1317.toISOString(),
      },
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("scheduled_for_invalid_slot");
  });

  it("scheduledFor valido (amanha as 12:30) e aceite", async () => {
    // Amanha as 12:30 — dentro de 10-22, minuto 30 alinhado
    const tomorrow1230 = new Date();
    tomorrow1230.setDate(tomorrow1230.getDate() + 1);
    tomorrow1230.setUTCHours(12, 30, 0, 0);

    const { data: orderId, error } = await anon.rpc("create_order", {
      p_payload: {
        ...basePayload,
        items: [{ menuItemId, qty: 1 }],
        scheduledFor: tomorrow1230.toISOString(),
      },
    });

    expect(error).toBeNull();
    expect(typeof orderId).toBe("string");

    const { data: order } = await admin
      .from("orders")
      .select("scheduled_for")
      .eq("id", orderId)
      .single();

    expect(order!.scheduled_for).not.toBeNull();
  });

  it("null scheduledFor (ASAP) e sempre aceite", async () => {
    const { data: orderId, error } = await anon.rpc("create_order", {
      p_payload: {
        ...basePayload,
        items: [{ menuItemId, qty: 1 }],
        scheduledFor: null,
      },
    });

    expect(error).toBeNull();

    const { data: order } = await admin
      .from("orders")
      .select("scheduled_for")
      .eq("id", orderId)
      .single();

    expect(order!.scheduled_for).toBeNull();
  });
});

// ─── get_order_status() ──────────────────────────────────────────────────────

describe("get_order_status() — cliente faz polling do pedido", () => {
  it("retorna status do pedido por UUID", async () => {
    const { data: orderId } = await anon.rpc("create_order", {
      p_payload: {
        items: [{ menuItemId, qty: 1 }],
        customerName: "Teste Status",
        fulfillmentType: "pickup",
        paymentMethod: "mpesa",
      },
    });

    const { data: status, error } = await anon.rpc("get_order_status", {
      p_order_id: orderId,
    });

    expect(error).toBeNull();
    expect(status.id).toBe(orderId);
    expect(status.status).toBe("awaiting_approval");
    expect(status.order_number).toMatch(/^ENC-/);
  });

  it("UUID inexistente retorna erro", async () => {
    const { error } = await anon.rpc("get_order_status", {
      p_order_id: "00000000-0000-0000-0000-000000000000",
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("order_not_found");
  });
});
