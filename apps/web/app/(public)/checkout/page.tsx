'use client';

/**
 * Checkout — o ecrã onde a venda se ganha ou se perde.
 *
 * O que mudou face à versão anterior (e porquê):
 *
 * - **Três secções, não cinco.** "Quando" foi para dentro de "Como", e o cupão
 *   deixou de ser um passo numerado — um campo de código vazio e sempre
 *   visível diz a toda a gente que existe um desconto que ela não tem, e
 *   manda-a para fora do site à procura dele.
 * - **O canal vem primeiro.** É ele que decide se há zona e morada; escolhê-lo
 *   depois de preencher os dados fazia o formulário refluir por baixo do
 *   teclado do telemóvel.
 * - **O total e o botão deixaram de estar só no fim.** Há uma recapitulação no
 *   topo e a barra final diz quanto é que se está a pagar.
 * - **Sem sopa de caixas:** secções separadas por filete, numeradas.
 *
 * A lógica não mudou nada: mesmo `create_order`, mesmo payload, mesmo
 * tracking, mesmo upload de comprovativo. O preço continua a ser do servidor
 * (raiz §1, regra 2) — o que se mostra aqui é pré-visualização.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { formatMT, type Cents } from '@delivery/core';

import '../_hawsmash/landing.css';
import '../_hawsmash/funnel.css';
import { createClient } from '@/utils/supabase/client';
import { useStoreSlug } from '@/utils/useStore';
import { buildScheduleSlots, type StoreHour } from '@/lib/store-hours';
import { trackBeginCheckout, trackAddPaymentInfo, type TrackItem } from '@/lib/analytics/track';
import { useAccount } from '@/utils/useAccount';
import {
  FunnelRail,
  FunnelFoot,
  SectionHead,
  IcoStore,
  IcoScooter,
  IcoClock,
  IcoPin,
  IcoUser,
  IcoPhone,
  IcoMail,
  IcoTicket,
  IcoShield,
  IcoUpload,
  IcoCheck,
  IcoArrow,
  IcoCopy,
  IcoPlus,
} from '../_hawsmash/funnel';

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

/** Cartão de escolha do funil. Substitui o glass 3D: com o dourado reservado
 *  para selecção, total e botão, uma borda dourada chega para dizer "é este". */
function Tile({
  selected, onClick, disabled = false, icon, title, sub, tight = false,
}: {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  title: string;
  sub?: string;
  tight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`hf-tile${selected ? ' is-on' : ''}${tight ? ' is-tight' : ''}`}
    >
      {icon && <span className="hf-tile-c" style={{ display: 'inline-flex' }}>{icon}</span>}
      <span className="hf-tile-t" style={{ display: 'block' }}>{title}</span>
      {sub && <span className="hf-tile-s" style={{ display: 'block' }}>{sub}</span>}
      {selected && (
        <span className="hf-check" aria-hidden><IcoCheck size={12} /></span>
      )}
    </button>
  );
}

/**
 * Entrar num telemóvel novo.
 *
 * Só aparece para quem NÃO está reconhecido, e é discreto de propósito: a
 * esmagadora maioria das pessoas chega aqui já com sessão, e para quem chega
 * de novo o caminho normal — preencher e comprar — continua a ser o caminho
 * mais curto. Isto é a porta lateral, não a porta principal.
 *
 * Quem não tem email no histórico não fica preso: o ecrã diz-lhe que o
 * telemóvel fica ligado no fim deste pedido.
 */
