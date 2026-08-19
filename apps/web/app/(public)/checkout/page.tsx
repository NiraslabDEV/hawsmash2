'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { formatMT, type Cents } from '@delivery/core';
import { createClient } from '@/utils/supabase/client';
import { useStoreSlug } from '@/utils/useStore';
import { buildScheduleSlots, type StoreHour } from '@/lib/store-hours';
import { trackBeginCheckout, trackAddPaymentInfo, type TrackItem } from '@/lib/analytics/track';

type PaymentFlow   = 'manual' | 'auto';
type ManualMethod  = 'mpesa' | 'emola';
type AutoMethod    = 'mpesa' | 'emola' | 'credit_card';

type MenuVariant = { id: string; name: string; price_cents: number };
type MenuAddon   = { id: string; name: string; price_cents: number };
type MenuModOption = { id: string; name: string; price_cents: number };
type MenuModGroup = {
  id: string;
  name: string;
  free_quantity: number;
  extra_price_cents: number;
  options: MenuModOption[];
};
type MenuItemLite = { id: string; name: string; price_cents: number; variants?: MenuVariant[]; addons?: MenuAddon[]; modifier_groups?: MenuModGroup[] };
type CartModifier = { groupId: string; optionIds: string[] };

// preço unitário = (variante ou base) + Σ adicionais. PREVIEW; servidor é a verdade.
function lineUnitPrice(
  item: MenuItemLite | undefined,
  variantId?: string,
  addonIds: string[] = [],
  modifiers: CartModifier[] = [],
): number {
  if (!item) return 0;
  const base = variantId ? (item.variants?.find((v) => v.id === variantId)?.price_cents ?? item.price_cents) : item.price_cents;
  const addons = (item.addons ?? []).filter((a) => addonIds.includes(a.id)).reduce((s, a) => s + a.price_cents, 0);
  // Escolhas: opções pagas + extra por cada unidade acima das grátis.
  const mods = (item.modifier_groups ?? []).reduce((sum, g) => {
    const ids = modifiers.find((m) => m.groupId === g.id)?.optionIds ?? [];
    const chosen = g.options.filter((o) => ids.includes(o.id)).reduce((s, o) => s + o.price_cents, 0);
    const over = Math.max(ids.length - g.free_quantity, 0);
    return sum + chosen + over * g.extra_price_cents;
  }, 0);
  return base + addons + mods;
}

// ── classes reutilizáveis (tokens da marca via CSS vars; ver (public)/CLAUDE.md) ──
const CARD = 'rounded-2xl p-4 bg-[var(--st-card)] border border-[var(--st-line)]';
const INPUT = 'w-full bg-[var(--st-bg)] border border-[var(--st-line)] rounded-xl px-4 py-3 text-[var(--st-text)] placeholder:text-[var(--st-muted)] focus:border-[var(--st-primary)] focus:outline-none';
// Opção selecionável glass 3D (F9). O ✓ é a rede de segurança para browsers sem color-mix.
function Opt({ selected, onClick, children, className = '', disabled = false }: { selected: boolean; onClick: () => void; children: React.ReactNode; className?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`glass-opt${selected ? ' is-selected' : ''} ${disabled ? ' opacity-50' : ''} ${className}`}
    >
      {children}
      {selected && (
        <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full grid place-items-center text-[var(--st-text)] text-[11px] font-bold shadow" style={{ background: 'var(--st-grad)' }}>✓</span>
      )}
    </button>
  );
}

