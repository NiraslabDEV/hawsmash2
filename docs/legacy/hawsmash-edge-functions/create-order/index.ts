import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const DELIVERY_FEE = 150;

// Rate-limit: máx 6 pedidos por telefone por hora
const recentOrders = new Map<string, number[]>();
function isRateLimited(phone: string): boolean {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const times = (recentOrders.get(phone) || []).filter(t => now - t < hour);
  if (times.length >= 6) return true;
  times.push(now);
  recentOrders.set(phone, times);
  return false;
}

function bad(msg: string, code = 400) {
  return new Response(JSON.stringify({ error: msg }), { status: code, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

type ProdInfo = {
  price_single: number|null;
  price_haw: number|null;
  price_wagyu: number|null;
  variants: string[]|null;
  available: boolean;
};

// Resolve o preço de um item do carrinho a partir do DB.
// Carrinho usa nomes como "Classic Smash (HAW)", "Fanta (Laranja)", "Joe's Chips", etc.
// Estratégia: tenta nome exacto primeiro (cobre Nata, Chips, Signature, Sprite, etc.);
// se não encontrar, extrai a variante entre parênteses e tenta o nome-base:
//   - HAW/WAGYU → preço da variante do burger
//   - sabor presente em `variants` → preço único do produto (bebidas)
function resolvePrice(cartName: string, productMap: Map<string, ProdInfo>): number | null {
  // 1. Nome exacto (inclui Nata, Chips, Signature, Sprite e outros sem variante)
  const exact = productMap.get(cartName);
  if (exact) {
    if (!exact.available) return null; // indisponível
    return exact.price_single ?? null;
  }

  // 2. Variante entre parênteses — e.g. "Classic Smash (HAW)", "Fanta (Laranja)"
  const variantMatch = cartName.match(/^(.+?)\s*\((.+)\)$/);
  if (variantMatch) {
    const baseName = variantMatch[1].trim();
    const variant  = variantMatch[2].trim();
    const prod = productMap.get(baseName);
    if (!prod || !prod.available) return null;

    const up = variant.toUpperCase();
    if (up === 'HAW')   return prod.price_haw   ?? null;
    if (up === 'WAGYU') return prod.price_wagyu ?? null;

    // Bebidas com sabores: variante tem de existir na lista; preço único partilhado
    if (prod.variants && prod.variants.some(v => v.toLowerCase() === variant.toLowerCase())) {
      return prod.price_single ?? null;
    }
  }

  return null; // não encontrado
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return bad('Method not allowed', 405);

  let body: any;
  try { body = await req.json(); } catch { return bad('JSON inválido'); }

  const { items, fulfillment, slot_date, slot_window, customer, payment_proof_url, payment_reference, payment_method, customer_notes } = body || {};

  // ── Validações básicas ──
  if (!Array.isArray(items) || items.length === 0) return bad('Carrinho vazio');
  if (!['pickup', 'delivery', 'yango'].includes(fulfillment)) return bad('Tipo de entrega inválido');
  if (!slot_date || !slot_window) return bad('Horário em falta');
  if (!customer || !customer.name || !customer.phone) return bad('Dados do cliente em falta');
  if (fulfillment === 'delivery' && !customer.address) return bad('Endereço obrigatório para entrega');

  const phone = String(customer.phone).trim();
  if (isRateLimited(phone)) return bad('Muitos pedidos. Tenta de novo mais tarde.', 429);

  const pay_method = ['emola', 'mpesa'].includes(payment_method) ? payment_method : 'emola';

  // ── Carrega produtos do DB (fonte de verdade dos preços) ──
  const { data: productsData, error: prodErr } = await supabase
    .from('products')
    .select('name, price_single, price_haw, price_wagyu, variants, available');

  if (prodErr || !productsData) {
    return bad('Erro ao carregar catálogo de produtos', 500);
  }

  // Índice por nome para lookup O(1)
  const productMap = new Map<string, ProdInfo>();
  for (const p of productsData) {
    productMap.set(p.name, {
      price_single: p.price_single,
      price_haw:    p.price_haw,
      price_wagyu:  p.price_wagyu,
      variants:     Array.isArray(p.variants) ? p.variants : null,
      available:    p.available,
    });
  }

  // ── Recalcula preços do lado do servidor (ignora qualquer preço do cliente) ──
  let subtotal = 0;
  const cleanItems: any[] = [];
  for (const it of items) {
    const name = String(it.name || '').trim();
    const qty  = parseInt(it.qty);
    if (!name || !Number.isFinite(qty) || qty < 1 || qty > 99) return bad(`Item inválido: ${name}`);

    const unit = resolvePrice(name, productMap);
    if (unit === null) {
      // null pode significar "não encontrado" ou "indisponível"
      const exactProd = productMap.get(name);
      const vm = name.match(/^(.+?)\s*\((.+)\)$/);
      const baseProd = vm ? productMap.get(vm[1].trim()) : null;
      if ((exactProd && !exactProd.available) || (baseProd && !baseProd.available)) {
        return bad(`Produto indisponível: ${name}`);
      }
      return bad(`Produto desconhecido: ${name}`);
    }

    const line = unit * qty;
    subtotal += line;
    const variantMatch = name.match(/\(([^)]+)\)\s*$/);
    cleanItems.push({
      product_name:   name,
      variant:        variantMatch?.[1]?.trim() || null,
      unit_price_mt:  unit,
      qty,
      line_total_mt:  line,
    });
  }

  // Taxa de entrega por zona (store_settings key='delivery'). Servidor é a autoridade.
  let delivery_fee_mt = 0;
  if (fulfillment === 'delivery') {
    let defaultFee = DELIVERY_FEE;
    let zones: Array<{ name: string; fee: number }> = [];
    const { data: dRow } = await supabase.from('store_settings').select('value').eq('key', 'delivery').maybeSingle();
    if (dRow?.value) {
      defaultFee = Number(dRow.value.default_fee) || DELIVERY_FEE;
      zones = Array.isArray(dRow.value.zones) ? dRow.value.zones : [];
    }
    const z = String(customer.zone || '').trim().toLowerCase();
    const match = z ? zones.find((x) => String(x.name).trim().toLowerCase() === z) : null;
    delivery_fee_mt = match ? (Number(match.fee) || defaultFee) : defaultFee;
  }
  const total_mt = subtotal + delivery_fee_mt;

  // ── Insere pedido (service role) ──
  const { data: order, error: e1 } = await supabase.from('orders').insert({
    customer_name:    String(customer.name).trim(),
    customer_phone:   phone,
    customer_email:   customer.email ? String(customer.email).trim() : null,
    fulfillment,
    delivery_address: fulfillment === 'delivery' ? String(customer.address || '').trim() : null,
    delivery_zone:    fulfillment === 'delivery' ? (customer.zone ? String(customer.zone).trim() : null) : null,
    slot_date,
    slot_window,
    payment_method:      pay_method,
    payment_proof_url:   payment_proof_url || null,
    payment_reference:   payment_reference ? String(payment_reference).trim() : null,
    subtotal_mt:         subtotal,
    delivery_fee_mt,
    total_mt,
    customer_notes:      customer_notes ? String(customer_notes).trim() : null,
    status: 'pending',
  }).select('id, order_number').single();

  if (e1 || !order) return bad('Falha ao criar pedido: ' + (e1?.message || 'desconhecido'), 500);

  const itemsRows = cleanItems.map(i => ({ ...i, order_id: order.id }));
  const { error: e2 } = await supabase.from('order_items').insert(itemsRows);
  if (e2) {
    await supabase.from('orders').delete().eq('id', order.id);
    return bad('Falha nos itens: ' + e2.message, 500);
  }

  return new Response(JSON.stringify({
    ok: true,
    order_id:        order.id,
    order_number:    order.order_number,
    subtotal_mt:     subtotal,
    delivery_fee_mt,
    total_mt,
    items:           cleanItems,
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
