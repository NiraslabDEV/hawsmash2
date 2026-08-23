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
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "http://localhost:54731";

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
const BANK_PRICE_CENTS = 30000; // Classic Smash no seed

function nextMaputoDow(dow: number, hour: number, minute: number): string {
  const now = new Date();
  const candidate = new Date(now);
  // Africa/Maputo é UTC+2 e não observa horário de verão.
  candidate.setUTCHours(hour - 2, minute, 0, 0);

  while (candidate <= now || candidate.getUTCDay() !== dow) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }

  return candidate.toISOString();
}

let maputoManager: SupabaseClient;
let maputoCashier: SupabaseClient;
let maputoKitchen: SupabaseClient;
let matolaManager: SupabaseClient;
let owner: SupabaseClient;
let maputoStoreId: string;
let matolaStoreId: string;
const testUserIds: string[] = [];

async function createStaffClient(
  email: string,
  role: "owner" | "manager" | "cashier" | "kitchen",
  storeIds: string[],
): Promise<SupabaseClient> {
  const password = "Rls-F1-Teste-2026!";
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    throw new Error(`Setup: não foi possível criar ${email} — ${createError?.message}`);
  }

  testUserIds.push(created.user.id);

  const { error: profileError } = await admin.from("staff_profiles").insert({
    user_id: created.user.id,
    full_name: `Teste ${role}`,
    role,
    active: true,
  });
  if (profileError) throw new Error(`Setup: staff_profile — ${profileError.message}`);

  if (storeIds.length > 0) {
    const { error: storesError } = await admin.from("staff_stores").insert(
      storeIds.map((storeId) => ({ user_id: created.user.id, store_id: storeId })),
    );
    if (storesError) throw new Error(`Setup: staff_stores — ${storesError.message}`);
  }

  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`Setup: login ${email} — ${signInError.message}`);

  return client;
}

beforeAll(async () => {
  anon  = createClient(SUPABASE_URL, ANON_KEY);
  admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Obter ID de um item do seed para usar nos testes de create_order
  const { data: item, error } = await admin
    .from("menu_items")
    .select("id, price_cents")
    .eq("name", "Classic Smash")
    .single();

  if (error || !item) throw new Error(`Setup: item nao encontrado — ${error?.message}. Corre 'pnpm db:migrate' primeiro.`);

  menuItemId = item.id;

  if (item.price_cents !== BANK_PRICE_CENTS) {
    throw new Error(`Setup: preco do item no banco e ${item.price_cents}, esperado ${BANK_PRICE_CENTS}`);
  }

  const { data: stores, error: storesError } = await admin
    .from("stores")
    .select("id, slug")
    .in("slug", ["maputo", "matola"]);

  if (storesError || stores?.length !== 2) {
    throw new Error(`Setup F1: lojas não encontradas — ${storesError?.message}`);
  }

  maputoStoreId = stores.find((store) => store.slug === "maputo")!.id;
  matolaStoreId = stores.find((store) => store.slug === "matola")!.id;

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  maputoManager = await createStaffClient(
    `rls-maputo-${suffix}@delivery.test`,
    "manager",
    [maputoStoreId],
  );
  matolaManager = await createStaffClient(
    `rls-matola-${suffix}@delivery.test`,
    "manager",
    [matolaStoreId],
  );
  owner = await createStaffClient(`rls-owner-${suffix}@delivery.test`, "owner", []);
  maputoCashier = await createStaffClient(
    `rls-caixa-${suffix}@delivery.test`,
    "cashier",
    [maputoStoreId],
  );
  maputoKitchen = await createStaffClient(
    `rls-cozinha-${suffix}@delivery.test`,
    "kitchen",
    [maputoStoreId],
  );
});

afterAll(async () => {
  await admin
    .from("store_items")
    .update({ price_cents_override: null })
    .eq("store_id", matolaStoreId)
    .eq("menu_item_id", menuItemId);

  await admin
    .from("delivery_zones")
    .delete()
    .like("name", "Zona RLS F1 %");

  for (const userId of testUserIds) {
    await admin.auth.admin.deleteUser(userId);
  }
});

