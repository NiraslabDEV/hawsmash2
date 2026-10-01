'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  REWARD_LABEL,
  buildCouponRow,
  describeCoupon,
  maputoDateInput,
  type CouponDraft,
  type CouponRewardType,
} from '@/lib/admin/promotions';
import { createClient } from '@/utils/supabase/client';

type Coupon = {
  id: string;
  code: string;
  owner_name: string;
  owner_phone: string | null;
  reward_type: CouponRewardType;
  reward_value: number;
  gift_item_id: string | null;
  max_redemptions: number;
  active: boolean;
  expires_at: string | null;
  store_id: string | null;
  created_at: string;
};

type Usage = { code_id: string; redemptions: number; last_at: string };
type Store = { id: string; short_name: string };
type MenuItem = { id: string; name: string };

const EMPTY: CouponDraft = {
  code: '',
  ownerName: '',
  ownerPhone: '',
  rewardType: 'discount_pct',
  pct: '10',
  valueMT: '',
  giftItemId: '',
  maxRedemptions: '100',
  expiresOn: '',
  storeId: '',
};

const input = 'mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white placeholder:text-[#6f6a62]';
const lbl = 'block text-xs font-bold uppercase tracking-wide text-[#8b8378]';

export function CouponsSection({ stores }: { stores: Store[] }) {
  const supabase = useMemo(() => createClient(), []);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [items, setItems] = useState<MenuItem[]>([]);
  const [draft, setDraft] = useState<CouponDraft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const [codesRes, usageRes, itemsRes] = await Promise.all([
      supabase
        .from('referral_codes')
        .select('id,code,owner_name,owner_phone,reward_type,reward_value,gift_item_id,max_redemptions,active,expires_at,store_id,created_at')
        .order('created_at', { ascending: false }),
      supabase.rpc('get_coupon_usage'),
      supabase.from('menu_items').select('id,name').order('name'),
    ]);
    if (codesRes.error) {
      setMessage({ tone: 'error', text: `Não foi possível ler os cupões: ${codesRes.error.message}` });
      return;
    }
    setCoupons((codesRes.data ?? []) as Coupon[]);
    const counts: Record<string, number> = {};
    for (const u of (usageRes.data ?? []) as Usage[]) counts[u.code_id] = u.redemptions;
    setUsage(counts);
    setItems((itemsRes.data ?? []) as MenuItem[]);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const itemName = (id: string | null) => items.find((i) => i.id === id)?.name ?? null;
  const storeName = (id: string | null) => (id ? stores.find((s) => s.id === id)?.short_name ?? 'loja removida' : 'Todas as lojas');

  async function create() {
    if (!draft) return;
    setMessage(null);
    const built = buildCouponRow(draft);
    if (!built.ok) {
      setMessage({ tone: 'error', text: built.error });
      return;
    }
    setBusy(true);
    const { error } = await supabase.from('referral_codes').insert(built.value).select('id');
    if (!error && built.value.reward_type === 'free_item' && built.value.gift_item_id) {
      // O motor só dá a 0 um produto marcado como brinde (is_gift).
      await supabase.from('menu_items').update({ is_gift: true }).eq('id', built.value.gift_item_id);
    }
    setBusy(false);
    if (error) {
      setMessage({
        tone: 'error',
        text: error.message.includes('duplicate') ? 'Já existe um cupão com esse código.' : `Não gravou: ${error.message}`,
      });
      return;
    }
    setDraft(null);
    setMessage({ tone: 'ok', text: `Cupão ${built.value.code} criado.` });
    await load();
  }

  async function toggle(c: Coupon) {
    setBusy(true);
    const { error } = await supabase.from('referral_codes').update({ active: !c.active }).eq('id', c.id).select('id');
    setBusy(false);
    if (error) setMessage({ tone: 'error', text: `Não gravou: ${error.message}` });
    await load();
  }

  async function remove(c: Coupon) {
    setBusy(true);
    const { error } = await supabase.from('referral_codes').delete().eq('id', c.id);
    setBusy(false);
    setConfirmDelete(null);
    if (error) {
      setMessage({ tone: 'error', text: 'Não foi possível apagar — um cupão já usado fica no histórico. Desliga-o em vez disso.' });
      return;
    }
    setMessage({ tone: 'ok', text: `Cupão ${c.code} apagado.` });
    await load();
  }

  return (
    <section className="rounded-2xl border border-white/[0.08] p-5 space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-white">Cupões</h3>
          <p className="text-xs text-[#8b8378]">
            Códigos para o checkout do site e para o caixa do POS (no balcão pede-se o telefone). Cada telefone usa cada código uma vez. A % conta depois do 2x1.
          </p>
        </div>
        <button type="button" onClick={() => { setDraft(EMPTY); setMessage(null); }} className="rounded-xl bg-[#e5a93c] px-4 py-2 text-sm font-black text-black">
          + Novo cupão
        </button>
      </header>

      {message && (
        <p className={`rounded-xl border px-4 py-3 text-sm ${message.tone === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'}`}>
          {message.text}
        </p>
      )}

      {coupons.length === 0 ? (
        <p className="text-sm text-[#8b8378]">Ainda não há cupões.</p>
      ) : (
        <div className="space-y-2">
          {coupons.map((c) => {
            const expired = c.expires_at && new Date(c.expires_at) <= new Date();
            const used = usage[c.id] ?? 0;
            const full = used >= c.max_redemptions;
            return (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-base font-black text-white">{c.code}</span>
                    <span className="rounded-full bg-[#e5a93c]/15 px-2 py-0.5 text-[11px] font-bold text-[#e5a93c]">{REWARD_LABEL[c.reward_type]}</span>
                    {!c.active && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-[#8b8378]">desligado</span>}
                    {expired && <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-[11px] text-yellow-300">expirado</span>}
                    {full && <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-[11px] text-yellow-300">esgotado</span>}
                  </div>
                  <p className="mt-1 text-sm text-[#C9BCAC]">
                    {describeCoupon(c, itemName(c.gift_item_id))} · {storeName(c.store_id)} · {used}/{c.max_redemptions} usos
                    {c.expires_at ? ` · até ${maputoDateInput(c.expires_at, true).split('-').reverse().join('/')}` : ''}
                    {c.owner_name ? ` · ${c.owner_name}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" disabled={busy} onClick={() => void toggle(c)} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-[#C9BCAC] hover:text-white">
                    {c.active ? 'Desligar' : 'Ligar'}
                  </button>
                  {used === 0 &&
                    (confirmDelete === c.id ? (
                      <button type="button" disabled={busy} onClick={() => void remove(c)} className="rounded-xl bg-red-500/20 px-3 py-2 text-xs font-bold text-red-300">
                        Confirmar apagar
                      </button>
                    ) : (
                      <button type="button" onClick={() => setConfirmDelete(c.id)} className="rounded-xl px-3 py-2 text-xs font-bold text-red-300">
                        Apagar
                      </button>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Novo cupão">
          <form
            onSubmit={(e) => { e.preventDefault(); void create(); }}
            className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#150D08] p-5"
          >
            <h3 className="text-lg font-black text-[#e5a93c]">Novo cupão</h3>
            {message?.tone === 'error' && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">{message.text}</p>}

            <div>
              <span className={lbl}>Código (o que o cliente escreve)</span>
              <input value={draft.code} maxLength={40} placeholder="HAWS10" onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} className={`${input} font-mono tracking-wider`} />
            </div>

            <div>
              <span className={lbl}>Tipo</span>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(Object.keys(REWARD_LABEL) as CouponRewardType[]).map((t) => (
                  <button key={t} type="button" onClick={() => setDraft({ ...draft, rewardType: t })}
                    className={`rounded-xl border px-3 py-2 text-sm font-bold ${draft.rewardType === t ? 'border-[#e5a93c] bg-[#e5a93c] text-black' : 'border-white/10 text-[#C9BCAC]'}`}>
                    {REWARD_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>

            {draft.rewardType === 'discount_pct' && (
              <div>
                <span className={lbl}>Percentagem</span>
                <input value={draft.pct} inputMode="numeric" onChange={(e) => setDraft({ ...draft, pct: e.target.value })} className={input} />
              </div>
            )}
            {draft.rewardType === 'discount_cents' && (
              <div>
                <span className={lbl}>Valor (MT)</span>
                <input value={draft.valueMT} inputMode="decimal" placeholder="100" onChange={(e) => setDraft({ ...draft, valueMT: e.target.value })} className={input} />
              </div>
            )}
            {draft.rewardType === 'free_item' && (
              <div>
                <span className={lbl}>Produto que sai grátis</span>
                <select value={draft.giftItemId} onChange={(e) => setDraft({ ...draft, giftItemId: e.target.value })} className={input}>
                  <option value="">Escolher…</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-[#6f6a62]">Entra a 0 MT no pedido de quem usar o código (1 unidade).</p>
              </div>
            )}
            {draft.rewardType === 'bogo' && (
              <p className="text-sm text-[#C9BCAC]">Liberta o 2x1 nos produtos marcados, mesmo em dias em que a promo está desligada.</p>
            )}

            <div>
              <span className={lbl}>Loja</span>
              <select value={draft.storeId} onChange={(e) => setDraft({ ...draft, storeId: e.target.value })} className={input}>
                <option value="">Todas as lojas</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.short_name}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className={lbl}>Máx. utilizações</span>
                <input value={draft.maxRedemptions} inputMode="numeric" onChange={(e) => setDraft({ ...draft, maxRedemptions: e.target.value })} className={input} />
              </div>
              <div>
                <span className={lbl}>Último dia (opcional)</span>
                <input type="date" value={draft.expiresOn} onChange={(e) => setDraft({ ...draft, expiresOn: e.target.value })} className={input} />
              </div>
            </div>

            <div>
              <span className={lbl}>Nome / campanha (opcional)</span>
              <input value={draft.ownerName} placeholder="Ex.: Influencer, Campanha Outubro" onChange={(e) => setDraft({ ...draft, ownerName: e.target.value })} className={input} />
            </div>
            <div>
              <span className={lbl}>Telefone do dono do código (opcional)</span>
              <input value={draft.ownerPhone} inputMode="tel" placeholder="+258 …" onChange={(e) => setDraft({ ...draft, ownerPhone: e.target.value })} className={input} />
              <p className="mt-1 text-[11px] text-[#6f6a62]">Para códigos de indicação: esse número não pode usar o próprio código.</p>
            </div>

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => { setDraft(null); setMessage(null); }} className="flex-1 rounded-xl border border-white/10 py-3 text-sm font-bold text-[#C9BCAC]">Cancelar</button>
              <button type="submit" disabled={busy} className="flex-1 rounded-xl bg-[#e5a93c] py-3 text-sm font-black text-black disabled:opacity-50">{busy ? 'A criar…' : 'Criar cupão'}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