function LoginInline({
  requestCode,
  verifyCode,
  defaultPhone,
}: {
  requestCode: (phone: string) => Promise<{ channel: 'email' | 'none'; hint?: string }>;
  verifyCode: (phone: string, code: string) => Promise<unknown>;
  defaultPhone: string;
}) {
  const [step, setStep] = useState<'idle' | 'phone' | 'code' | 'none'>('idle');
  const [phone, setPhone] = useState(defaultPhone);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');

  async function ask() {
    if (!phone.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await requestCode(phone);
      if (res.channel === 'email') {
        setHint(res.hint ?? '');
        setStep('code');
      } else {
        setStep('none');
      }
    } catch {
      setStep('none');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!code.trim()) return;
    setBusy(true);
    setError('');
    try {
      await verifyCode(phone, code);
      // O hook actualiza o perfil e a secção inteira passa a mostrar o
      // cliente reconhecido — este componente desaparece com ela.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Código errado.');
    } finally {
      setBusy(false);
    }
  }

  if (step === 'idle') {
    return (
      <button
        type="button"
        onClick={() => setStep('phone')}
        style={{ display: 'flex', alignItems: 'center', gap: 11, minHeight: 44, color: 'var(--hs-ink-mute)' }}
      >
        <IcoUser />
        <span style={{ fontSize: 14 }}>Já pediste aqui?</span>
        <span className="hf-act">Entrar</span>
      </button>
    );
  }

  if (step === 'none') {
    return (
      <p className="hf-note" style={{ marginTop: 4 }}>
        <IcoUser size={15} />
        Não temos por onde te enviar um código. Faz o pedido normalmente — este
        telemóvel fica ligado à tua conta no fim, e da próxima já não escreves nada.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {step === 'phone' ? (
        <>
          <span className="hf-lbl">O telefone dos teus pedidos</span>
          <div className="hf-fld-row">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && ask()}
              className="hf-fld num"
              placeholder="+258 XX XXX XXXX"
              aria-label="Telefone da conta"
            />
            <button type="button" onClick={ask} disabled={busy || !phone.trim()} className="hf-btn hf-btn-ghost hf-btn-sm">
              {busy ? '…' : 'Enviar'}
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="hf-lbl">Código enviado para {hint}</span>
          <div className="hf-fld-row">
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Enter' && confirm()}
              className="hf-fld num"
              style={{ letterSpacing: '.3em' }}
              placeholder="000000"
              aria-label="Código de entrada"
            />
            <button type="button" onClick={confirm} disabled={busy || code.length < 6} className="hf-btn hf-btn-ghost hf-btn-sm">
              {busy ? '…' : 'Entrar'}
            </button>
          </div>
        </>
      )}
      {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--hs-ember)' }}>{error}</p>}
      <button type="button" onClick={() => setStep('idle')} className="hf-act" style={{ marginLeft: 0 }}>
        Deixa estar
      </button>
    </div>
  );
}