export default function CheckoutPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [cart, setCart]                 = useState<any[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [fulfillmentType, setFulfillmentType] = useState<'pickup' | 'delivery'>('pickup');
  const [deliveryZoneId, setDeliveryZoneId]   = useState<string>('');
  const [address, setAddress]                 = useState('');
  const [scheduledFor, setScheduledFor]       = useState<string | null>(null);

  // Fluxo de pagamento: 'manual' (comprovativo) ou 'auto' (Paysuite)
  const [paymentFlow, setPaymentFlow]     = useState<PaymentFlow>('manual');
  const [manualMethod, setManualMethod]   = useState<ManualMethod>('mpesa');
  const [autoMethod, setAutoMethod]       = useState<AutoMethod>('mpesa');

  const [referralCode, setReferralCode]           = useState<string | null>(null);

  // ── Cupom de desconto (pode vir do localStorage ou ser digitado aqui) ────────
  type CouponResult = {
    valid: boolean;
    reason?: string;
    reward_type?: 'discount_cents' | 'discount_pct' | 'free_item';
    reward_value?: number;
    gift_item_id?: string;
    gift_item_name?: string;
  };
  const [couponInput, setCouponInput]   = useState('');
  const [couponResult, setCouponResult] = useState<CouponResult | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);

  async function applyCoupon() {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    setCouponLoading(true);
    setCouponResult(null);
    const { data, error } = await supabase.rpc('validate_referral', {
      p_code:  code,
      p_phone: customerPhone || '',
    });
    setCouponLoading(false);
    if (error || !data) { setCouponResult({ valid: false, reason: 'invalid_or_expired' }); return; }
    const res = data as CouponResult;
    setCouponResult(res);
    if (res.valid) {
      setReferralCode(code);
      localStorage.setItem('referral_code', code);
    }
  }

  function removeCoupon() {
    setReferralCode(null);
    setCouponResult(null);
    setCouponInput('');
    localStorage.removeItem('referral_code');
  }

  // desconto estimado (cosmético — o servidor é a verdade)
  function discountPreview(): number {
    if (!couponResult?.valid) return 0;
    if (couponResult.reward_type === 'discount_cents') return couponResult.reward_value ?? 0;
    if (couponResult.reward_type === 'discount_pct')   return Math.round(subtotal * (couponResult.reward_value ?? 0) / 100);
    return 0;
  }

  const [showPaymentScreen, setShowPaymentScreen] = useState(false);
  const [paymentProof, setPaymentProof]           = useState<File | null>(null);
  const [uploading, setUploading]                 = useState(false);
  const [autoSubmitting, setAutoSubmitting]       = useState(false);

  const storeSlug = useStoreSlug();

  const { data: menuData, isLoading: isLoadingMenu } = useQuery({
    queryKey: ['menu', storeSlug],
    queryFn: async () => {
      const res = await fetch(`/api/menu?store=${encodeURIComponent(storeSlug)}`);
      if (!res.ok) throw new Error('Failed to fetch menu');
      return res.json();
    },
  });

  const zones = menuData?.zones ?? [];
  const scheduleSlots = useMemo(
    () => buildScheduleSlots((menuData?.hours ?? []) as StoreHour[]),
    [menuData?.hours],
  );
  const paymentProvider: string = menuData?.payment_provider ?? 'manual';
  const hasAutoPayment = paymentProvider === 'mock' || paymentProvider === 'paysuite';

  const subtotal = cart.reduce((sum, item) => {
    const menuItem = menuData?.categories
      .flatMap((c: any) => c.items)
      .find((i: any) => i.id === item.menuItemId);
    return sum + lineUnitPrice(menuItem, item.variantId, item.addonIds, item.modifiers) * item.qty;
  }, 0);

  const deliveryFee = fulfillmentType === 'delivery'
    ? (zones?.find((z: any) => z.id === deliveryZoneId)?.fee_cents || 0)
    : 0;

  const total = subtotal + deliveryFee;

  // Itens do carrinho com detalhe (para os eventos do funil)
  function cartTrackItems(): TrackItem[] {
    const all = menuData?.categories?.flatMap((c: any) => c.items) ?? [];
    return cart
      .map((line) => {
        const it = all.find((i: any) => i.id === line.menuItemId);
        return it
          ? { id: it.id, name: it.name, price_cents: lineUnitPrice(it, line.variantId, line.addonIds, line.modifiers), qty: line.qty }
          : null;
      })
      .filter(Boolean) as TrackItem[];
  }

  // begin_checkout — uma vez quando o carrinho + cardápio estão prontos (16.4)
  const beganRef = useRef(false);
  useEffect(() => {
    if (beganRef.current || cart.length === 0 || !menuData?.categories) return;
    beganRef.current = true;
    trackBeginCheckout(cartTrackItems());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, menuData]);

  const createOrderMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch('/api/create-order', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Falha ao criar pedido');
      }
      return res.json();
    },
    onSuccess: () => setShowPaymentScreen(true),
    onError:   (error: Error) => alert(error.message),
  });

  function buildOrderPayload(method: string) {
    return {
      // A loja escolhida manda: preços, zonas e cozinha de destino são dela.
      storeSlug,
      customerName,
      customerPhone,
      customerEmail,
      fulfillmentType,
      deliveryZoneId: deliveryZoneId || null,
      address: address || null,
      scheduledFor: scheduledFor || null,
      paymentMethod: method,
      notes: '',
      ...(referralCode ? { referralCode } : {}),
      items: cart.map(item => ({
        menuItemId: item.menuItemId,
        qty:        item.qty,
        ...(item.variantId ? { variantId: item.variantId } : {}),
        ...(item.addonIds && item.addonIds.length ? { addonIds: item.addonIds } : {}),
        // Escolhas do prato (acompanhamentos, molho, …). Sem isto o
        // create_order recusa qualquer item com grupo obrigatório.
        ...(item.modifiers && item.modifiers.length ? { modifiers: item.modifiers } : {}),
        notes:      item.notes || '',
      })),
    };
  }

  function validate(): boolean {
    if (cart.length === 0)            { alert('Carrinho vazio'); return false; }
    if (!customerName || !customerPhone) { alert('Por favor, preencha nome e telefone'); return false; }
    if (fulfillmentType === 'delivery') {
      if (!deliveryZoneId || !address) { alert('Por favor, selecione zona e morada'); return false; }
    }
    return true;
  }

  // Submissão manual: cria pedido e mostra ecrã de comprovativo
  const handleCreateManualOrder = () => {
    if (!validate()) return;
    trackAddPaymentInfo(cartTrackItems(), manualMethod);
    createOrderMutation.mutate(buildOrderPayload(manualMethod));
  };

  // Submissão automática: cria pedido digital e redireciona para Paysuite
  const handleCreateAutoOrder = async () => {
    if (!validate()) return;
    trackAddPaymentInfo(cartTrackItems(), autoMethod);
    setAutoSubmitting(true);
    try {
      const res = await fetch('/api/payments', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(buildOrderPayload(autoMethod)),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Falha ao iniciar pagamento');
      }
      const { checkoutUrl, orderId: newOrderId } = await res.json();
      // Não apagar o carrinho aqui — só depois de o pagamento ser confirmado
      // em /payment/return. Se o utilizador voltar atrás, o carrinho mantém-se.
      localStorage.setItem('pending_order_id', newOrderId ?? '');
      router.push(checkoutUrl);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setAutoSubmitting(false);
    }
  };

  const handleUploadProof = async () => {
    if (!paymentProof) { alert('Por favor, selecione o comprovativo'); return; }
    const orderId = createOrderMutation.data?.orderId;
    if (!orderId) { alert('Pedido não encontrado. Tente novamente.'); return; }

    setUploading(true);
    try {
      const fileExt  = paymentProof.name.split('.').pop();
      const filePath = `${orderId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('payment-proofs')
        .upload(filePath, paymentProof);

      if (uploadError) throw uploadError;

      const res = await fetch('/api/attach-proof', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ orderId, path: filePath }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Falha ao anexar comprovativo');
      }

      localStorage.removeItem('cart');
      router.push(`/order-status/${orderId}`);
    } catch (error) {
      alert('Erro ao carregar comprovativo: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem('cart');
    if (saved) setCart(JSON.parse(saved));
    const savedCode = localStorage.getItem('referral_code');
    if (savedCode) {
      setReferralCode(savedCode);
      setCouponInput(savedCode);
      // marca como válido (foi validado na loja); detalhe é revalidado no servidor
      setCouponResult({ valid: true });
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('cart', JSON.stringify(cart));
  }, [cart]);

  const fmt = (cents: number) => formatMT(cents as Cents);

  // ─── Loading ───────────────────────────────────────────────────────────────

  if (isLoadingMenu) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[var(--st-bg)]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--st-primary)] mx-auto mb-4"></div>
          <p className="text-[var(--st-muted)]">A carregar…</p>
        </div>
      </div>
    );
  }

  // ─── Ecrã de pagamento manual ──────────────────────────────────────────────

  if (showPaymentScreen) {
    const mpesaNumber = menuData?.mpesa_number;
    const mpesaName   = menuData?.mpesa_name;
    const emolaNumber = menuData?.emola_number;
    const emolaName   = menuData?.emola_name;

    return (
      <div className="min-h-screen bg-[var(--st-bg)] p-4">
        <div className="max-w-[480px] mx-auto">
          <div className={CARD + ' p-6'}>
            <h2 className="text-2xl font-bold text-[var(--st-text)] mb-2 text-center">Pagamento Manual</h2>
            <p className="text-[var(--st-muted)] text-center mb-6">Transfira o valor e envie o comprovativo</p>

            <div className="bg-[var(--st-bg)] rounded-xl p-4 mb-6 border border-[var(--st-line)]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[var(--st-muted)]">{referralCode ? 'Total estimado:' : 'Total a pagar:'}</span>
                <span className="font-extrabold text-xl" style={{ color: discountPreview() > 0 ? '#22c55e' : 'white' }}>
                  {fmt(Math.max(0, total - discountPreview()))}
                </span>
              </div>
              <div className="border-t border-[var(--st-line)] pt-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--st-muted)]">Subtotal:</span>
                  <span className="text-[var(--st-muted-2)]">{fmt(subtotal)}</span>
                </div>
                {deliveryFee > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--st-muted)]">Taxa entrega:</span>
                    <span className="text-[var(--st-muted-2)]">+ {fmt(deliveryFee)}</span>
                  </div>
                )}
                {discountPreview() > 0 && (
                  <div className="flex justify-between text-sm font-bold" style={{ color: '#22c55e' }}>
                    <span>Desconto ({referralCode}):</span>
                    <span>- {fmt(discountPreview())}</span>
                  </div>
                )}
              </div>
              {referralCode && <p className="text-[11px] mt-2" style={{ color: 'var(--st-muted)' }}>* Desconto final confirmado pelo servidor.</p>}
            </div>

            <div className="space-y-4 mb-6">
              {manualMethod === 'mpesa' && mpesaNumber && (
                <div className="bg-[var(--st-bg)] rounded-xl p-4 border border-[var(--st-line)]">
                  <p className="text-[var(--st-muted)] text-sm mb-1">M-Pesa</p>
                  <p className="text-[var(--st-primary)] font-bold text-lg">{mpesaNumber}</p>
                  {mpesaName && <p className="text-[var(--st-muted)] text-sm mt-1">{mpesaName}</p>}
                </div>
              )}
              {manualMethod === 'emola' && emolaNumber && (
                <div className="bg-[var(--st-bg)] rounded-xl p-4 border border-[var(--st-line)]">
                  <p className="text-[var(--st-muted)] text-sm mb-1">e-Mola</p>
                  <p className="text-[var(--st-primary)] font-bold text-lg">{emolaNumber}</p>
                  {emolaName && <p className="text-[var(--st-muted)] text-sm mt-1">{emolaName}</p>}
                </div>
              )}
            </div>

            <p className="text-[var(--st-muted-2)] text-sm border-t border-[var(--st-line)] pt-4 mb-6">
              Após transferir, envie o comprovativo abaixo para confirmar o pagamento.
            </p>

            <label className="block w-full bg-[var(--st-card)] border border-[var(--st-line)] hover:border-[var(--st-primary)] text-[var(--st-text)] py-3 px-4 rounded-xl text-center cursor-pointer transition-colors mb-3">
              <span>{paymentProof ? paymentProof.name : 'Selecionar Comprovativo'}</span>
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => setPaymentProof(e.target.files?.[0] || null)}
                disabled={uploading}
                className="hidden"
              />
            </label>

            <button
              onClick={handleUploadProof}
              disabled={uploading || !paymentProof}
              className="w-full text-[var(--st-text)] font-bold py-4 px-4 rounded-2xl transition-all active:scale-[0.99] disabled:opacity-50"
              style={{ background: 'var(--st-grad)' }}
            >
              {uploading ? 'A carregar…' : 'Enviar Comprovativo'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Formulário principal ──────────────────────────────────────────────────

  const isSubmitting = createOrderMutation.isPending || autoSubmitting;

  return (
    <div className="min-h-screen bg-[var(--st-bg)]">
      <div className="max-w-[480px] mx-auto pb-8">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-[var(--st-bg)]/95 backdrop-blur border-b border-[var(--st-line)]">
          <div className="px-4 py-4 flex items-center gap-3">
            <button onClick={() => router.push('/menu')} className="text-2xl text-[var(--st-text)] leading-none" aria-label="Voltar">←</button>
            <h1 className="text-xl font-extrabold text-[var(--st-text)]">Finalizar pedido</h1>
          </div>
        </header>

        <div className="space-y-4 mt-4 px-4">
          {/* Dados do cliente */}
          <div className={CARD}>
            <h2 className="text-[var(--st-text)] font-bold mb-4">Seus Dados</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[var(--st-muted)] text-sm mb-2">Nome *</label>
                <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={INPUT} placeholder="Seu nome" />
              </div>
              <div>
                <label className="block text-[var(--st-muted)] text-sm mb-2">Telefone *</label>
                <input type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className={INPUT} placeholder="+258 XX XXX XXX" />
              </div>
              <div>
                <label className="block text-[var(--st-muted)] text-sm mb-2">
                  Email <span className="text-[var(--st-muted)]">(opcional — para receber a confirmação)</span>
                </label>
                <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} className={INPUT} placeholder="email@exemplo.com" />
              </div>
            </div>
          </div>

          {/* Tipo de entrega */}
          <div className={CARD}>
            <h2 className="text-[var(--st-text)] font-bold mb-4">Tipo de Entrega</h2>
            <div className="grid grid-cols-2 gap-3" style={{ perspective: '1000px' }}>
              <Opt selected={fulfillmentType === 'pickup'} onClick={() => { setFulfillmentType('pickup'); setDeliveryZoneId(''); setAddress(''); }} className="p-4 text-left">
                <p className="glass-label">🏃 Levantamento</p>
                <p className="text-[var(--st-muted)] text-sm">Retirar na loja</p>
              </Opt>
              <Opt selected={fulfillmentType === 'delivery'} onClick={() => setFulfillmentType('delivery')} className="p-4 text-left">
                <p className="glass-label">🛵 Entrega</p>
                <p className="text-[var(--st-muted)] text-sm">A sua morada</p>
              </Opt>
            </div>
          </div>

          {/* Detalhes de entrega */}
          {fulfillmentType === 'delivery' && (
            <div className={CARD}>
              <h2 className="text-[var(--st-text)] font-bold mb-4">Detalhes de Entrega</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-[var(--st-muted)] text-sm mb-2">Zona *</label>
                  <select value={deliveryZoneId} onChange={(e) => setDeliveryZoneId(e.target.value)} className={INPUT}>
                    <option value="">Selecione uma zona</option>
                    {zones?.map((zone: any) => (
                      <option key={zone.id} value={zone.id}>{zone.name} (+{fmt(zone.fee_cents)})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[var(--st-muted)] text-sm mb-2">Morada *</label>
                  <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className={INPUT} placeholder="Rua, número, bairro…" />
                </div>
              </div>
            </div>
          )}

          {/* Agendamento */}
          <div className={CARD}>
            <h2 className="text-[var(--st-text)] font-bold mb-4">Agendamento</h2>
            <div className="grid grid-cols-2 gap-3" style={{ perspective: '1000px' }}>
              <Opt selected={scheduledFor === null} onClick={() => setScheduledFor(null)} className="p-4 text-left">
                <p className="glass-label">Agora</p>
                <p className="text-[var(--st-muted)] text-sm">Preparar imediatamente</p>
              </Opt>
              <Opt
                selected={scheduledFor !== null}
                onClick={() => setScheduledFor(scheduleSlots[0]?.iso ?? null)}
                disabled={scheduleSlots.length === 0}
                className="p-4 text-left"
              >
                <p className="glass-label">Horário</p>
                <p className="text-[var(--st-muted)] text-sm">
                  {scheduleSlots.length === 0 ? 'Sem horários' : 'Agendar'}
                </p>
              </Opt>
            </div>
            {scheduledFor && scheduleSlots.length > 0 && (
              <div className="mt-4">
                {/* Só horários em que esta loja abre — o servidor volta a validar. */}
                <select
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                  aria-label="Horário de entrega"
                  className={INPUT}
                >
                  {scheduleSlots.map((slot) => (
                    <option key={slot.iso} value={slot.iso}>{slot.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Método de pagamento */}
          <div className={CARD}>
            <h2 className="text-[var(--st-text)] font-bold mb-4">Pagamento</h2>

            {/* Toggle manual/auto — só aparece se Paysuite estiver configurado */}
            {hasAutoPayment && (
              <div className="flex bg-[var(--st-bg)] rounded-lg p-1 mb-4 border border-[var(--st-line)]">
                <button onClick={() => setPaymentFlow('manual')} className={`flex-1 py-2 rounded-md text-sm font-semibold transition-all ${paymentFlow === 'manual' ? 'text-[var(--st-text)]' : 'text-[var(--st-muted)]'}`} style={paymentFlow === 'manual' ? { background: 'var(--st-grad)' } : undefined}>
                  Comprovativo
                </button>
                <button onClick={() => setPaymentFlow('auto')} className={`flex-1 py-2 rounded-md text-sm font-semibold transition-all ${paymentFlow === 'auto' ? 'text-[var(--st-text)]' : 'text-[var(--st-muted)]'}`} style={paymentFlow === 'auto' ? { background: 'var(--st-grad)' } : undefined}>
                  Pagar Agora
                </button>
              </div>
            )}

            {/* Métodos manuais */}
            {paymentFlow === 'manual' && (
              <div className="grid grid-cols-2 gap-3" style={{ perspective: '1000px' }}>
                <Opt selected={manualMethod === 'mpesa'} onClick={() => setManualMethod('mpesa')} className="p-4 text-left">
                  <p className="glass-label">M-Pesa</p>
                  <p className="text-[var(--st-muted)] text-sm">Comprovativo</p>
                </Opt>
                <Opt selected={manualMethod === 'emola'} onClick={() => setManualMethod('emola')} className="p-4 text-left">
                  <p className="glass-label">e-Mola</p>
                  <p className="text-[var(--st-muted)] text-sm">Comprovativo</p>
                </Opt>
              </div>
            )}

            {/* Métodos automáticos (Paysuite) */}
            {paymentFlow === 'auto' && (
              <>
                <div className="grid grid-cols-3 gap-2 mb-3" style={{ perspective: '1000px' }}>
                  {(['mpesa', 'emola', 'credit_card'] as AutoMethod[]).map((m) => (
                    <Opt key={m} selected={autoMethod === m} onClick={() => setAutoMethod(m)} className="p-3 text-center">
                      <p className="glass-label text-sm">
                        {m === 'mpesa' ? 'M-Pesa' : m === 'emola' ? 'e-Mola' : 'Cartão'}
                      </p>
                    </Opt>
                  ))}
                </div>
                <p className="text-[var(--st-muted)] text-xs">Será redireccionado para a página de pagamento seguro.</p>
              </>
            )}
          </div>

          {/* Cupom de desconto */}
          <div className={CARD}>
            <h2 className="text-[var(--st-text)] font-bold mb-3">Cupom de desconto</h2>

            {referralCode && couponResult?.valid ? (
              /* Código aplicado */
              <div className="rounded-xl px-4 py-3 flex items-start gap-3" style={{ background: '#0f2a1a', border: '1px solid #22c55e55' }}>
                <span className="text-[#22c55e] text-lg mt-0.5">✓</span>
                <div className="flex-1 min-w-0">
                  <span className="font-mono font-extrabold text-sm text-[var(--st-text)]">{referralCode}</span>
                  {couponResult.reward_type === 'discount_cents' && couponResult.reward_value && (
                    <p className="text-[12px] mt-0.5" style={{ color: '#22c55e' }}>
                      Desconto: -{fmt(couponResult.reward_value)}
                    </p>
                  )}
                  {couponResult.reward_type === 'discount_pct' && couponResult.reward_value && (
                    <p className="text-[12px] mt-0.5" style={{ color: '#22c55e' }}>
                      Desconto: -{couponResult.reward_value}% ({fmt(discountPreview())})
                    </p>
                  )}
                  {couponResult.reward_type === 'free_item' && (
                    <p className="text-[12px] mt-0.5" style={{ color: '#22c55e' }}>
                      🎁 {couponResult.gift_item_name ?? 'Item grátis'} incluído
                    </p>
                  )}
                  {!couponResult.reward_type && (
                    <p className="text-[12px] mt-0.5" style={{ color: 'var(--st-muted)' }}>
                      Desconto aplicado pelo servidor no checkout
                    </p>
                  )}
                </div>
                <button onClick={removeCoupon} className="text-sm shrink-0" style={{ color: 'var(--st-muted)' }} aria-label="Remover cupom">✕</button>
              </div>
            ) : (
              /* Input para digitar código */
              <>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && applyCoupon()}
                    placeholder="SEUCÓDIGO"
                    maxLength={50}
                    className={INPUT + ' font-mono tracking-wider'}
                    aria-label="Código de desconto"
                  />
                  <button
                    type="button"
                    onClick={applyCoupon}
                    disabled={couponLoading || !couponInput.trim()}
                    className="px-5 rounded-xl font-bold text-[var(--st-text)] text-sm shrink-0 disabled:opacity-50"
                    style={{ background: 'var(--st-grad)' }}
                  >
                    {couponLoading ? '…' : 'Aplicar'}
                  </button>
                </div>
                {couponResult && !couponResult.valid && (
                  <p className="mt-2 text-xs px-1" style={{ color: 'var(--st-primary)' }}>
                    {couponResult.reason === 'auto_redemption'          ? 'Não podes usar o teu próprio código.' :
                     couponResult.reason === 'already_redeemed'        ? 'Já usaste este código antes.' :
                     couponResult.reason === 'max_redemptions_reached' ? 'Este código atingiu o limite de utilizações.' :
                     'Código inválido ou expirado.'}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Resumo */}
          <div className={CARD}>
            <h2 className="text-[var(--st-text)] font-bold mb-4">Resumo</h2>
            <div className="space-y-2 mb-4">
              {cart.map((item, idx) => {
                const menuItem = menuData?.categories
                  .flatMap((c: any) => c.items)
                  .find((i: any) => i.id === item.menuItemId);
                const variant = item.variantId ? menuItem?.variants?.find((v: MenuVariant) => v.id === item.variantId) : undefined;
                const addons = (menuItem?.addons ?? []).filter((a: MenuAddon) => (item.addonIds ?? []).includes(a.id));
                const detail = [variant?.name, ...addons.map((a: MenuAddon) => a.name)].filter(Boolean).join(' · ');
                return (
                  <div key={idx} className="flex justify-between text-sm gap-2">
                    <span className="text-[var(--st-muted-2)] min-w-0">
                      {menuItem?.name} x{item.qty}
                      {detail && <span className="block text-[11px] truncate" style={{ color: 'var(--st-muted)' }}>{detail}</span>}
                    </span>
                    <span className="text-[var(--st-text)] shrink-0">{fmt(lineUnitPrice(menuItem, item.variantId, item.addonIds, item.modifiers) * item.qty)}</span>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-[var(--st-line)] pt-3 space-y-2">
              <div className="flex justify-between">
                <span className="text-[var(--st-muted)]">Subtotal:</span>
                <span className="text-[var(--st-text)]">{fmt(subtotal)}</span>
              </div>
              {deliveryFee > 0 && (
                <div className="flex justify-between">
                  <span className="text-[var(--st-muted)]">Taxa entrega:</span>
                  <span className="text-[var(--st-text)]">+ {fmt(deliveryFee)}</span>
                </div>
              )}
              {discountPreview() > 0 && (
                <div className="flex justify-between" style={{ color: '#22c55e' }}>
                  <span>Desconto ({referralCode}):</span>
                  <span className="font-bold">- {fmt(discountPreview())}</span>
                </div>
              )}
              {couponResult?.valid && couponResult.reward_type === 'free_item' && (
                <div className="flex justify-between text-sm" style={{ color: '#22c55e' }}>
                  <span>🎁 {couponResult.gift_item_name ?? 'Item grátis'}:</span>
                  <span className="font-bold">GRÁTIS</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-extrabold pt-2 border-t border-[var(--st-line)]">
                <span className="text-[var(--st-text)]">{referralCode ? 'Total estimado:' : 'Total:'}</span>
                <span style={{ color: discountPreview() > 0 ? '#22c55e' : 'white' }}>
                  {fmt(Math.max(0, total - discountPreview()))}
                </span>
              </div>
              {referralCode && <p className="text-xs" style={{ color: 'var(--st-muted)' }}>* O desconto final é confirmado pelo servidor.</p>}
            </div>
          </div>

          {/* Botão de submissão */}
          <button
            onClick={paymentFlow === 'auto' ? handleCreateAutoOrder : handleCreateManualOrder}
            disabled={cart.length === 0 || isSubmitting}
            className="w-full text-[var(--st-text)] font-extrabold py-4 px-4 rounded-2xl transition-all active:scale-[0.99] disabled:opacity-50"
            style={{ background: 'var(--st-grad)' }}
          >
            {isSubmitting
              ? (paymentFlow === 'auto' ? 'A redirecionar…' : 'A criar pedido…')
              : (paymentFlow === 'auto' ? 'Ir para Pagamento' : 'Criar Pedido')}
          </button>
        </div>
      </div>
    </div>
  );
}
