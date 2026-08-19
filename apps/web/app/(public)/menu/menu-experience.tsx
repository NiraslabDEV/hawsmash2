'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { formatMT, type Cents } from '@delivery/core';
import { useCart } from '@/utils/useCart';
import { createClient } from '@/utils/supabase/client';
import { trackViewMenu, trackViewItem, trackAddToCart, trackLead, trackCouponApplied, type TrackItem } from '@/lib/analytics/track';
import { brand } from '@brand';
import { serializeStoreCookie } from '@/lib/store-context';
import type { PublicStoreOption } from '@/lib/public-stores';

const mt = (cents: number) => formatMT(cents as Cents);
const ST = brand.storefront;

type Variant = { id: string; name: string; price_cents: number; is_default?: boolean };
type Addon = { id: string; name: string; price_cents: number };
type ModifierOption = { id: string; name: string; price_cents: number };
type ModifierGroup = {
  id: string;
  name: string;
  selection_type: 'single' | 'multi';
  min_select: number;
  max_select: number;
  free_quantity: number;
  extra_price_cents: number;
  options: ModifierOption[];
};
type MenuItem = { id: string; name: string; description: string | null; price_cents: number; photo_url: string | null; available?: boolean; calories_kcal?: number | null; allergens?: string[]; variants?: Variant[]; addons?: Addon[]; modifier_groups?: ModifierGroup[] };
type Category = { id: string; name: string; photo_url?: string | null; items: MenuItem[] };
type ReferralResult = {
  valid: boolean;
  reason?: string;
  reward_type?: 'discount_cents' | 'discount_pct' | 'free_item';
  reward_value?: number;
  gift_item_id?: string;
  gift_item_name?: string;
  gift_item_photo_url?: string | null;
};

const REFERRAL_KEY = 'referral_code';
const REFERRAL_RESULT_KEY = 'referral_result';

// preço unitário de uma linha = (variante escolhida ou base) + Σ adicionais.
// PREVIEW no client; o servidor (create_order) é a verdade (CLAUDE §6).
function lineUnitPrice(
  item: MenuItem,
  variantId?: string,
  addonIds: string[] = [],
  selections: Record<string, string[]> = {},
): number {
  const base = variantId ? (item.variants?.find((v) => v.id === variantId)?.price_cents ?? item.price_cents) : item.price_cents;
  const addons = (item.addons ?? []).filter((a) => addonIds.includes(a.id)).reduce((s, a) => s + a.price_cents, 0);
  // Escolhas: soma o preço das opções + o extra por unidade acima das grátis.
  const mods = (item.modifier_groups ?? []).reduce((sum, g) => {
    const ids = selections[g.id] ?? [];
    const chosen = g.options.filter((o) => ids.includes(o.id)).reduce((s, o) => s + o.price_cents, 0);
    const over = Math.max(ids.length - g.free_quantity, 0);
    return sum + chosen + over * g.extra_price_cents;
  }, 0);
  return base + addons + mods;
}
const hasOptions = (item: MenuItem) =>
  Boolean(item.variants?.length || item.addons?.length || item.modifier_groups?.length);
/** Grupos que o cliente TEM de preencher — sem eles o servidor recusa o pedido. */
const requiresChoice = (item: MenuItem) =>
  (item.modifier_groups ?? []).some((g) => g.min_select > 0);

/** Escolhas guardadas numa linha do carrinho, na forma que o preço espera. */
const selectionsOf = (line: { modifiers?: { groupId: string; optionIds: string[] }[] }): Record<string, string[]> =>
  Object.fromEntries((line.modifiers ?? []).map((m) => [m.groupId, m.optionIds]));

/** Resumo legível das escolhas de uma linha ("Batata Frita, Salada · Molho de Manteiga"). */
function selectionLabel(item: MenuItem, line: { modifiers?: { groupId: string; optionIds: string[] }[] }): string {
  return (item.modifier_groups ?? [])
    .map((g) => {
      const ids = (line.modifiers ?? []).find((m) => m.groupId === g.id)?.optionIds ?? [];
      return g.options.filter((o) => ids.includes(o.id)).map((o) => o.name).join(', ');
    })
    .filter(Boolean)
    .join(' · ');
}
type ReorderItem = { menu_item_id: string; qty: number };
type FavItem = { menu_item_id: string; name: string; qty: number };
type RecentOrder = { id: string; order_number: string; status: string; total_cents: number; created_at: string };
type CustomerSummary = { phone: string; name: string | null; orders_count: number; total_spent_cents: number; favorites: FavItem[]; recent_orders: RecentOrder[] };
type CustomerOrder = { id: string; order_number: string; status: string; fulfillment_type: string; total_cents: number; created_at: string; scheduled_for: string | null; items: { menu_item_id: string; name: string; qty: number }[] };

// foto do item ou fallback determinístico dos assets da marca (whitelabel)
const imgFor = (item: MenuItem, idx: number) =>
  item.photo_url || ST.fallbackImages[idx % ST.fallbackImages.length];

const DL_PHONE_KEY = 'dl_phone';

// rótulo/cor de estado para a lista "Meus Pedidos"
const ORDER_STATUS: Record<string, { label: string; color: string }> = {
  awaiting_approval: { label: 'Aguarda aprovação', color: '#f59e0b' },
  awaiting_payment: { label: 'Aguarda pagamento', color: '#f59e0b' },
  paid: { label: 'Pago', color: '#3b82f6' },
  approved: { label: 'Aceite', color: '#22c55e' },
  in_preparation: { label: 'Em preparo', color: '#f59e0b' },
  ready: { label: 'Pronto', color: '#8b5cf6' },
  delivered: { label: 'Entregue', color: '#22c55e' },
  cancelled: { label: 'Cancelado', color: '#ef4444' },
  payment_failed: { label: 'Falhou', color: '#ef4444' },
};
const isActiveOrder = (s: string) => ['awaiting_approval', 'awaiting_payment', 'paid', 'approved', 'in_preparation', 'ready'].includes(s);