export default function CheckoutPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [cart, setCart]                 = useState<any[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [showEmail, setShowEmail]         = useState(false);
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
  // Fechado por omissão: quem tem código sabe que tem e abre; quem não tem não
  // fica a saber que existe um desconto que lhe falta.
  const [showCoupon, setShowCoupon]     = useState(false);

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

  // Conta do cliente. Se este telemóvel já fez um pedido, o sistema conhece-o
  // e ele não volta a escrever nome nem morada. Nunca bloqueia nada: sem
  // conta, o checkout é exactamente o formulário de sempre.
  const { profile, hydrated: accountReady, saveAddress, logout, requestCode, verifyCode } = useAccount();
  // Morada guardada em uso. '' = morada nova, escrita à mão.
  const [addressId, setAddressId] = useState<string>('');
  const [addressLabel, setAddressLabel] = useState('Casa');

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
    rememberAddress();
    trackAddPaymentInfo(cartTrackItems(), manualMethod);
    createOrderMutation.mutate(buildOrderPayload(manualMethod));
  };

  // Submissão automática: cria pedido digital e redireciona para Paysuite
  const handleCreateAutoOrder = async () => {
    if (!validate()) return;
    rememberAddress();
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
      setShowCoupon(true);
      // marca como válido (foi validado na loja); detalhe é revalidado no servidor
      setCouponResult({ valid: true });
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('cart', JSON.stringify(cart));
  }, [cart]);

  // Preenche o que o cliente já nos deu. Só toca em campos vazios — se ele
  // escreveu outra coisa nesta sessão, é a dele que vale.
  useEffect(() => {
    if (!profile) return;
    setCustomerName((n) => n || profile.name || '');
    setCustomerPhone((p) => p || profile.phone || '');
    const favourite = profile.addresses.find((a) => a.is_default) ?? profile.addresses[0];
    if (favourite) setAddressId((cur) => cur || favourite.id);
  }, [profile]);

  // A zona pertence à loja: uma morada guardada com zona de Maputo não
  // pré-selecciona nada quando o carrinho é da Matola. A morada continua a
  // servir; a taxa é que tem de ser escolhida outra vez.
  useEffect(() => {
    if (!addressId || !profile) return;
    const saved = profile.addresses.find((a) => a.id === addressId);
    if (!saved) return;
    setAddress(saved.address);
    setAddressLabel(saved.label);
    const zoneBelongsHere = zones?.some((z: any) => z.id === saved.delivery_zone_id);
    setDeliveryZoneId(zoneBelongsHere ? String(saved.delivery_zone_id) : '');
  }, [addressId, profile, zones]);

  // Morada nova de quem já tem conta: fica guardada para a próxima. Fire and
  // forget — a venda nunca espera nem pára por causa disto (§1, regra 1).
  function rememberAddress() {
    if (!profile || fulfillmentType !== 'delivery' || addressId || !address.trim()) return;
    saveAddress({
      label: addressLabel || 'Morada',
      address,
      zoneId: deliveryZoneId || null,
    }).catch(() => {});
  }

  const fmt = (cents: number) => formatMT(cents as Cents);
  const dueCents = Math.max(0, total - discountPreview());
  const storeName: string | undefined = menuData?.store?.short_name;

  // ─── Loading ───────────────────────────────────────────────────────────────

  if (isLoadingMenu) {
    return (
      <div className="hs hf" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
        <div style={{ textAlign: 'center' }}>
          <div className="hf-spin" style={{ width: 32, height: 32, margin: '0 auto 16px', borderRadius: '50%', border: '2px solid var(--hs-line)', borderTopColor: 'var(--hs-gold)' }} />
          <p style={{ color: 'var(--hs-ink-mute)', fontSize: 14 }}>A carregar…</p>
        </div>
      </div>
    );
  }

  // ─── Ecrã de pagamento manual ──────────────────────────────────────────────

  if (showPaymentScreen) {
    const isMpesa = manualMethod === 'mpesa';
    const number  = isMpesa ? menuData?.mpesa_number : menuData?.emola_number;
    const holder  = isMpesa ? menuData?.mpesa_name   : menuData?.emola_name;

    return (
      <div className="hs hf" style={{ minHeight: '100vh' }}>
        <div className="hf-page">
          <FunnelRail step={2} storeName={storeName} />

          {/* O valor é a capa: é por ele que a loja reconhece o pagamento. */}
          <section className="hf-hero hf-hero-glow-c" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.28em', textTransform: 'uppercase', color: 'var(--hs-ink-mute)' }}>
              Total a pagar
            </div>
            <div
              className="num"
              style={{ fontFamily: 'var(--font-display)', fontSize: 68, lineHeight: .94, letterSpacing: '-.01em', color: 'var(--hs-gold)', marginTop: 12 }}
            >
              {fmt(dueCents)}
            </div>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(String(dueCents / 100))}
              className="hf-btn hf-btn-ghost hf-btn-sm"
              style={{ margin: '14px auto 0' }}
            >
              <IcoCopy size={14} />
              Copiar valor
            </button>
            <p className="hf-lead is-centered" style={{ fontSize: 11, color: 'var(--hs-ink-faint)', maxWidth: 280 }}>
              Transfere este valor exacto. É assim que sabemos que o pagamento é teu.
            </p>
          </section>

          {/* Método + número */}
          <section className="hf-sec">
            <div className="hf-seg">
              <button type="button" onClick={() => setManualMethod('mpesa')} className={`hf-seg-opt${isMpesa ? ' is-on' : ''}`}>M-Pesa</button>
              <button type="button" onClick={() => setManualMethod('emola')} className={`hf-seg-opt${!isMpesa ? ' is-on' : ''}`}>e-Mola</button>
            </div>

            {number ? (
              <div className="hf-panel is-gold" style={{ marginTop: 18, padding: 20 }}>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.24em', textTransform: 'uppercase', color: 'var(--hs-ink-mute)' }}>Enviar para</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                  <span className="num" style={{ fontFamily: 'var(--font-condensed)', fontSize: 30, lineHeight: 1, letterSpacing: '.08em', color: 'var(--hs-ink)' }}>
                    {number}
                  </span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(String(number))}
                    className="hf-btn hf-btn-ghost hf-btn-sm"
                    style={{ marginLeft: 'auto' }}
                  >
                    <IcoCopy size={14} />
                    Copiar
                  </button>
                </div>
                {holder && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--hs-line)' }}>
                    <span style={{ color: 'var(--hs-ink-mute)', display: 'flex' }}><IcoUser size={16} /></span>
                    <span style={{ fontSize: 14, color: 'var(--hs-ink-dim)' }}>{holder}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--hs-ink-faint)' }}>
                      Conta oficial
                    </span>
                  </div>
                )}
                {/* Anti-burla: o nome que aparece no telemóvel é a única
                    verificação que o cliente tem antes de largar o dinheiro. */}
                <p className="hf-note" style={{ marginTop: 12 }}>
                  <span className="hf-warn" style={{ display: 'flex' }}><IcoShield size={15} /></span>
                  Se o nome que aparece no teu telemóvel for outro, não envies — fala connosco.
                </p>
              </div>
            ) : (
              <p className="hf-note" style={{ marginTop: 18 }}>
                Esta loja ainda não tem número de {isMpesa ? 'M-Pesa' : 'e-Mola'} configurado. Escolhe o outro método ou fala com a loja.
              </p>
            )}
          </section>

          {/* Três passos */}
          <section className="hf-sec">
            <SectionHead>Três passos</SectionHead>
            <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {[
                <>Envia <strong className="num" style={{ color: 'var(--hs-ink)' }}>{fmt(dueCents)}</strong> para o número acima.</>,
                <>Guarda o SMS de confirmação ou tira print.</>,
                <>Anexa aqui em baixo. Confirmamos em poucos minutos e a chapa arranca.</>,
              ].map((text, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '13px 0', borderBottom: i < 2 ? '1px solid rgba(255,255,255,.07)' : undefined }}>
                  <span className="hf-num" style={{ minWidth: 22, lineHeight: 1.3 }}>{`0${i + 1}`}</span>
                  <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--hs-ink-dim)' }}>{text}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* Anexo */}
          <section className="hf-sec">
            {paymentProof ? (
              <div className="hf-panel is-ok" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16 }}>
                <span className="hf-ok" style={{ display: 'flex' }}><IcoCheck size={20} /></span>
                <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: 'var(--hs-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{paymentProof.name}</div>
                  <div className="num" style={{ fontSize: 11, color: 'var(--hs-ink-mute)', marginTop: 4 }}>
                    {(paymentProof.size / 1024 / 1024).toFixed(1)} MB · anexado
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPaymentProof(null)}
                  aria-label="Remover comprovativo"
                  style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', color: 'var(--hs-ink-mute)', flexShrink: 0 }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <label
                style={{
                  display: 'block', textAlign: 'center', cursor: 'pointer',
                  border: '1.5px dashed color-mix(in srgb, var(--hs-gold) 45%, transparent)',
                  borderRadius: 12, padding: '30px 20px',
                  background: 'color-mix(in srgb, var(--hs-gold) 4%, transparent)',
                }}
              >
                <span style={{ width: 52, height: 52, borderRadius: '50%', margin: '0 auto', display: 'grid', placeItems: 'center', color: 'var(--hs-gold)', border: '1px solid color-mix(in srgb, var(--hs-gold) 40%, transparent)', background: 'color-mix(in srgb, var(--hs-gold) 8%, transparent)' }}>
                  <IcoUpload size={22} />
                </span>
                <span style={{ display: 'block', fontFamily: 'var(--font-condensed)', fontSize: 20, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--hs-ink)', marginTop: 14 }}>
                  Anexar comprovativo
                </span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--hs-ink-mute)', marginTop: 6 }}>Print, foto ou PDF</span>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setPaymentProof(e.target.files?.[0] || null)}
                  disabled={uploading}
                  className="sr-only"
                  style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
                />
              </label>
            )}
          </section>

          <div className="hf-bar">
            <button onClick={handleUploadProof} disabled={uploading || !paymentProof} className="hf-btn hf-btn-gold">
              {uploading ? 'A enviar…' : 'Enviar comprovativo'}
              {!uploading && <IcoArrow />}
            </button>
            <p className="hf-note" style={{ justifyContent: 'center', marginTop: 14, color: 'var(--hs-ink-faint)' }}>
              O teu comprovativo só é visto pela equipa da loja.
            </p>
          </div>
          <FunnelFoot />
        </div>
      </div>
    );
  }

  // ─── Formulário principal ──────────────────────────────────────────────────

  const isSubmitting = createOrderMutation.isPending || autoSubmitting;
  const ctaLabel = isSubmitting
    ? (paymentFlow === 'auto' ? 'A redirecionar…' : 'A criar pedido…')
    : `Pagar ${fmt(dueCents)}`;

  return (
    <div className="hs hf hs-checkout" style={{ minHeight: '100vh' }}>
      <div className="hf-page">
        <FunnelRail step={1} storeName={storeName} onBack={() => router.push(`/l/${storeSlug}`)} />

        <section className="hf-hero hf-hero-glow">
          <p className="hf-eyebrow">Finalizar pedido</p>
          <h1 className="hf-display">
            Quase<br />na <span className="hf-flame">chapa.</span>
          </h1>
        </section>

        {/* Recapitulação: o cliente sabe o que compra e quanto custa antes de
            preencher o que quer que seja. */}
        <div className="hf-recap">
          <span style={{ fontSize: 14, color: 'var(--hs-ink-mute)' }}>
            {cart.length} {cart.length === 1 ? 'artigo' : 'artigos'}
          </span>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--hs-ink-faint)' }} />
          <span className="hf-recap-total num">{fmt(total)}</span>
          <button type="button" onClick={() => router.push(`/l/${storeSlug}`)} className="hf-act">
            Editar
          </button>
        </div>

        {/* ── 01 Como e quando ─────────────────────────────────────────── */}
        <section className="hf-sec">
          <SectionHead n={1}>Como e quando</SectionHead>
          <div className="hf-tiles is-2">
            <Tile
              selected={fulfillmentType === 'pickup'}
              onClick={() => { setFulfillmentType('pickup'); setDeliveryZoneId(''); setAddress(''); }}
              icon={<IcoStore />}
              title="Levantar"
              sub="No balcão"
            />
            <Tile
              selected={fulfillmentType === 'delivery'}
              onClick={() => setFulfillmentType('delivery')}
              icon={<IcoScooter />}
              title="Entrega"
              sub="Na tua morada"
            />
          </div>

          {fulfillmentType === 'delivery' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
              {/* Moradas guardadas. Só aparecem com sessão NESTE dispositivo —
                  nunca a partir de um número de telefone escrito por alguém. */}
              {profile && profile.addresses.length > 0 && (
                <div>
                  <span className="hf-lbl">Onde entregamos</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {profile.addresses.map((saved) => (
                      <button
                        key={saved.id}
                        type="button"
                        onClick={() => setAddressId(saved.id)}
                        aria-pressed={addressId === saved.id}
                        className={`hf-chip${addressId === saved.id ? ' is-on' : ''}`}
                      >
                        <IcoPin size={15} />
                        {saved.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => { setAddressId(''); setAddress(''); setDeliveryZoneId(''); setAddressLabel('Outra'); }}
                      aria-pressed={addressId === ''}
                      className={`hf-chip${addressId === '' ? ' is-on' : ''}`}
                    >
                      <IcoPlus size={14} />
                      Nova morada
                    </button>
                  </div>
                </div>
              )}

              <label style={{ display: 'block' }}>
                <span className="hf-lbl">Zona de entrega *</span>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <span style={{ position: 'absolute', left: 16, color: 'var(--hs-ink-mute)', display: 'flex', pointerEvents: 'none' }}><IcoPin /></span>
                  <select
                    value={deliveryZoneId}
                    onChange={(e) => setDeliveryZoneId(e.target.value)}
                    className="hf-fld"
                    style={{ paddingLeft: 46 }}
                  >
                    <option value="">Selecciona uma zona</option>
                    {zones?.map((zone: any) => (
                      <option key={zone.id} value={zone.id}>{zone.name} (+{fmt(zone.fee_cents)})</option>
                    ))}
                  </select>
                </div>
              </label>
              <label style={{ display: 'block' }}>
                <span className="hf-lbl">Morada *</span>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="hf-fld"
                  placeholder="Rua, número, bairro, ponto de referência…"
                />
              </label>

              {profile && !addressId && address.trim() !== '' && (
                <div>
                  <span className="hf-lbl">Guardar esta morada como</span>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {['Casa', 'Trabalho', 'Outra'].map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setAddressLabel(option)}
                        aria-pressed={addressLabel === option}
                        className={`hf-chip${addressLabel === option ? ' is-on' : ''}`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            {scheduledFor === null ? (
              <div className="hf-fld">
                <span style={{ color: 'var(--hs-ink-mute)', display: 'flex' }}><IcoClock /></span>
                <span style={{ flex: '1 1 auto' }}>Agora</span>
                <button
                  type="button"
                  onClick={() => setScheduledFor(scheduleSlots[0]?.iso ?? null)}
                  disabled={scheduleSlots.length === 0}
                  className="hf-act"
                  style={{ opacity: scheduleSlots.length === 0 ? .4 : 1 }}
                >
                  {scheduleSlots.length === 0 ? 'Sem horários' : 'Agendar'}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Só horários em que esta loja abre — o servidor volta a validar. */}
                <select
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                  aria-label="Horário de entrega"
                  className="hf-fld"
                >
                  {scheduleSlots.map((slot) => (
                    <option key={slot.iso} value={slot.iso}>{slot.label}</option>
                  ))}
                </select>
                <button type="button" onClick={() => setScheduledFor(null)} className="hf-act" style={{ marginLeft: 0 }}>
                  Quero agora
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ── 02 Quem recebe ───────────────────────────────────────────── */}
        <section className="hf-sec">
          <SectionHead n={2}>Quem recebe</SectionHead>

          {profile ? (
            /* Já nos conhecemos. Nome e telefone ficam à vista em vez de dois
               campos a pedir para serem reescritos. */
            <div className="hf-fld" style={{ gap: 14 }}>
              <span style={{ color: 'var(--hs-gold)', display: 'flex' }}><IcoUser /></span>
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                {profile.name || 'Cliente'}
                <small className="num" style={{ display: 'block', fontSize: 11, color: 'var(--hs-ink-mute)', marginTop: 2 }}>
                  {profile.phone}
                </small>
              </span>
              <button type="button" onClick={logout} className="hf-act">Não sou eu</button>
            </div>
          ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <label style={{ display: 'block' }}>
              <span className="hf-lbl">Nome *</span>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span style={{ position: 'absolute', left: 16, color: 'var(--hs-ink-mute)', display: 'flex', pointerEvents: 'none' }}><IcoUser /></span>
                <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="hf-fld" style={{ paddingLeft: 46 }} placeholder="O teu nome" />
              </div>
            </label>
            <label style={{ display: 'block' }}>
              <span className="hf-lbl">Telefone *</span>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span style={{ position: 'absolute', left: 16, color: 'var(--hs-ink-mute)', display: 'flex', pointerEvents: 'none' }}><IcoPhone /></span>
                <input type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className="hf-fld num" style={{ paddingLeft: 46 }} placeholder="+258 XX XXX XXXX" />
              </div>
            </label>
            {showEmail ? (
              <label style={{ display: 'block' }}>
                <span className="hf-lbl">Email <span style={{ color: 'var(--hs-ink-faint)' }}>— opcional</span></span>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <span style={{ position: 'absolute', left: 16, color: 'var(--hs-ink-mute)', display: 'flex', pointerEvents: 'none' }}><IcoMail /></span>
                  <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} className="hf-fld" style={{ paddingLeft: 46 }} placeholder="email@exemplo.com" />
                </div>
              </label>
            ) : (
              <button type="button" onClick={() => setShowEmail(true)} style={{ display: 'flex', alignItems: 'center', gap: 11, minHeight: 44, color: 'var(--hs-ink-mute)' }}>
                <IcoMail />
                <span style={{ fontSize: 14 }}>Quero o talão por email</span>
                <span className="hf-act">Juntar</span>
              </button>
            )}

            {/* Telemóvel novo: entrar em vez de escrever tudo de novo. */}
            {accountReady && (
              <LoginInline requestCode={requestCode} verifyCode={verifyCode} defaultPhone={customerPhone} />
            )}
          </div>
          )}
        </section>

        {/* ── 03 Pagamento ─────────────────────────────────────────────── */}
        <section className="hf-sec">
          <SectionHead n={3}>Pagamento</SectionHead>

          {/* Toggle manual/auto — só aparece se o gateway estiver configurado */}
          {hasAutoPayment && (
            <div className="hf-seg" style={{ marginBottom: 16 }}>
              <button type="button" onClick={() => setPaymentFlow('auto')} className={`hf-seg-opt${paymentFlow === 'auto' ? ' is-on' : ''}`}>
                Pagar agora
                <small>pagas aqui</small>
              </button>
              <button type="button" onClick={() => setPaymentFlow('manual')} className={`hf-seg-opt${paymentFlow === 'manual' ? ' is-on' : ''}`}>
                Comprovativo
                <small>já paguei</small>
              </button>
            </div>
          )}

          {paymentFlow === 'manual' ? (
            <div className="hf-tiles is-2">
              <Tile tight selected={manualMethod === 'mpesa'} onClick={() => setManualMethod('mpesa')} title="M-Pesa" sub="Comprovativo" />
              <Tile tight selected={manualMethod === 'emola'} onClick={() => setManualMethod('emola')} title="e-Mola" sub="Comprovativo" />
            </div>
          ) : (
            <>
              <div className="hf-tiles is-3">
                {(['mpesa', 'emola', 'credit_card'] as AutoMethod[]).map((m) => (
                  <Tile
                    key={m}
                    tight
                    selected={autoMethod === m}
                    onClick={() => setAutoMethod(m)}
                    title={m === 'mpesa' ? 'M-Pesa' : m === 'emola' ? 'e-Mola' : 'Cartão'}
                    sub={m === 'credit_card' ? 'Visa · MC' : 'Na hora'}
                  />
                ))}
              </div>
              <p className="hf-note" style={{ marginTop: 14 }}>
                Vais confirmar o pagamento no teu telemóvel e voltas aqui.
              </p>
            </>
          )}

          <p className="hf-note" style={{ marginTop: 14 }}>
            <span className="hf-ok" style={{ display: 'flex' }}><IcoShield /></span>
            O valor é fechado por nós. Ninguém to muda a meio do caminho.
          </p>
        </section>

        {/* ── Resumo ───────────────────────────────────────────────────── */}
        <section className="hf-sec is-raised">
          <SectionHead action={<button type="button" onClick={() => router.push(`/l/${storeSlug}`)} className="hf-act">Editar</button>}>
            O teu pedido
          </SectionHead>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {cart.map((item, idx) => {
              const menuItem = menuData?.categories
                .flatMap((c: any) => c.items)
                .find((i: any) => i.id === item.menuItemId);
              const variant = item.variantId ? menuItem?.variants?.find((v: MenuVariant) => v.id === item.variantId) : undefined;
              const addons = (menuItem?.addons ?? []).filter((a: MenuAddon) => (item.addonIds ?? []).includes(a.id));
              const detail = [variant?.name, ...addons.map((a: MenuAddon) => a.name)].filter(Boolean).join(' · ');
              return (
                <div key={idx} className="hf-line">
                  <span className="hf-line-q num">{item.qty}x</span>
                  <span className="hf-line-n">
                    {menuItem?.name}
                    {detail && <small>{detail}</small>}
                  </span>
                  <span className="hf-line-p num">
                    {fmt(lineUnitPrice(menuItem, item.variantId, item.addonIds, item.modifiers) * item.qty)}
                  </span>
                </div>
              );
            })}
          </div>

          <hr className="hf-div" />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <dl className="hf-sum"><dt>Subtotal</dt><dd className="num">{fmt(subtotal)}</dd></dl>
            {deliveryFee > 0 && (
              <dl className="hf-sum"><dt>Entrega</dt><dd className="num">+ {fmt(deliveryFee)}</dd></dl>
            )}
            {discountPreview() > 0 && (
              <dl className="hf-sum is-off"><dt>Desconto ({referralCode})</dt><dd className="num">− {fmt(discountPreview())}</dd></dl>
            )}
            {couponResult?.valid && couponResult.reward_type === 'free_item' && (
              <dl className="hf-sum is-off"><dt>{couponResult.gift_item_name ?? 'Item grátis'}</dt><dd>Grátis</dd></dl>
            )}

            {/* Cupão: link discreto, não uma secção com número próprio. */}
            {referralCode && couponResult?.valid ? (
              <div className="hf-panel is-ok" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14 }}>
                <span className="hf-ok" style={{ display: 'flex' }}><IcoCheck size={16} /></span>
                <span className="num" style={{ flex: '1 1 auto', fontFamily: 'var(--font-condensed)', fontSize: 20, letterSpacing: '.18em', color: 'var(--hs-ink)' }}>
                  {referralCode}
                </span>
                <button type="button" onClick={removeCoupon} aria-label="Remover código" style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', color: 'var(--hs-ink-mute)' }}>✕</button>
              </div>
            ) : showCoupon ? (
              <div>
                <div className="hf-fld-row">
                  <input
                    type="text"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && applyCoupon()}
                    placeholder="O TEU CÓDIGO"
                    maxLength={50}
                    className="hf-fld num"
                    style={{ letterSpacing: '.16em' }}
                    aria-label="Código de desconto"
                  />
                  <button
                    type="button"
                    onClick={applyCoupon}
                    disabled={couponLoading || !couponInput.trim()}
                    className="hf-btn hf-btn-ghost hf-btn-sm"
                  >
                    {couponLoading ? '…' : 'Aplicar'}
                  </button>
                </div>
                {couponResult && !couponResult.valid && (
                  <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--hs-ember)' }}>
                    {couponResult.reason === 'auto_redemption'          ? 'Não podes usar o teu próprio código.' :
                     couponResult.reason === 'already_redeemed'        ? 'Já usaste este código antes.' :
                     couponResult.reason === 'max_redemptions_reached' ? 'Este código atingiu o limite de utilizações.' :
                     'Código inválido ou expirado.'}
                  </p>
                )}
              </div>
            ) : (
              <button type="button" onClick={() => setShowCoupon(true)} style={{ display: 'flex', alignItems: 'center', gap: 11, minHeight: 44, color: 'var(--hs-ink-dim)' }}>
                <IcoTicket />
                <span style={{ fontSize: 14 }}>Tenho um código de desconto</span>
              </button>
            )}

            {referralCode && (
              <p style={{ margin: 0, fontSize: 11, color: 'var(--hs-ink-faint)' }}>
                O desconto final é confirmado pelo servidor.
              </p>
            )}
          </div>
        </section>

        {/* ── Barra de acção ───────────────────────────────────────────── */}
        <div className="hf-bar">
          <dl className="hf-bar-total">
            <dt>{referralCode ? 'Total estimado' : 'Total'}</dt>
            <dd className="num">{fmt(dueCents)}</dd>
          </dl>
          <button
            onClick={paymentFlow === 'auto' ? handleCreateAutoOrder : handleCreateManualOrder}
            disabled={cart.length === 0 || isSubmitting}
            className="hf-btn hf-btn-gold"
          >
            <span className="num">{ctaLabel}</span>
            {!isSubmitting && <IcoArrow />}
          </button>
        </div>
        <FunnelFoot />
      </div>
    </div>
  );
}