// ─── F1: isolamento entre lojas (gate de CI) ───────────────────────────────

describe("F1 — RLS multi-unidade", () => {
  it("manager da Matola não lê zonas de Maputo", async () => {
    const { data, error } = await matolaManager
      .from("delivery_zones")
      .select("id, store_id")
      .eq("store_id", maputoStoreId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("manager da Matola não escreve em Maputo", async () => {
    const { error } = await matolaManager.from("delivery_zones").insert({
      store_id: maputoStoreId,
      name: "Zona RLS F1 proibida",
      fee_cents: 1000,
      active: true,
      sort: 999,
    });

    expect(error).not.toBeNull();
  });

  it("manager da Matola escreve na própria loja", async () => {
    const { data, error } = await matolaManager
      .from("delivery_zones")
      .insert({
        store_id: matolaStoreId,
        name: "Zona RLS F1 Matola",
        fee_cents: 1000,
        active: true,
        sort: 999,
      })
      .select("store_id")
      .single();

    expect(error).toBeNull();
    expect(data?.store_id).toBe(matolaStoreId);
  });

  it("manager de Maputo não lê a zona criada na Matola", async () => {
    const { data, error } = await maputoManager
      .from("delivery_zones")
      .select("id")
      .eq("name", "Zona RLS F1 Matola");

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("owner lê as duas lojas", async () => {
    const { data, error } = await owner
      .from("stores")
      .select("slug")
      .in("slug", ["maputo", "matola"])
      .order("slug");

    expect(error).toBeNull();
    expect(data?.map((store) => store.slug)).toEqual(["maputo", "matola"]);
  });

  it("aplica a configuração comercial confirmada às duas lojas", async () => {
    const [{ data: maputoMenu, error: maputoError }, { data: matolaMenu, error: matolaError }] =
      await Promise.all([
        anon.rpc("get_menu", { p_store_slug: "maputo" }),
        anon.rpc("get_menu", { p_store_slug: "matola" }),
      ]);

    expect(maputoError).toBeNull();
    expect(matolaError).toBeNull();

    for (const menu of [maputoMenu, matolaMenu]) {
      expect(menu.accepting_orders).toBe(true);
      expect(menu.mpesa_number).toBe("847955382");
      expect(menu.mpesa_name).toBe("Soeil Nissar");
      expect(menu.emola_number).toBe("870909080");
      expect(menu.emola_name).toBe("Mehzabin Ibrahim");
    }

    expect(maputoMenu.hours).toEqual([
      { dow: 4, opens: "11:00:00", closes: "21:30:00", active: true },
      { dow: 5, opens: "11:00:00", closes: "21:30:00", active: true },
      { dow: 6, opens: "11:00:00", closes: "21:30:00", active: true },
    ]);
    expect(matolaMenu.hours).toEqual([
      { dow: 4, opens: "12:00:00", closes: "21:30:00", active: true },
      { dow: 5, opens: "12:00:00", closes: "21:30:00", active: true },
      { dow: 6, opens: "12:00:00", closes: "21:30:00", active: true },
    ]);

    const prices = (menu: typeof maputoMenu) => {
      const entries: Array<[string, number]> = menu.categories
        .flatMap((category: { items: Array<{ id: string; price_cents: number }> }) => category.items)
        .map((item: { id: string; price_cents: number }) => [item.id, item.price_cents]);
      return entries.sort(([left], [right]) => left.localeCompare(right));
    };

    expect(prices(matolaMenu)).toEqual(prices(maputoMenu));
  });

  it("get_menu aplica preço e disponibilidade da loja pedida", async () => {
    const { error: overrideError } = await admin
      .from("store_items")
      .update({ price_cents_override: 31000 })
      .eq("store_id", matolaStoreId)
      .eq("menu_item_id", menuItemId);
    expect(overrideError).toBeNull();

    const [{ data: maputoMenu }, { data: matolaMenu }] = await Promise.all([
      anon.rpc("get_menu", { p_store_slug: "maputo" }),
      anon.rpc("get_menu", { p_store_slug: "matola" }),
    ]);

    const maputoItem = maputoMenu.categories
      .flatMap((category: { items: Array<{ id: string; price_cents: number }> }) => category.items)
      .find((item: { id: string }) => item.id === menuItemId);
    const matolaItem = matolaMenu.categories
      .flatMap((category: { items: Array<{ id: string; price_cents: number }> }) => category.items)
      .find((item: { id: string }) => item.id === menuItemId);

    expect(maputoItem?.price_cents).toBe(30000);
    expect(matolaItem?.price_cents).toBe(31000);
  });

  it("RPC de listagem também respeita o isolamento", async () => {
    const { data: orderId, error: createError } = await anon.rpc("create_order", {
      p_store_slug: "maputo",
      p_payload: {
        items: [{ menuItemId, qty: 1 }],
        customerName: "Teste RLS RPC",
        fulfillmentType: "pickup",
        paymentMethod: "mpesa",
      },
    });
    expect(createError).toBeNull();

    const { data, error } = await matolaManager.rpc("get_orders", {
      p_filters: {},
    });

    expect(error).toBeNull();
    expect(JSON.stringify(data)).not.toContain(orderId);
  });
});

// ─── (a) anon nao le nenhuma tabela ─────────────────────────────────────────

describe("(a) Data API — anon nao tem acesso directo a nenhuma tabela", () => {
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
    it(`anon SELECT em '${table}' é recusado antes do RLS`, async () => {
      const { data, error } = await anon.from(table).select("*").limit(5);
      // Grants e RLS são camadas separadas. anon nem alcança a tabela; o
      // cardápio e pedidos públicos passam exclusivamente pelas RPCs.
      expect(error?.code).toBe("42501");
      expect(data).toBeNull();
    });
  }
});

// ─── (b) get_menu() devolve menu + zonas ────────────────────────────────────

describe("(b) RPC get_menu() — cardapio e zonas publicos", () => {
  it("retorna accepting_orders, categories e zones", async () => {
    const { data, error } = await anon.rpc("get_menu", { p_store_slug: "maputo" });

    expect(error).toBeNull();
    expect(typeof data.accepting_orders).toBe("boolean");
    expect(Array.isArray(data.categories)).toBe(true);
    expect(Array.isArray(data.zones)).toBe(true);
  });

  it("categories tem ao menos 1 categoria com items", async () => {
    const { data } = await anon.rpc("get_menu", { p_store_slug: "maputo" });

    expect(data.categories.length).toBeGreaterThan(0);
    const firstCat = data.categories[0];
    expect(Array.isArray(firstCat.items)).toBe(true);
    expect(firstCat.items.length).toBeGreaterThan(0);
  });

  it("items nao expoe campos sensiveis (sem category_id no item, sem track_stock)", async () => {
    const { data } = await anon.rpc("get_menu", { p_store_slug: "maputo" });
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
    const { data } = await anon.rpc("get_menu", { p_store_slug: "maputo" });

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
      p_store_slug: "maputo",
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

    expect(order!.subtotal_cents).toBe(BANK_PRICE_CENTS * 2); // 60000
    expect(order!.delivery_fee_cents).toBe(0);                // pickup, sem taxa
    expect(order!.total_cents).toBe(BANK_PRICE_CENTS * 2);    // 60000
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
      p_store_slug: "maputo",
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
      p_store_slug: "maputo",
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

  it("order_number e gerado com o prefixo da loja", async () => {
    const { data: orderId } = await anon.rpc("create_order", {
      p_store_slug: "maputo",
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

    expect(order!.order_number).toMatch(/^MPT-\d{4}$/);
  });

  it("pedido vazio e rejeitado", async () => {
    const { error } = await anon.rpc("create_order", {
      p_store_slug: "maputo",
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
      p_store_slug: "maputo",
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
      p_store_slug: "maputo",
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
      p_store_slug: "maputo",
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
    const { error } = await anon.rpc("create_order", {
      p_store_slug: "maputo",
      p_payload: {
        ...basePayload,
        items: [{ menuItemId, qty: 1 }],
        scheduledFor: nextMaputoDow(4, 3, 0),
      },
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("scheduled_for_outside_hours");
  });

  it("scheduledFor no minuto errado (nao alinhado ao slot de 30min) e rejeitado", async () => {
    const { error } = await anon.rpc("create_order", {
      p_store_slug: "maputo",
      p_payload: {
        ...basePayload,
        items: [{ menuItemId, qty: 1 }],
        scheduledFor: nextMaputoDow(4, 13, 17),
      },
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("scheduled_for_invalid_slot");
  });

  it("scheduledFor válido em Maputo é aceite", async () => {
    const { data: orderId, error } = await anon.rpc("create_order", {
      p_store_slug: "maputo",
      p_payload: {
        ...basePayload,
        items: [{ menuItemId, qty: 1 }],
        scheduledFor: nextMaputoDow(4, 12, 30),
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

  it("Maputo aceita 11:30 num dia aberto", async () => {
    const { data: orderId, error } = await anon.rpc("create_order", {
      p_store_slug: "maputo",
      p_payload: {
        ...basePayload,
        items: [{ menuItemId, qty: 1 }],
        scheduledFor: nextMaputoDow(4, 11, 30),
      },
    });

    expect(error).toBeNull();
    expect(typeof orderId).toBe("string");
  });

  it("Matola rejeita agendamento antes das 12:00", async () => {
    const { error } = await anon.rpc("create_order", {
      p_store_slug: "matola",
      p_payload: {
        ...basePayload,
        items: [{ menuItemId, qty: 1 }],
        scheduledFor: nextMaputoDow(4, 11, 30),
      },
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("scheduled_for_outside_hours");
  });

  it("uma loja rejeita agendamento num dia encerrado", async () => {
    const { error } = await anon.rpc("create_order", {
      p_store_slug: "maputo",
      p_payload: {
        ...basePayload,
        items: [{ menuItemId, qty: 1 }],
        scheduledFor: nextMaputoDow(1, 12, 30),
      },
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("scheduled_for_outside_hours");
  });

  it("null scheduledFor (ASAP) e sempre aceite", async () => {
    const { data: orderId, error } = await anon.rpc("create_order", {
      p_store_slug: "maputo",
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
      p_store_slug: "maputo",
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
    expect(status.order_number).toMatch(/^MPT-/);
  });

  it("UUID inexistente retorna erro", async () => {
    const { error } = await anon.rpc("get_order_status", {
      p_order_id: "00000000-0000-0000-0000-000000000000",
    });

    expect(error).not.toBeNull();
    expect(error!.message).toContain("order_not_found");
  });
});

// ─── Dinheiro por perfil: a cozinha não vê caixa nem pagamentos ────────────
//
// A RLS protegia dinheiro por LOJA (`auth_can_store`) mas não por PERFIL, e o
// `CLAUDE.md §6` é explícito: `kitchen` não vê dinheiro. Estes testes criam
// linhas reais antes de verificar — sem isso, "leu 0 linhas" tanto pode ser a
// RLS a bloquear como a tabela a estar vazia, e essa confusão já custou um
// diagnóstico errado nesta base de código.

describe("§6 — dinheiro é visível por perfil, não só por loja", () => {
  let sessionId: string;
  let sessionIsOurs = false;
  let orderId: string;

  beforeAll(async () => {
    // `cash_sessions` tem um trigger `before insert` que devolve NULL — em
    // silêncio — quando a loja já tem caixa aberta (1007_cash.sql). É a
    // serialização certa: uma caixa aberta por loja. Aqui isso significa
    // reaproveitar a que existir em vez de tentar abrir outra e receber zero
    // linhas sem erro nenhum.
    const { data: aberta } = await admin
      .from("cash_sessions")
      .select("id")
      .eq("store_id", maputoStoreId)
      .is("closed_at", null)
      .limit(1)
      .maybeSingle();

    if (aberta) {
      sessionId = aberta.id;
    } else {
      const { data: session, error: sessionError } = await admin
        .from("cash_sessions")
        .insert({
          store_id: maputoStoreId,
          shift_label: "Turno RLS §6",
          opening_float_cents: 100_00,
        })
        .select("id")
        .single();
      if (sessionError || !session) throw new Error(`Setup §6: caixa — ${sessionError?.message}`);
      sessionId = session.id;
      sessionIsOurs = true;
    }

    // `cash_movements.created_by` é obrigatório e aponta para auth.users: um
    // movimento de caixa sem autor não existe, por desenho.
    const { data: managerUser } = await maputoManager.auth.getUser();
    if (!managerUser.user) throw new Error("Setup §6: sessão do gerente perdida");

    const { error: movementError } = await admin.from("cash_movements").insert({
      session_id: sessionId,
      store_id: maputoStoreId,
      type: "reforco",
      amount_cents: 500_00,
      reason: "Setup do teste §6",
      created_by: managerUser.user.id,
    });
    if (movementError) throw new Error(`Setup §6: movimento — ${movementError.message}`);

    // Fixture explícito: `orders` exige order_number, flow, fulfillment_type,
    // subtotal_cents e payment_method além do óbvio. Escrever todos à mão é
    // mais legível do que descobri-los um a um por CI vermelha.
    const marca = `T6-${Date.now()}`;
    const { data: order, error: orderError } = await admin
      .from("orders")
      .insert({
        store_id: maputoStoreId,
        order_number: marca,
        status: "paid",
        flow: "manual",
        channel: "counter",
        fulfillment_type: "pickup",
        customer_name: "Teste §6",
        subtotal_cents: 300_00,
        total_cents: 300_00,
        payment_method: "cash",
      })
      .select("id")
      .single();
    if (orderError || !order) throw new Error(`Setup §6: pedido — ${orderError?.message}`);
    orderId = order.id;

    const { error: paymentError } = await admin.from("payments").insert({
      order_id: orderId,
      store_id: maputoStoreId,
      provider: "manual",
      method: "cash",
      amount_cents: 300_00,
      status: "confirmed",
      idempotency_key: marca,
    });
    if (paymentError) throw new Error(`Setup §6: pagamento — ${paymentError.message}`);
  });

  afterAll(async () => {
    await admin.from("payments").delete().eq("order_id", orderId);
    await admin.from("orders").delete().eq("id", orderId);
    await admin.from("cash_movements").delete().eq("reason", "Setup do teste §6");
    // Só fechamos o que abrimos: a caixa pode ser de outro teste ou do seed.
    if (sessionIsOurs) await admin.from("cash_sessions").delete().eq("id", sessionId);
  });

  it("o caixa vê a caixa da loja dele — precisa dela para fechar o turno", async () => {
    const { data, error } = await maputoCashier
      .from("cash_sessions")
      .select("id")
      .eq("id", sessionId);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  it("a cozinha não vê sessões de caixa", async () => {
    const { data, error } = await maputoKitchen
      .from("cash_sessions")
      .select("id")
      .eq("id", sessionId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("a cozinha não vê movimentos de caixa", async () => {
    const { data, error } = await maputoKitchen
      .from("cash_movements")
      .select("id")
      .eq("session_id", sessionId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("a cozinha não vê pagamentos", async () => {
    const { data, error } = await maputoKitchen
      .from("payments")
      .select("id")
      .eq("order_id", orderId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("a cozinha continua a ver o pedido — precisa dele para cozinhar", async () => {
    const { data, error } = await maputoKitchen
      .from("orders")
      .select("id")
      .eq("id", orderId);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  it("o gerente vê tudo o que é dinheiro da loja dele", async () => {
    const caixa = await maputoManager.from("cash_sessions").select("id").eq("id", sessionId);
    const pagamentos = await maputoManager.from("payments").select("id").eq("order_id", orderId);
    expect(caixa.data?.length).toBe(1);
    expect(pagamentos.data?.length).toBe(1);
  });
});