export function MenuExperience({ storeSlug, storeName }: { storeSlug: string; storeName: string }) {
  const router = useRouter();
  const [cartOpen, setCartOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [product, setProduct] = useState<MenuItem | null>(null);
  const [productQty, setProductQty] = useState(1);
  const [selVariant, setSelVariant] = useState<string | undefined>(undefined);
  const [selAddons, setSelAddons] = useState<string[]>([]);
  // groupId -> optionIds escolhidos (acompanhamentos, molho, tipo de ovo…)
  const [selMods, setSelMods] = useState<Record<string, string[]>>({});
  const [modError, setModError] = useState<string | null>(null);
  const [account, setAccount] = useState<'identify' | 'orders' | 'profile' | null>(null);

  // F5.2 — barra de referral
  const [refInput, setRefInput] = useState('');
  const [refResult, setRefResult] = useState<ReferralResult | null>(null);
  const [refLoading, setRefLoading] = useState(false);
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [giftItemIds, setGiftItemIds] = useState<Set<string>>(new Set());
  const [identifyNext, setIdentifyNext] = useState<'orders' | 'profile'>('profile');
  const [phone, setPhone] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [myOrders, setMyOrders] = useState<CustomerOrder[] | null>(null);
  const { cart, add, setQtyByIndex, count, clear } = useCart();
  const [storeSwitch, setStoreSwitch] = useState(false);
  const supabase = createClient();

  const { data: menuData, isLoading, error } = useQuery({
    queryKey: ['menu', storeSlug],
    queryFn: async () => {
      const response = await fetch(
        `/api/menu?channel=delivery&store=${encodeURIComponent(storeSlug)}`,
      );
      if (!response.ok) throw new Error('Failed to fetch menu');
      return response.json();
    },
  });

  const categories: Category[] = menuData?.categories || [];
  const acceptingOrders = menuData?.accepting_orders ?? true;
  const promoBannerUrl: string | null = menuData?.promo_banner_url ?? null;
  const promoCode: string | null = menuData?.promo_code ?? null;

  // null = modo browse (todos os carrosséis); string = modo filtro (só essa categoria, vertical)
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [promoDismissed, setPromoDismissed] = useState(false);
  const [promoCopied, setPromoCopied] = useState(false);

  useEffect(() => {
    const dismissed = sessionStorage.getItem('promo_dismissed');
    if (dismissed) setPromoDismissed(true);
  }, []);

  const dismissPromo = () => {
    setPromoDismissed(true);
    sessionStorage.setItem('promo_dismissed', '1');
  };

  const copyPromoCode = () => {
    if (!promoCode) return;
    navigator.clipboard.writeText(promoCode).then(() => {
      setPromoCopied(true);
      setTimeout(() => setPromoCopied(false), 2000);
    });
  };

  // toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // view_menu — uma vez quando o cardápio carrega
  const viewedRef = useRef(false);
  useEffect(() => {
    if (viewedRef.current || !menuData?.categories) return;
    viewedRef.current = true;
    const flat: TrackItem[] = menuData.categories.flatMap((c: Category) =>
      (c.items || []).map((i) => ({ id: i.id, name: i.name, price_cents: i.price_cents })),
    );
    if (flat.length) trackViewMenu(flat);
  }, [menuData]);

  function handleAdd(item: MenuItem) {
    // Item com escolhas obrigatórias nunca entra direto no carrinho: sem elas
    // o servidor recusa o pedido inteiro no checkout.
    if (requiresChoice(item)) {
      openProduct(item);
      return;
    }
    add(item.id);
    trackAddToCart({ id: item.id, name: item.name, price_cents: item.price_cents, qty: 1 });
  }

  function openProduct(item: MenuItem) {
    setProduct(item);
    setProductQty(1);
    // tamanho: pré-seleciona o padrão (ou o primeiro) se houver variantes
    const def = item.variants?.find((v) => v.is_default) ?? item.variants?.[0];
    setSelVariant(def?.id);
    setSelAddons([]);
    setSelMods(Object.fromEntries((item.modifier_groups ?? []).map((g) => [g.id, [] as string[]])));
    setModError(null);
    trackViewItem({ id: item.id, name: item.name, price_cents: item.price_cents });
  }

  function toggleMod(group: ModifierGroup, optionId: string) {
    setModError(null);
    setSelMods((prev) => {
      const cur = prev[group.id] ?? [];
      if (group.selection_type === 'single') return { ...prev, [group.id]: [optionId] };
      if (cur.includes(optionId)) return { ...prev, [group.id]: cur.filter((id) => id !== optionId) };
      if (cur.length >= group.max_select) return prev;
      return { ...prev, [group.id]: [...cur, optionId] };
    });
  }

  // ── Conta (F7): identificação soft por telefone (sem OTP) ────────────────
  const persistPhone = (p: string) => {
    localStorage.setItem(DL_PHONE_KEY, p);
    document.cookie = `dl_phone=${encodeURIComponent(p)}; path=/; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
  };
  const identify = async (p: string, name?: string): Promise<boolean> => {
    const { data, error: err } = await supabase.rpc('identify_customer', name ? { p_phone: p, p_name: name } : { p_phone: p });
    if (err || !data) { setToast('Não foi possível identificar. Tenta de novo.'); return false; }
    persistPhone(p); setPhone(p); setCustomer(data as CustomerSummary);
    return true;
  };
  const logout = () => {
    localStorage.removeItem(DL_PHONE_KEY);
    document.cookie = 'dl_phone=; path=/; max-age=0';
    setPhone(null); setCustomer(null); setMyOrders(null); setAccount(null);
    setToast('Sessão terminada.');
  };
  const loadMyOrders = async (p: string) => {
    const { data } = await supabase.rpc('get_customer_orders', { p_phone: p });
    setMyOrders(((data as { orders?: CustomerOrder[] })?.orders) ?? []);
  };
  const reorder = (items: ReorderItem[]) => {
    items.forEach((it) => add(it.menu_item_id, it.qty));
    setAccount(null); setCartOpen(true); setToast('Itens adicionados ao carrinho');
  };
  const openOrders = () => { if (phone) { setAccount('orders'); loadMyOrders(phone); } else { setIdentifyNext('orders'); setAccount('identify'); } };
  const openProfile = () => { if (phone) setAccount('profile'); else { setIdentifyNext('profile'); setAccount('identify'); } };
  const onIdentified = async (p: string, name?: string) => {
    if (!(await identify(p, name))) return;
    if (identifyNext === 'orders') { setAccount('orders'); loadMyOrders(p); } else setAccount('profile');
  };

  // restaura a identificação ao carregar
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(DL_PHONE_KEY) : null;
    if (saved) { setPhone(saved); identify(saved); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // restaura o código de referral aplicado ao carregar
  useEffect(() => {
    const savedCode   = localStorage.getItem(REFERRAL_KEY);
    const savedResult = localStorage.getItem(REFERRAL_RESULT_KEY);
    if (savedCode && savedResult) {
      try {
        const parsed = JSON.parse(savedResult) as ReferralResult;
        setAppliedCode(savedCode);
        setRefResult(parsed);
        setRefInput(savedCode);
        if (parsed.gift_item_id) setGiftItemIds(new Set([parsed.gift_item_id]));
      } catch { /* ignora */ }
    }
  }, []);

  const applyReferral = async () => {
    const code = refInput.trim().toUpperCase();
    if (!code) return;
    setRefLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('validate_referral', {
        p_code:  code,
        p_phone: phone ?? '',
      });
      if (rpcError || !data) { setRefResult({ valid: false, reason: 'invalid_or_expired' }); return; }
      const result = data as ReferralResult;
      setRefResult(result);
      if (result.valid) {
        setAppliedCode(code);
        localStorage.setItem(REFERRAL_KEY, code);
        localStorage.setItem(REFERRAL_RESULT_KEY, JSON.stringify(result));
        trackCouponApplied(code);
        if (result.gift_item_id) {
          setGiftItemIds(new Set([result.gift_item_id]));
          // auto-adicionar o brinde ao carrinho se ainda não estiver lá
          add(result.gift_item_id, 1);
          setToast('🎁 Código aplicado! O seu presente foi adicionado ao carrinho.');
        } else {
          setToast('✅ Código aplicado! Desconto activo no checkout.');
        }
      }
    } finally {
      setRefLoading(false);
    }
  };

  const removeReferral = () => {
    setAppliedCode(null);
    setRefResult(null);
    setRefInput('');
    setGiftItemIds(new Set());
    localStorage.removeItem(REFERRAL_KEY);
    localStorage.removeItem(REFERRAL_RESULT_KEY);
  };

  if (!acceptingOrders) return <Shell><WaitlistForm /></Shell>;

  if (isLoading) {
    return (
      <Shell>
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto mb-4" style={{ borderColor: 'var(--st-primary)' }} />
            <p style={{ color: 'var(--st-muted)' }}>A carregar cardápio…</p>
          </div>
        </div>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="text-center">
            <p className="mb-2" style={{ color: 'var(--st-primary)' }}>Erro ao carregar cardápio</p>
            <button onClick={() => window.location.reload()} className="underline" style={{ color: 'var(--st-primary)' }}>
              Tentar novamente
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  const allItems = categories.flatMap((c) => c.items);
  const lineDetail = (id: string) => allItems.find((i) => i.id === id);
  const subtotal = cart.reduce((s, l) => {
    const it = lineDetail(l.menuItemId);
    return s + (it ? lineUnitPrice(it, l.variantId, l.addonIds, selectionsOf(l)) : 0) * l.qty;
  }, 0);
  // índice global estável para o fallback de imagem
  const globalIndex = (id: string) => allItems.findIndex((i) => i.id === id);

  // Card de item — faixa full-width. Medidas literais do protótipo aprovado.
  const ItemCard = ({ item }: { item: MenuItem }) => {
    const out = item.available === false;
    return (
      <div
        onClick={() => {
          if (out) {
            setToast('Esgotado hoje — volte amanhã.');
            return;
          }
          openProduct(item);
        }}
        className="flex cursor-pointer"
        style={{
          gap: 13,
          padding: 11,
          background: ST.card,
          border: `1px solid ${ST.line}`,
          borderRadius: 16,
          boxShadow: '0 3px 10px rgba(42,23,16,.05)',
        }}
      >
        <div
          className="relative overflow-hidden"
          style={{ width: 92, height: 92, borderRadius: 12, background: ST.photoBg, flex: 'none' }}
        >
          <Image src={imgFor(item, globalIndex(item.id))} alt={item.name} fill sizes="92px" className="object-cover" />
          {out && (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                background: 'rgba(42,23,16,.62)',
                fontFamily: 'var(--font-display)',
                fontSize: 11,
                letterSpacing: '1.4px',
                color: ST.primary,
                textTransform: 'uppercase',
              }}
            >
              Esgotado
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col" style={{ gap: 4, padding: '2px 0' }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 16.5,
              lineHeight: 1.05,
              letterSpacing: '.6px',
              color: ST.text,
              textTransform: 'uppercase',
            }}
          >
            {item.name}
          </div>
          {item.description && (
            <div style={{ fontSize: 11.5, lineHeight: 1.45, color: ST.muted2 }}>{item.description}</div>
          )}
          <div className="flex items-center justify-between" style={{ gap: 8, marginTop: 'auto' }}>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                letterSpacing: '.6px',
                color: ST.primary2,
              }}
            >
              {mt(item.price_cents)}
            </div>
            {!out && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasOptions(item)) openProduct(item);
                  else handleAdd(item);
                }}
                className="flex items-center justify-center"
                aria-label={`Adicionar ${item.name}`}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  background: ST.grad,
                  flex: 'none',
                  boxShadow: '0 5px 12px rgba(232,135,26,.34)',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M7 1.5v11M1.5 7h11" stroke={ST.text} strokeWidth="2.4" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <Shell>
      <div className="pb-28">
        {/* Cabeçalho — voltar · título · marca (abre a conta) */}
        <header
          className="relative"
          style={{
            zIndex: 5,
            padding: '18px 0 0',
            background: ST.card,
            borderBottom: `1px solid ${ST.line}`,
            boxShadow: '0 6px 18px rgba(42,23,16,.06)',
          }}
        >
          <div className="flex items-center" style={{ gap: 12, padding: '6px 16px 10px' }}>
            <Link
              href="/"
              aria-label="Voltar ao início"
              className="flex items-center justify-center"
              style={{
                width: 36,
                height: 36,
                borderRadius: 999,
                border: `1px solid rgba(42,23,16,.14)`,
                flex: 'none',
              }}
            >
              <svg width="17" height="14" viewBox="0 0 17 14" fill="none" aria-hidden>
                <path d="M15 7H2" stroke={ST.text} strokeWidth="2.2" strokeLinecap="round" />
                <path d="M7 2L2 7l5 5" stroke={ST.text} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>

            <div className="flex-1 text-center">
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 20,
                  letterSpacing: '1.4px',
                  color: ST.text,
                  textTransform: 'uppercase',
                  lineHeight: 1,
                }}
              >
                Cardápio
              </div>
              <div
                style={{
                  fontSize: 9.5,
                  letterSpacing: '2.6px',
                  color: ST.muted2,
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  marginTop: 3,
                }}
              >
                {storeName} · Delivery
              </div>
              <button
                type="button"
                onClick={() => setStoreSwitch(true)}
                style={{
                  marginTop: 4,
                  fontSize: 10,
                  letterSpacing: '1.4px',
                  color: ST.primary,
                  textTransform: 'uppercase',
                  fontWeight: 700,
                }}
              >
                Trocar de loja
              </button>
            </div>

            <button
              onClick={openProfile}
              aria-label="A minha conta"
              className="flex items-center justify-center overflow-hidden"
              style={{ width: 36, height: 36, borderRadius: 999, background: ST.surface2, flex: 'none' }}
            >
              <Image
                src={ST.logoImage}
                alt={brand.name}
                width={34}
                height={34}
                style={{ width: 34, height: 34, objectFit: 'contain', objectPosition: 'center top' }}
              />
            </button>
          </div>

          {/* Categorias — pills de texto, uma activa (protótipo) */}
          {categories.length > 0 && (
            <div id="cardapio" className="flex overflow-x-auto" style={{ gap: 7, padding: '2px 16px 12px' }}>
              {categories
                .filter((c) => c.items.length > 0)
                .map((cat, i) => {
                  // Sem escolha do utilizador, a primeira categoria é a activa
                  // — é a que a lista mostra.
                  const on = activeCategory ? activeCategory === cat.id : i === 0;
                  return (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(cat.id)}
                      aria-pressed={on}
                      style={{
                        flex: 'none',
                        padding: '9px 14px',
                        borderRadius: 999,
                        background: on ? ST.grad : 'transparent',
                        border: on ? '1px solid transparent' : '1px solid rgba(42,23,16,.14)',
                        fontFamily: 'var(--font-display)',
                        fontSize: 12.5,
                        letterSpacing: '1.2px',
                        color: on ? ST.text : ST.muted3,
                        textTransform: 'uppercase',
                        whiteSpace: 'nowrap',
                        boxShadow: on ? '0 5px 12px rgba(232,135,26,.3)' : 'none',
                      }}
                    >
                      {cat.name}
                    </button>
                  );
                })}
            </div>
          )}
        </header>

        {/* Cupom promocional — configurável no admin */}
        {(promoBannerUrl || promoCode) && !promoDismissed && (
          <div className="px-4 -mt-6 relative z-10">
            <div className="rounded-2xl overflow-hidden flex items-stretch shadow-xl" style={{ background: 'var(--st-card)', border: '1px solid var(--st-line)' }}>
              {promoBannerUrl && (
                <div className="relative w-28 shrink-0">
                  <Image src={promoBannerUrl} alt="Cupom" fill sizes="112px" className="object-cover" />
                </div>
              )}
              <div className="flex-1 p-3 min-w-0">
                <p className="text-[11px] font-semibold mb-1" style={{ color: 'var(--st-muted)' }}>Use o cupom:</p>
                {promoCode && (
                  <button
                    onClick={copyPromoCode}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-1 mb-1"
                    style={{ background: 'var(--st-card)', border: '1px solid var(--st-line)' }}
                    aria-label="Copiar código"
                  >
                    <span className="font-mono font-extrabold text-sm tracking-wider">{promoCode}</span>
                    <span className="text-[14px]">{promoCopied ? '✓' : '⧉'}</span>
                  </button>
                )}
                <p className="text-[10px] leading-tight" style={{ color: 'var(--st-muted)' }}>
                  Válido apenas para a primeira compra. Não cumulativo com outras promoções.
                </p>
              </div>
              <button onClick={dismissPromo} className="w-8 shrink-0 grid place-items-center text-lg" style={{ color: 'var(--st-muted)' }} aria-label="Fechar">✕</button>
            </div>
          </div>
        )}

        {/* Barra de código de amigo (F5.2) */}
        <div className="px-5 pt-4">
          {appliedCode ? (
            <div className="flex items-center justify-between rounded-2xl px-4 py-3" style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid #22c55e44' }}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[#22c55e] text-lg">✓</span>
                <div className="min-w-0">
                  <span className="text-[#22c55e] font-bold text-sm">{appliedCode}</span>
                  {refResult?.reward_type === 'discount_cents' && (
                    <span className="block text-[11px]" style={{ color: 'var(--st-muted)' }}>
                      Desconto: -{mt(refResult.reward_value ?? 0)}
                    </span>
                  )}
                  {refResult?.reward_type === 'discount_pct' && (
                    <span className="block text-[11px]" style={{ color: 'var(--st-muted)' }}>
                      Desconto: -{refResult.reward_value}%
                    </span>
                  )}
                  {refResult?.reward_type === 'free_item' && (
                    <span className="block text-[11px]" style={{ color: 'var(--st-muted)' }}>
                      🎁 {refResult.gift_item_name ?? 'Brinde'} adicionado ao carrinho
                    </span>
                  )}
                </div>
              </div>
              <button onClick={removeReferral} className="text-sm shrink-0 ml-3" style={{ color: 'var(--st-muted)' }} aria-label="Remover código">✕</button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={refInput}
                onChange={(e) => setRefInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && applyReferral()}
                placeholder="Código do teu amigo 🎁"
                maxLength={50}
                className="flex-1 bg-[var(--st-card)] border border-[var(--st-line)] rounded-xl px-4 py-2.5 placeholder:text-[var(--st-muted)] text-sm focus:border-[var(--st-primary)] focus:outline-none"
                aria-label="Código de referral"
              />
              <button
                onClick={applyReferral}
                disabled={refLoading || !refInput.trim()}
                className="px-4 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-[0.97] disabled:opacity-50 shrink-0"
                style={{ background: 'var(--st-grad)' }}
              >
                {refLoading ? '…' : 'Aplicar'}
              </button>
            </div>
          )}
          {refResult && !refResult.valid && (
            <p className="mt-1.5 text-xs px-1" style={{ color: 'var(--st-primary)' }}>
              {refResult.reason === 'auto_redemption'    ? 'Não podes usar o teu próprio código.' :
               refResult.reason === 'already_redeemed'  ? 'Já usaste este código antes.' :
               refResult.reason === 'max_redemptions_reached' ? 'Este código atingiu o limite de utilizações.' :
               'Código inválido ou expirado.'}
            </p>
          )}
        </div>

        {/* SEU PRESENTE — visível quando código free_item aplicado */}
        {refResult?.valid && refResult.reward_type === 'free_item' && refResult.gift_item_id && (
          <div className="px-5 pt-4">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="font-bold text-base">🎁 SEU PRESENTE</span>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
              <div className="shrink-0 w-[150px] rounded-2xl overflow-hidden" style={{ background: 'var(--st-card)', border: '1px solid #22c55e44' }}>
                {refResult.gift_item_photo_url ? (
                  <div className="relative h-[108px]">
                    <Image src={refResult.gift_item_photo_url} alt={refResult.gift_item_name ?? 'Brinde'} fill sizes="150px" className="object-cover" />
                  </div>
                ) : (
                  <div className="h-[108px] grid place-items-center text-4xl" style={{ background: 'rgba(34,197,94,0.12)' }}>🎁</div>
                )}
                <div className="p-2.5">
                  <div className="font-bold text-[13px] leading-tight truncate">{refResult.gift_item_name ?? 'Brinde'}</div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="font-extrabold text-[13px]" style={{ color: '#22c55e' }}>GRÁTIS</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Cardápio — uma categoria de cada vez, como no protótipo */}
        {(() => {
          const shown = categories.filter((c) => c.items.length > 0);
          if (shown.length === 0) {
            return (
              <p className="py-12 text-center" style={{ color: ST.muted }}>
                Cardápio em breve.
              </p>
            );
          }
          const cat = shown.find((c) => c.id === activeCategory) ?? shown[0];
          return (
            <div style={{ padding: '18px 16px 0' }}>
              <div className="flex items-center" style={{ gap: 10, marginBottom: 14 }}>
                <h2
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 22,
                    letterSpacing: '1px',
                    color: ST.text,
                    textTransform: 'uppercase',
                  }}
                >
                  {cat.name}
                </h2>
                <div style={{ flex: 1, height: 1, background: 'rgba(42,23,16,.12)' }} />
                <div style={{ color: ST.star, fontSize: 9, letterSpacing: '3px' }}>★★★</div>
              </div>

              <div className="flex flex-col" style={{ gap: 11 }}>
                {cat.items.map((item) => (
                  <ItemCard key={item.id} item={item} />
                ))}
              </div>

              <div style={{ marginTop: 20, textAlign: 'center', fontSize: 11, color: ST.faint }}>
                Preços em MT · taxa de entrega calculada no checkout
              </div>
            </div>
          );
        })()}
      </div>

      {/* Pill flutuante do carrinho (protótipo: canto inferior direito) */}
      {count > 0 && !cartOpen && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed z-20 flex items-center"
          style={{
            right: 'max(16px, calc(50vw - 199px))',
            bottom: 46,
            gap: 11,
            padding: '13px 18px 13px 14px',
            background: ST.text,
            borderRadius: 999,
            boxShadow: '0 14px 30px rgba(42,23,16,.4)',
            border: '1.5px solid rgba(245,166,35,.5)',
          }}
        >
          <span
            className="flex items-center justify-center"
            style={{
              width: 30,
              height: 30,
              borderRadius: 999,
              background: ST.primary,
              fontFamily: 'var(--font-display)',
              fontSize: 14,
              color: ST.text,
            }}
          >
            {count}
          </span>
          <span className="flex flex-col text-left" style={{ lineHeight: 1.15 }}>
            <span
              style={{
                fontSize: 8.5,
                letterSpacing: '2px',
                color: ST.onDarkMuted,
                textTransform: 'uppercase',
                fontWeight: 600,
              }}
            >
              Ver pedido
            </span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: ST.primary }}>{mt(subtotal)}</span>
          </span>
        </button>
      )}

      {/* Drawer do carrinho — painel lateral do protótipo */}
      {cartOpen && (
        <div className="fixed inset-0 z-30" role="dialog" aria-modal="true">
          <button
            aria-label="Fechar"
            onClick={() => setCartOpen(false)}
            className="absolute inset-0 w-full"
            style={{ background: 'rgba(42,23,16,.55)', backdropFilter: 'blur(2px)' }}
          />
          <div
            className="absolute inset-y-0 right-0 flex w-full max-w-[340px] flex-col"
            style={{ background: ST.bg, boxShadow: '-14px 0 40px rgba(42,23,16,.3)' }}
          >
            <div className="flex items-center" style={{ padding: '58px 18px 14px', background: ST.text, gap: 12 }}>
              <div className="flex-1">
                <h2
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 20,
                    letterSpacing: '1.2px',
                    color: ST.onDark,
                    textTransform: 'uppercase',
                    lineHeight: 1,
                  }}
                >
                  O seu pedido
                </h2>
                <div
                  style={{
                    fontSize: 10,
                    letterSpacing: '2.2px',
                    color: ST.primary,
                    textTransform: 'uppercase',
                    fontWeight: 600,
                    marginTop: 4,
                  }}
                >
                  Delivery · Maputo
                </div>
              </div>
              <button
                onClick={() => setCartOpen(false)}
                aria-label="Fechar"
                className="flex items-center justify-center"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 999,
                  border: '1px solid rgba(255,253,248,.25)',
                  flex: 'none',
                }}
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                  <path d="M1.5 1.5l10 10M11.5 1.5l-10 10" stroke={ST.onDark} strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto" style={{ padding: '16px 18px' }}>
              {cart.length === 0 && <p className="text-center py-8" style={{ color: 'var(--st-muted)' }}>Carrinho vazio</p>}
              {cart.map((line, idx) => {
                const isGift = giftItemIds.has(line.menuItemId);
                const it = lineDetail(line.menuItemId);
                if (!it && !isGift) return null;

                if (isGift) {
                  return (
                    <div key={idx} className="flex items-center gap-3 rounded-2xl p-3" style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid #22c55e44' }}>
                      <div className="w-14 h-14 rounded-xl grid place-items-center text-3xl shrink-0" style={{ background: 'rgba(34,197,94,0.18)' }}>🎁</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{refResult?.gift_item_name ?? 'Brinde'}</p>
                        <p className="text-sm font-bold" style={{ color: '#22c55e' }}>GRÁTIS</p>
                      </div>
                      <button onClick={() => setQtyByIndex(idx, 0)} className="w-6 h-6 grid place-items-center text-sm" style={{ color: 'var(--st-muted)' }} aria-label="Remover brinde">✕</button>
                    </div>
                  );
                }

                const variant = line.variantId ? it!.variants?.find((v) => v.id === line.variantId) : undefined;
                const addons = (it!.addons ?? []).filter((a) => (line.addonIds ?? []).includes(a.id));
                const unit = lineUnitPrice(it!, line.variantId, line.addonIds, selectionsOf(line));
                return (
                  <div
                    key={idx}
                    className="flex"
                    style={{ gap: 11, paddingBottom: 12, borderBottom: '1px solid rgba(42,23,16,.09)' }}
                  >
                    <div
                      className="relative overflow-hidden"
                      style={{ width: 54, height: 54, borderRadius: 10, background: ST.photoBg, flex: 'none' }}
                    >
                      <Image src={imgFor(it!, globalIndex(it!.id))} alt={it!.name} fill sizes="54px" className="object-cover" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div
                        style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: 14,
                          letterSpacing: '.5px',
                          color: ST.text,
                          textTransform: 'uppercase',
                          lineHeight: 1.1,
                        }}
                      >
                        {it!.name}
                      </div>
                      <div style={{ fontSize: 10.5, color: ST.muted2, lineHeight: 1.4, marginTop: 3 }}>
                        {[variant?.name, ...addons.map((a) => a.name), selectionLabel(it!, line)]
                          .filter(Boolean)
                          .join(' · ') || 'Simples'}
                      </div>
                      <div className="flex items-center justify-between" style={{ marginTop: 7 }}>
                        <div
                          className="flex items-center"
                          style={{ gap: 10, padding: '3px 4px', border: '1px solid rgba(42,23,16,.14)', borderRadius: 999 }}
                        >
                          <button
                            onClick={() => setQtyByIndex(idx, line.qty - 1)}
                            aria-label="Diminuir"
                            className="flex items-center justify-center"
                            style={{ width: 22, height: 22, borderRadius: 999, color: ST.muted3, fontSize: 15 }}
                          >
                            −
                          </button>
                          <span
                            style={{
                              fontFamily: 'var(--font-display)',
                              fontSize: 13,
                              color: ST.text,
                              minWidth: 9,
                              textAlign: 'center',
                            }}
                          >
                            {line.qty}
                          </span>
                          <button
                            onClick={() => setQtyByIndex(idx, line.qty + 1)}
                            aria-label="Aumentar"
                            className="flex items-center justify-center"
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: 999,
                              background: ST.primary,
                              color: ST.text,
                              fontSize: 14,
                              fontWeight: 700,
                            }}
                          >
                            +
                          </button>
                        </div>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: ST.primary2 }}>
                          {mt(unit * line.qty)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ padding: '16px 18px 40px', background: ST.card, borderTop: `1px solid ${ST.line}` }}>
              <div className="flex justify-between" style={{ fontSize: 12.5, color: ST.muted3, marginBottom: 5 }}>
                <span>Subtotal</span>
                <span style={{ fontWeight: 600, color: ST.text }}>{mt(subtotal)}</span>
              </div>
              <div className="flex justify-between" style={{ fontSize: 12.5, color: ST.muted3 }}>
                <span>Entrega</span>
                <span style={{ fontWeight: 600, color: ST.text }}>no checkout</span>
              </div>
              <div
                className="flex items-baseline justify-between"
                style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed rgba(42,23,16,.18)' }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 14,
                    letterSpacing: '1.2px',
                    color: ST.text,
                    textTransform: 'uppercase',
                  }}
                >
                  Total previsto
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: ST.primary2 }}>
                  {mt(subtotal)}
                </span>
              </div>
              <div style={{ fontSize: 9.5, color: ST.faint, marginTop: 5 }}>
                Valor final confirmado pelo servidor no checkout.
              </div>
              <button
                onClick={() => router.push('/checkout')}
                disabled={cart.length === 0}
                className="w-full disabled:opacity-50"
                style={{
                  marginTop: 12,
                  padding: 15,
                  borderRadius: 14,
                  background: ST.grad,
                  textAlign: 'center',
                  fontFamily: 'var(--font-display)',
                  fontSize: 15,
                  letterSpacing: '1.6px',
                  color: ST.text,
                  textTransform: 'uppercase',
                  boxShadow: '0 10px 22px rgba(232,135,26,.32)',
                }}
              >
                Ir para checkout
              </button>
              <button
                onClick={() => {
                  clear();
                  setCartOpen(false);
                }}
                className="w-full"
                style={{ marginTop: 8, fontSize: 11.5, color: ST.faint }}
              >
                Limpar carrinho
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Produto (F2) — overlay full-screen, fiel ao schema plano (sem variantes) */}
      {product && (
        <div className="fixed inset-0 z-40 mx-auto w-full max-w-[430px]">
          <button
            aria-label="Fechar"
            onClick={() => setProduct(null)}
            className="absolute inset-0 w-full"
            style={{ background: 'rgba(42,23,16,.6)', backdropFilter: 'blur(2px)' }}
          />
          <div
            className="absolute inset-x-0 bottom-0 flex flex-col overflow-hidden"
            style={{
              top: 44,
              background: ST.bg,
              borderRadius: '26px 26px 0 0',
              boxShadow: '0 -14px 40px rgba(42,23,16,.34)',
            }}
          >
            {/* foto + nome */}
            <div className="relative" style={{ height: 180, flex: 'none', background: ST.photoBg }}>
              <Image src={imgFor(product, globalIndex(product.id))} alt={product.name} fill sizes="430px" className="object-cover" />
              <div
                className="absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(42,23,16,.35) 0%, rgba(42,23,16,0) 40%, rgba(42,23,16,.7) 100%)',
                }}
              />
              <button
                onClick={() => setProduct(null)}
                aria-label="Fechar"
                className="absolute flex items-center justify-center"
                style={{ top: 14, right: 14, width: 34, height: 34, borderRadius: 999, background: 'rgba(42,23,16,.62)' }}
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                  <path d="M1.5 1.5l10 10M11.5 1.5l-10 10" stroke={ST.onDark} strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              <div className="absolute" style={{ left: 18, bottom: 14, right: 18 }}>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 28,
                    lineHeight: 0.96,
                    letterSpacing: '.6px',
                    color: ST.onDark,
                    textTransform: 'uppercase',
                  }}
                >
                  {product.name}
                </div>
              </div>
            </div>

            {/* conteúdo */}
            <div className="flex-1 overflow-y-auto" style={{ padding: '16px 18px 18px' }}>
              {product.description && (
                <p style={{ fontSize: 13.5, lineHeight: 1.55, color: ST.muted, marginBottom: 12 }}>
                  {product.description}
                </p>
              )}

              {/* Calorias e alérgenos. Valores de orientação — nunca afirmamos
                  ausência de alérgeno, só declaramos os que o prato tem. */}
              {(product.calories_kcal || (product.allergens?.length ?? 0) > 0) && (
                <div
                  style={{
                    marginBottom: 18,
                    padding: '11px 13px',
                    borderRadius: 12,
                    background: ST.card,
                    border: `1px solid ${ST.line}`,
                  }}
                >
                  {product.calories_kcal ? (
                    <div className="flex items-baseline" style={{ gap: 6 }}>
                      <span
                        style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: 15,
                          color: ST.text,
                          letterSpacing: '.4px',
                        }}
                      >
                        ~{product.calories_kcal} kcal
                      </span>
                      <span style={{ fontSize: 10.5, color: ST.faint }}>por dose, valor aproximado</span>
                    </div>
                  ) : null}

                  {(product.allergens?.length ?? 0) > 0 && (
                    <div style={{ marginTop: product.calories_kcal ? 8 : 0 }}>
                      <div
                        style={{
                          fontSize: 9.5,
                          letterSpacing: '2px',
                          color: ST.muted2,
                          textTransform: 'uppercase',
                          fontWeight: 700,
                          marginBottom: 6,
                        }}
                      >
                        Contém
                      </div>
                      <div className="flex flex-wrap" style={{ gap: 6 }}>
                        {product.allergens?.map((a) => (
                          <span
                            key={a}
                            style={{
                              padding: '4px 9px',
                              borderRadius: 999,
                              background: 'rgba(232,135,26,.12)',
                              border: '1px solid rgba(232,135,26,.35)',
                              fontSize: 11,
                              color: ST.primary2,
                              fontWeight: 600,
                            }}
                          >
                            {a}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <p style={{ fontSize: 10, lineHeight: 1.45, color: ST.faint, marginTop: 9 }}>
                    Tem alguma alergia? Fale connosco antes de pedir — confirmamos os ingredientes com a cozinha.
                  </p>
                </div>
              )}

              {/* Escolhas do prato (acompanhamentos, molho, tipo de ovo…) */}
              {(product.modifier_groups ?? []).map((g) => {
                const ids = selMods[g.id] ?? [];
                const badge =
                  g.selection_type === 'single'
                    ? `Escolha ${g.min_select > 0 ? g.min_select : 1}`
                    : g.free_quantity > 0
                      ? `${ids.length} / ${g.free_quantity} grátis`
                      : g.min_select > 0
                        ? `Escolha ${g.min_select}`
                        : 'Opcional';
                const over = Math.max(ids.length - g.free_quantity, 0);
                const hint =
                  g.free_quantity > 0 && g.extra_price_cents > 0
                    ? over > 0
                      ? `Mais ${over} — extra ${mt(g.extra_price_cents)} cada (+${mt(over * g.extra_price_cents)})`
                      : `Até ${g.free_quantity} grátis · extra ${mt(g.extra_price_cents)} cada`
                    : g.min_select > 0
                      ? 'Escolha obrigatória'
                      : 'Toque para juntar ao prato';
                return (
                  <div key={g.id} style={{ marginBottom: 20 }}>
                    <div className="flex items-baseline justify-between" style={{ gap: 10, marginBottom: 4 }}>
                      <div
                        style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: 17,
                          letterSpacing: '1px',
                          color: ST.text,
                          textTransform: 'uppercase',
                        }}
                      >
                        {g.name}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          letterSpacing: '1.6px',
                          color: ST.primary2,
                          textTransform: 'uppercase',
                          fontWeight: 700,
                        }}
                      >
                        {badge}
                      </div>
                    </div>
                    <div style={{ fontSize: 11.5, color: ST.muted2, marginBottom: 10 }}>{hint}</div>

                    <div className="flex flex-col" style={{ gap: 7 }}>
                      {g.options.map((o) => {
                        const sel = ids.includes(o.id);
                        const price =
                          o.price_cents > 0
                            ? `+ ${mt(o.price_cents)}`
                            : g.free_quantity > 0 && g.extra_price_cents > 0 && !sel && ids.length >= g.free_quantity
                              ? `+ ${mt(g.extra_price_cents)}`
                              : 'Grátis';
                        return (
                          <button
                            key={o.id}
                            onClick={() => toggleMod(g, o.id)}
                            className="flex items-center text-left"
                            style={{
                              gap: 11,
                              padding: '12px 13px',
                              borderRadius: 13,
                              background: sel ? '#FFF6E4' : ST.card,
                              border: sel ? `1.5px solid ${ST.primary}` : '1px solid rgba(42,23,16,.12)',
                            }}
                          >
                            <span
                              className="flex items-center justify-center"
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: 999,
                                flex: 'none',
                                background: sel ? ST.grad : 'transparent',
                                border: sel ? 'none' : '1.5px solid rgba(42,23,16,.2)',
                              }}
                            >
                              {sel && (
                                <svg width="11" height="9" viewBox="0 0 11 9" fill="none" aria-hidden>
                                  <path
                                    d="M1.5 4.6L4 7l5.2-5.4"
                                    stroke={ST.text}
                                    strokeWidth="2.1"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              )}
                            </span>
                            <span
                              className="flex-1"
                              style={{ fontSize: 13.5, color: sel ? ST.text : ST.textSoft, fontWeight: sel ? 600 : 400 }}
                            >
                              {o.name}
                            </span>
                            <span
                              style={{
                                fontSize: 11.5,
                                color: sel ? ST.primary2 : ST.muted2,
                                fontWeight: sel ? 700 : 400,
                              }}
                            >
                              {price}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {modError && (
                <p style={{ fontSize: 12.5, color: ST.primary2, marginBottom: 12 }} role="alert">
                  {modError}
                </p>
              )}

              {/* Tamanho (variantes) — escolha única. Só aparece se o item tiver variantes. */}
              {product.variants && product.variants.length > 0 && (
                <div className="mb-5">
                  <p className="font-bold text-sm mb-2.5">Escolha o tamanho</p>
                  <div className="space-y-2" style={{ perspective: '1000px' }}>
                    {product.variants.map((v) => {
                      const sel = selVariant === v.id;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setSelVariant(v.id)}
                          aria-pressed={sel}
                          className={`glass-opt w-full flex items-center justify-between px-4 py-3${sel ? ' is-selected' : ''}`}
                        >
                          <span className="glass-label text-sm">{v.name}</span>
                          <span className="flex items-center gap-2">
                            <span className="font-bold text-sm">{mt(v.price_cents)}</span>
                            {sel && <span className="w-5 h-5 rounded-full grid place-items-center text-[11px] font-bold" style={{ background: 'var(--st-grad)' }}>✓</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Adicionais — multi-seleção (upsell). Só aparece se o item tiver adicionais. */}
              {product.addons && product.addons.length > 0 && (
                <div className="mb-5">
                  <p className="font-bold text-sm mb-2.5">Adicionais</p>
                  <div className="flex flex-wrap gap-2" style={{ perspective: '1000px' }}>
                    {product.addons.map((a) => {
                      const sel = selAddons.includes(a.id);
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => setSelAddons((prev) => sel ? prev.filter((x) => x !== a.id) : [...prev, a.id])}
                          aria-pressed={sel}
                          className={`glass-opt pill px-3.5 py-2 text-[12.5px]${sel ? ' is-selected' : ''}`}
                        >
                          <span className="glass-label">{sel ? '✓ ' : '+ '}{a.name}</span>
                          <span className="ml-1" style={{ color: 'var(--st-primary)' }}>+{mt(a.price_cents)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-baseline gap-1 mb-5">
                <span className="font-black text-4xl">{mt(lineUnitPrice(product, selVariant, selAddons, selMods))}</span>
              </div>
            </div>

            {/* barra adicionar */}
            <div
              className="flex items-center"
              style={{
                flex: 'none',
                padding: '14px 18px 40px',
                background: ST.card,
                borderTop: `1px solid ${ST.line}`,
                gap: 12,
              }}
            >
              <div
                className="flex items-center"
                style={{
                  gap: 12,
                  padding: '5px 6px',
                  border: '1px solid rgba(42,23,16,.14)',
                  borderRadius: 999,
                  flex: 'none',
                }}
              >
                <button
                  onClick={() => setProductQty((q) => Math.max(1, q - 1))}
                  aria-label="Diminuir"
                  style={{ width: 28, height: 28, borderRadius: 999, color: ST.muted3, fontSize: 18 }}
                >
                  −
                </button>
                <span
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 15,
                    color: ST.text,
                    minWidth: 11,
                    textAlign: 'center',
                  }}
                >
                  {productQty}
                </span>
                <button
                  onClick={() => setProductQty((q) => q + 1)}
                  aria-label="Aumentar"
                  className="flex items-center justify-center"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    background: ST.primary,
                    color: ST.text,
                    fontSize: 16,
                    fontWeight: 700,
                  }}
                >
                  +
                </button>
              </div>
              <button
                onClick={() => {
                  // O servidor recusa o pedido se um grupo obrigatório vier
                  // incompleto — vale a pena travar aqui, com a razão à vista.
                  for (const g of product.modifier_groups ?? []) {
                    const n = (selMods[g.id] ?? []).length;
                    if (n < g.min_select) {
                      setModError(
                        g.min_select === 1
                          ? `Escolhe uma opção em "${g.name}".`
                          : `Escolhe ${g.min_select} opções em "${g.name}".`,
                      );
                      return;
                    }
                  }
                  const modifiers = Object.entries(selMods)
                    .filter(([, optionIds]) => optionIds.length > 0)
                    .map(([groupId, optionIds]) => ({ groupId, optionIds }));
                  const unit = lineUnitPrice(product, selVariant, selAddons, selMods);
                  add(product.id, productQty, { variantId: selVariant, addonIds: selAddons, modifiers });
                  trackAddToCart({ id: product.id, name: product.name, price_cents: unit, qty: productQty });
                  const name = product.name;
                  setProduct(null);
                  setToast(`${productQty}× ${name} no carrinho`);
                }}
                className="flex-1"
                style={{
                  padding: '16px 14px',
                  borderRadius: 14,
                  background: ST.grad,
                  textAlign: 'center',
                  fontFamily: 'var(--font-display)',
                  fontSize: 14.5,
                  letterSpacing: '1.2px',
                  color: ST.text,
                  textTransform: 'uppercase',
                  boxShadow: '0 10px 22px rgba(232,135,26,.32)',
                }}
              >
                Adicionar · {mt(lineUnitPrice(product, selVariant, selAddons, selMods) * productQty)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Conta (F7): identificar / Meus Pedidos / Perfil */}
      {account === 'identify' && <IdentifyModal onClose={() => setAccount(null)} onSubmit={onIdentified} />}
      {account === 'orders' && (
        <OrdersOverlay orders={myOrders} onClose={() => setAccount(null)} onOpen={(id) => router.push(`/order-status/${id}`)} onReorder={reorder} />
      )}
      {account === 'profile' && customer && (
        <ProfileOverlay customer={customer} onClose={() => setAccount(null)} onLogout={logout} onReorder={reorder}
          onOrders={openOrders} />
      )}

      {/* Troca de loja — o carrinho é de uma loja só (preços e stock diferem) */}
      {storeSwitch && (
        <StoreSwitchDialog
          currentSlug={storeSlug}
          onClose={() => setStoreSwitch(false)}
          onConfirm={(slug) => {
            clear();
            document.cookie = serializeStoreCookie(slug);
            setStoreSwitch(false);
            router.push(`/l/${slug}`);
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-[96px] left-1/2 -translate-x-1/2 z-[60] rounded-full px-4 py-2 text-sm" style={{ background: 'var(--st-text)', color: ST.onDark, border: '1px solid rgba(245,166,35,.4)' }}>
          {toast}
        </div>
      )}
    </Shell>
  );
}

/**
 * Trocar de loja limpa o carrinho: preços, taxas e stock são de outra unidade
 * (CLAUDE §5.5). O aviso é explícito antes de qualquer coisa desaparecer.
 */
function StoreSwitchDialog({
  currentSlug,
  onClose,
  onConfirm,
}: {
  currentSlug: string;
  onClose: () => void;
  onConfirm: (slug: string) => void;
}) {
  const [stores, setStores] = useState<PublicStoreOption[]>([]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const response = await fetch('/api/stores', { cache: 'no-store' });
      if (!response.ok || !active) return;
      const body = (await response.json()) as { stores: PublicStoreOption[] };
      if (active) setStores(body.stores ?? []);
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-5" style={{ background: 'rgba(0,0,0,.72)' }}>
      <div className="w-full max-w-[420px] rounded-2xl p-5" style={{ background: ST.card, border: `1px solid ${ST.line}` }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 19, color: ST.text, textTransform: 'uppercase' }}>
          Trocar de loja
        </h2>
        <p className="mt-2 text-sm" style={{ color: ST.muted }}>
          Cada loja tem o seu cardápio, as suas zonas de entrega e o seu stock. Ao trocar de loja,
          <strong style={{ color: ST.text }}> o teu carrinho é esvaziado</strong>.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          {stores.map((store) => (
            <button
              key={store.slug}
              type="button"
              disabled={store.slug === currentSlug}
              onClick={() => onConfirm(store.slug)}
              className="w-full text-left"
              style={{
                padding: '14px 16px',
                borderRadius: 14,
                border: `1px solid ${store.slug === currentSlug ? ST.primary : ST.line}`,
                background: store.slug === currentSlug ? 'rgba(229,169,60,.08)' : 'transparent',
                opacity: store.slug === currentSlug ? 0.7 : 1,
              }}
            >
              <span className="block font-bold" style={{ color: ST.text }}>
                {store.short_name}
                {store.slug === currentSlug ? ' · loja actual' : ''}
              </span>
              <span className="block text-xs" style={{ color: ST.muted2 }}>
                {store.accepting_orders
                  ? store.open_now
                    ? 'Aberta agora'
                    : 'Fechada agora · aceita agendamento'
                  : 'Não está a aceitar pedidos'}
              </span>
            </button>
          ))}
          {stores.length === 0 && (
            <p className="text-sm" style={{ color: ST.muted2 }}>A carregar lojas…</p>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full"
          style={{ padding: '12px 14px', borderRadius: 12, border: `1px solid ${ST.line}`, color: ST.muted }}
        >
          Manter esta loja
        </button>
      </div>
    </div>
  );
}

// Coluna app centrada (mobile-first; centrada no desktop)
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto w-full max-w-[480px] min-h-screen" style={{ background: 'var(--st-bg)', fontFamily: 'var(--font-store)' }}>
      {children}
    </div>
  );
}

// ── Conta (F7): wrapper de overlay full-screen ────────────────────────────────
function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="mx-auto w-full max-w-[480px] h-full flex flex-col" style={{ background: 'var(--st-bg)' }}>
        <header className="flex items-center gap-3 px-4 py-4 border-b shrink-0" style={{ borderColor: 'var(--st-line)' }}>
          <button onClick={onClose} className="text-2xl leading-none" aria-label="Voltar">←</button>
          <h1 className="text-xl font-extrabold">{title}</h1>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

// Identificação soft (telefone, sem OTP). DECISÃO: só mostramos resumos deste telefone (CLAUDE §9).
function IdentifyModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (phone: string, name?: string) => void | Promise<void> }) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const input = 'w-full rounded-xl p-3 placeholder:text-[var(--st-muted)] focus:outline-none focus:border-[var(--st-primary)] border border-[var(--st-line)]';
  const inputStyle = { background: 'var(--st-bg)' } as React.CSSProperties;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.trim().length < 6) return;
    setBusy(true);
    await onSubmit(phone.trim(), name.trim() || undefined);
    setBusy(false);
  };
  return (
    <div className="fixed inset-0 z-50 backdrop-blur-[4px] flex items-end sm:items-center justify-center" style={{ background: 'rgba(42,23,16,.6)' }}>
      <div className="w-full max-w-[480px] rounded-t-3xl sm:rounded-3xl p-6" style={{ background: 'var(--st-card)', border: '1px solid var(--st-line)' }}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-extrabold text-xl">Entrar</h2>
          <button onClick={onClose} className="text-xl" style={{ color: 'var(--st-muted)' }} aria-label="Fechar">✕</button>
        </div>
        <p className="text-sm mb-5" style={{ color: 'var(--st-muted)' }}>Identifica-te com o teu telefone para veres os teus pedidos e favoritos.</p>
        <form onSubmit={submit} className="space-y-3">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="Telefone (+258 …)" className={input} style={inputStyle} required />
          <input value={name} onChange={(e) => setName(e.target.value)} type="text" placeholder="Nome (opcional)" className={input} style={inputStyle} />
          <button type="submit" disabled={busy || phone.trim().length < 6} className="w-full font-extrabold py-3.5 rounded-2xl disabled:opacity-50" style={{ background: 'var(--st-grad)' }}>{busy ? 'A entrar…' : 'Entrar'}</button>
          <button type="button" onClick={onClose} className="w-full py-2 text-sm" style={{ color: 'var(--st-muted)' }}>Agora não</button>
        </form>
      </div>
    </div>
  );
}

// Meus Pedidos (resumos por telefone; "pedir de novo")
function OrdersOverlay({ orders, onClose, onOpen, onReorder }: { orders: CustomerOrder[] | null; onClose: () => void; onOpen: (id: string) => void; onReorder: (items: ReorderItem[]) => void }) {
  const all = orders ?? [];
  const active = all.filter((o) => isActiveOrder(o.status));
  const history = all.filter((o) => !isActiveOrder(o.status));
  const Card = (o: CustomerOrder) => {
    const m = ORDER_STATUS[o.status] ?? { label: o.status, color: '#888' };
    return (
      <div key={o.id} className="rounded-2xl p-3.5" style={{ background: 'var(--st-card)', border: '1px solid var(--st-line)' }}>
        <div className="flex items-start justify-between">
          <button onClick={() => onOpen(o.id)} className="text-left">
            <div className="font-mono font-bold">{o.order_number}</div>
            <div className="text-[11px]" style={{ color: 'var(--st-muted)' }}>
              {new Date(o.created_at).toLocaleDateString('pt-MZ', { day: '2-digit', month: 'short', year: 'numeric' })} · {o.items.reduce((s, it) => s + it.qty, 0)} itens
            </div>
          </button>
          <span className="text-xs font-bold inline-flex items-center gap-1.5" style={{ color: m.color }}><span className="w-2 h-2 rounded-full bg-current" />{m.label}</span>
        </div>
        <div className="flex items-center justify-between mt-2.5">
          <span className="font-extrabold">{mt(o.total_cents)}</span>
          <div className="flex gap-2">
            <button onClick={() => onOpen(o.id)} className="text-xs font-semibold rounded-xl px-3 py-1.5" style={{ border: '1px solid var(--st-line)', color: 'var(--st-muted-2)' }}>Acompanhar</button>
            <button onClick={() => onReorder(o.items)} className="text-xs font-semibold rounded-xl px-3 py-1.5" style={{ background: 'var(--st-grad)' }}>↻ Repetir</button>
          </div>
        </div>
      </div>
    );
  };
  return (
    <Overlay title="Meus Pedidos" onClose={onClose}>
      {orders === null ? (
        <p className="text-center py-10" style={{ color: 'var(--st-muted)' }}>A carregar…</p>
      ) : all.length === 0 ? (
        <p className="text-center py-10" style={{ color: 'var(--st-muted)' }}>Ainda não há pedidos com este telefone.</p>
      ) : (
        <div className="space-y-5">
          {active.length > 0 && <div><h3 className="font-bold mb-2">Ativos</h3><div className="space-y-2.5">{active.map(Card)}</div></div>}
          {history.length > 0 && <div><h3 className="font-bold mb-2">Histórico</h3><div className="space-y-2.5">{history.map(Card)}</div></div>}
        </div>
      )}
    </Overlay>
  );
}

// Perfil (resumo + favoritos + sair)
function ProfileOverlay({ customer, onClose, onLogout, onOrders, onReorder }: { customer: CustomerSummary; onClose: () => void; onLogout: () => void; onOrders: () => void; onReorder: (items: ReorderItem[]) => void }) {
  const initial = (customer.name || customer.phone || '?').trim()[0]?.toUpperCase() ?? '?';
  return (
    <Overlay title="Perfil" onClose={onClose}>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-14 h-14 rounded-full grid place-items-center text-xl font-extrabold" style={{ background: 'var(--st-grad)' }}>{initial}</div>
        <div>
          <div className="font-extrabold text-lg">{customer.name || 'Cliente'}</div>
          <div className="text-sm" style={{ color: 'var(--st-muted)' }}>{customer.phone}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="rounded-2xl p-3.5 text-center" style={{ background: 'var(--st-card)', border: '1px solid var(--st-line)' }}>
          <div className="font-extrabold text-xl">{customer.orders_count}</div>
          <div className="text-[11px]" style={{ color: 'var(--st-muted)' }}>Pedidos</div>
        </div>
        <div className="rounded-2xl p-3.5 text-center" style={{ background: 'var(--st-card)', border: '1px solid var(--st-line)' }}>
          <div className="font-extrabold text-xl">{mt(customer.total_spent_cents)}</div>
          <div className="text-[11px]" style={{ color: 'var(--st-muted)' }}>Total gasto</div>
        </div>
      </div>
      {customer.favorites.length > 0 && (
        <div className="mb-5">
          <h3 className="font-bold mb-2">Os teus favoritos</h3>
          <div className="space-y-2">
            {customer.favorites.map((f) => (
              <div key={f.menu_item_id} className="flex items-center justify-between rounded-xl p-2.5" style={{ background: 'var(--st-card)', border: '1px solid var(--st-line)' }}>
                <span className="text-sm">{f.name}</span>
                <button onClick={() => onReorder([{ menu_item_id: f.menu_item_id, qty: 1 }])} className="text-xs font-semibold rounded-xl px-3 py-1.5" style={{ background: 'var(--st-grad)' }}>+ Adicionar</button>
              </div>
            ))}
          </div>
        </div>
      )}
      <button onClick={onOrders} className="w-full rounded-2xl py-3.5 font-semibold mb-2.5" style={{ background: 'var(--st-card)', border: '1px solid var(--st-line)' }}>Ver os meus pedidos</button>
      <button onClick={onLogout} className="w-full rounded-2xl py-3.5 font-semibold" style={{ border: '1px solid var(--st-line)', color: 'var(--st-muted)' }}>Sair</button>
    </Overlay>
  );
}

// Loja fechada — lista de espera (reskin The Box)
function WaitlistForm() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !phone) { setError('Por favor, preencha o nome e o telefone'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, notes }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Erro ao adicionar à lista de espera');
      setSubmitted(true);
      trackLead();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao adicionar à lista de espera');
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls = 'w-full rounded-xl p-3 placeholder-gray-500 focus:outline-none';
  const inputStyle = { background: 'var(--st-card)', border: '1px solid var(--st-line)' } as React.CSSProperties;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full">
        <div className="rounded-3xl p-6" style={{ background: 'var(--st-card)', border: '1px solid var(--st-line)' }}>
          <div className="text-center mb-6">
            <div className="font-black text-sm tracking-[2px] rounded-md px-2.5 py-1 inline-block mb-4" style={{ border: '2px solid var(--st-text)' }}>{ST.logoText}</div>
            <h1 className="text-2xl font-bold mb-2">Loja Fechada</h1>
            <p style={{ color: 'var(--st-muted)' }}>Deixe o seu contacto e avisamos quando abrirmos!</p>
          </div>
          {submitted ? (
            <div className="text-center py-8">
              <div className="text-5xl mb-4">✅</div>
              <p className="text-lg font-semibold" style={{ color: 'var(--st-primary)' }}>Adicionado à lista de espera!</p>
              <p className="mt-2" style={{ color: 'var(--st-muted)' }}>Avisaremos quando a loja abrir.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" className={inputCls} style={inputStyle} required />
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+258 84 123 4567" className={inputCls} style={inputStyle} required />
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Alguma observação? (opcional)" rows={3} className={inputCls} style={inputStyle} />
              {error && (
                <div className="rounded-xl p-3" style={{ background: 'rgba(232,23,77,0.1)', border: '1px solid rgba(232,23,77,0.3)' }}>
                  <p className="text-sm text-center" style={{ color: 'var(--st-primary)' }}>{error}</p>
                </div>
              )}
              <button type="submit" disabled={submitting || !name || !phone} className="w-full font-bold py-3 px-4 rounded-2xl disabled:opacity-50" style={{ background: 'var(--st-grad)' }}>
                {submitting ? 'A enviar…' : 'Adicionar à Lista'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
