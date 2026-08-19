'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import { formatMT, type Cents } from '@delivery/core';
import { createClient } from '@/utils/supabase/client';
import { brand } from '@brand';

const mt = (cents: number) => formatMT(cents as Cents);
const ST = brand.storefront;
const FALLBACK_IMAGE = ST.fallbackImages[0];

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
type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  photo_url: string | null;
  available: boolean;
  modifier_groups: ModifierGroup[];
};
type Category = { id: string; name: string; items: MenuItem[] };
type Menu = { categories: Category[]; accepting_orders: boolean };

type CartLine = {
  key: string;
  menuItemId: string;
  name: string;
  qty: number;
  unitPreview: number; // preview — o servidor recalcula em create_order
  selections: Record<string, string[]>;
  notes: string;
  who: number; // índice em `people`
};

function lineExtraPreview(group: ModifierGroup, optionIds: string[]): number {
  const chosen = group.options.filter((o) => optionIds.includes(o.id));
  const base = chosen.reduce((s, o) => s + o.price_cents, 0);
  const extraQty = Math.max(optionIds.length - group.free_quantity, 0);
  return base + extraQty * group.extra_price_cents;
}

// DECISÃO: um item com 3+ grupos (ex.: pequeno-almoço = ovo + pão +
// acompanhamentos) é apresentado passo a passo, como no protótipo. Com 1–2
// grupos mostra-se tudo de uma vez — obrigar a "Continuar" seria fricção.
const isGuided = (item: MenuItem) => item.modifier_groups.length >= 3;

export default function TableMenuPage() {
  const params = useParams();
  const token = String(params.token ?? '');
  const supabase = useMemo(() => createClient(), []);

  const [tableStatus, setTableStatus] = useState<'loading' | 'ok' | 'invalid'>('loading');
  const [tableId, setTableId] = useState<string | null>(null);
  const [tableNumber, setTableNumber] = useState<number | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);

  const [people, setPeople] = useState<string[]>(['Pessoa 1']);
  const [who, setWho] = useState(0);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const [cart, setCart] = useState<CartLine[]>([]);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<{ summary: string } | null>(null);
  // Resumo antes de enviar: à mesa várias pessoas mexem no mesmo telemóvel,
  // por isso ninguém deve mandar para o balcão sem ver o que ficou no pedido.
  const [reviewOpen, setReviewOpen] = useState(false);

  const [openItem, setOpenItem] = useState<string | null>(null);
  const [draftSelections, setDraftSelections] = useState<Record<string, string[]>>({});
  const [draftQty, setDraftQty] = useState(1);
  const [draftNotes, setDraftNotes] = useState('');
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!token) return;
    supabase.rpc('get_table_by_token', { p_token: token }).then(({ data, error: err }) => {
      if (err || !data) {
        setTableStatus('invalid');
        return;
      }
      setTableId(data.id);
      setTableNumber(data.number);
      setTableStatus('ok');
    });
  }, [token, supabase]);

  useEffect(() => {
    if (tableStatus !== 'ok') return;
    fetch('/api/menu?channel=dine_in')
      .then((r) => r.json())
      .then((data: Menu) => {
        setMenu(data);
        const first = data.categories?.find((c) => c.items.length > 0);
        if (first) setActiveCat(first.id);
      });
  }, [tableStatus]);

  const categories = (menu?.categories ?? []).filter((c) => c.items.some((i) => i.available));
  const currentCat = categories.find((c) => c.id === activeCat) ?? categories[0];
  const openMenuItem = menu?.categories.flatMap((c) => c.items).find((i) => i.id === openItem) ?? null;

  const qtyOfItem = (itemId: string) =>
    cart.filter((l) => l.menuItemId === itemId && l.who === who).reduce((s, l) => s + l.qty, 0);

  const countFor = (index: number) =>
    cart.filter((l) => l.who === index).reduce((s, l) => s + l.qty, 0);

  const totalCount = cart.reduce((s, l) => s + l.qty, 0);
  const total = cart.reduce((s, l) => s + l.unitPreview * l.qty, 0);
  const summary = `${totalCount} itens · ${people.map((p, i) => `${p} ${countFor(i)}`).join(' · ')}`;

  function openCustomize(item: MenuItem) {
    const defaults: Record<string, string[]> = {};
    for (const g of item.modifier_groups) defaults[g.id] = [];
    setDraftSelections(defaults);
    setDraftQty(1);
    setDraftNotes('');
    setStep(0);
    setError('');
    setOpenItem(item.id);
  }

  /** Item simples entra direto; item com escolhas abre a folha de opções. */
  function addItem(item: MenuItem) {
    if (item.modifier_groups.length > 0) {
      openCustomize(item);
      return;
    }
    setCart((prev) => {
      const existing = prev.find(
        (l) => l.menuItemId === item.id && l.who === who && Object.keys(l.selections).length === 0 && !l.notes,
      );
      if (existing) {
        return prev.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l));
      }
      return [
        ...prev,
        {
          key: crypto.randomUUID(),
          menuItemId: item.id,
          name: item.name,
          qty: 1,
          unitPreview: item.price_cents,
          selections: {},
          notes: '',
          who,
        },
      ];
    });
  }

  function decItem(item: MenuItem) {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.menuItemId === item.id && l.who === who);
      if (idx < 0) return prev;
      const line = prev[idx];
      if (line.qty > 1) {
        return prev.map((l, i) => (i === idx ? { ...l, qty: l.qty - 1 } : l));
      }
      return prev.filter((_, i) => i !== idx);
    });
  }

  function toggleOption(group: ModifierGroup, optionId: string) {
    setDraftSelections((prev) => {
      const current = prev[group.id] ?? [];
      if (group.selection_type === 'single') return { ...prev, [group.id]: [optionId] };
      if (current.includes(optionId)) {
        return { ...prev, [group.id]: current.filter((id) => id !== optionId) };
      }
      if (current.length >= group.max_select) return prev;
      return { ...prev, [group.id]: [...current, optionId] };
    });
  }

  function draftUnitPrice(item: MenuItem) {
    return (
      item.price_cents +
      item.modifier_groups.reduce((s, g) => s + lineExtraPreview(g, draftSelections[g.id] ?? []), 0)
    );
  }

  function commitDraft(item: MenuItem) {
    for (const g of item.modifier_groups) {
      const n = (draftSelections[g.id] ?? []).length;
      if (n < g.min_select || n > g.max_select) {
        setError(`"${g.name}": escolhe entre ${g.min_select} e ${g.max_select} opções.`);
        return;
      }
    }
    setError('');
    setCart((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        menuItemId: item.id,
        name: item.name,
        qty: draftQty,
        unitPreview: draftUnitPrice(item),
        selections: draftSelections,
        notes: draftNotes,
        who,
      },
    ]);
    setOpenItem(null);
  }

  function addPerson() {
    setPeople((prev) => {
      const next = [...prev, `Pessoa ${prev.length + 1}`];
      setWho(next.length - 1);
      return next;
    });
  }

  function commitRename(index: number) {
    const name = renameDraft.trim();
    if (name) setPeople((prev) => prev.map((p, i) => (i === index ? name : p)));
    setRenaming(null);
  }

  const itemById = (id: string) =>
    menu?.categories.flatMap((c) => c.items).find((i) => i.id === id) ?? null;

  /** Escolhas de uma linha, legíveis ("Batata Frita, Salada · Molho de Manteiga"). */
  function lineOptions(line: CartLine): string {
    const item = itemById(line.menuItemId);
    if (!item) return '';
    return item.modifier_groups
      .map((g) => {
        const ids = line.selections[g.id] ?? [];
        return g.options.filter((o) => ids.includes(o.id)).map((o) => o.name).join(', ');
      })
      .filter(Boolean)
      .join(' · ');
  }

  function removeLine(key: string) {
    setCart((prev) => {
      const next = prev.filter((l) => l.key !== key);
      if (next.length === 0) setReviewOpen(false);
      return next;
    });
  }

  async function confirmOrder() {
    if (cart.length === 0) return;
    setSubmitting(true);
    setError('');

    const payload = {
      items: cart.map((l) => ({
        menuItemId: l.menuItemId,
        qty: l.qty,
        modifiers: Object.entries(l.selections)
          .filter(([, optionIds]) => optionIds.length > 0)
          .map(([groupId, optionIds]) => ({ groupId, optionIds })),
        notes: l.notes || undefined,
        person: people[l.who],
      })),
      fulfillmentType: 'dine_in',
      tableId,
    };

    try {
      const res = await fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erro ao confirmar o pedido.');
        setSubmitting(false);
        return;
      }
      setSent({ summary });
      setCart([]);
      setReviewOpen(false);
    } catch {
      setError('Erro de ligação. Tenta novamente.');
    }
    setSubmitting(false);
  }

  if (tableStatus === 'loading') return <Centered>A carregar mesa…</Centered>;
  if (tableStatus === 'invalid') return <Centered>Mesa inválida ou inativa. Chama um funcionário.</Centered>;

  // ── Ecrã de confirmação ───────────────────────────────────────────────────
  if (sent) {
    return (
      <div
        className="mx-auto w-full max-w-[430px] flex flex-col items-center justify-center text-center"
        style={{
          minHeight: '100vh',
          padding: '60px 30px 40px',
          background: `linear-gradient(180deg, ${ST.card}, ${ST.surface2})`,
        }}
      >
        <div
          className="flex items-center justify-center"
          style={{
            width: 118,
            height: 118,
            borderRadius: 999,
            background: ST.text,
            border: `2px solid ${ST.primary}`,
            boxShadow: '0 14px 30px rgba(42,23,16,.28)',
            marginBottom: 18,
          }}
        >
          <svg width="46" height="36" viewBox="0 0 46 36" fill="none" aria-hidden>
            <path d="M4 20l12 11L42 4" stroke={ST.primary} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div style={{ color: ST.star, fontSize: 10, letterSpacing: '5px' }}>★★★</div>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 32,
            lineHeight: 1,
            letterSpacing: '.8px',
            color: ST.text,
            textTransform: 'uppercase',
            marginTop: 8,
          }}
        >
          Pedido enviado
          <br />
          para o balcão!
        </h1>
        <p style={{ fontSize: 13.5, color: ST.muted, marginTop: 10, lineHeight: 1.55 }}>
          Mesa {tableNumber} · {sent.summary}
          <br />
          A equipa vai lançar o pedido e a cozinha começa já.
          <br />
          Paga no balcão ou à mesa quando quiser.
        </p>
        <button
          onClick={() => {
            setSent(null);
            setError('');
          }}
          style={{
            marginTop: 26,
            padding: '14px 24px',
            borderRadius: 999,
            border: `1.5px solid ${ST.text}`,
            fontFamily: 'var(--font-display)',
            fontSize: 13.5,
            letterSpacing: '1.6px',
            color: ST.text,
            textTransform: 'uppercase',
          }}
        >
          Pedir mais
        </button>
      </div>
    );
  }

  return (
    <div
      className="relative mx-auto flex w-full max-w-[430px] flex-col"
      style={{ background: ST.bg, minHeight: '100vh', color: ST.text }}
    >
      {/* ── Cabeçalho da mesa ────────────────────────────────────────────── */}
      <header
        style={{
          flex: 'none',
          padding: '34px 18px 14px',
          background: ST.text,
        }}
      >
        <div className="flex items-center" style={{ gap: 13 }}>
          <div
            className="flex items-center justify-center overflow-hidden"
            style={{ width: 52, height: 52, borderRadius: 13, background: ST.onDark, flex: 'none' }}
          >
            <Image
              src={ST.logoImage}
              alt={brand.name}
              width={46}
              height={46}
              className="object-contain"
              priority
            />
          </div>
          <div className="flex-1">
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 26,
                lineHeight: 1,
                letterSpacing: '1.4px',
                color: ST.onDark,
                textTransform: 'uppercase',
              }}
            >
              Mesa {String(tableNumber ?? '').padStart(2, '0')}
            </div>
            <div
              style={{
                fontSize: 10,
                letterSpacing: '2.2px',
                color: ST.primary,
                textTransform: 'uppercase',
                fontWeight: 600,
                marginTop: 3,
              }}
            >
              {brand.name}
            </div>
          </div>
        </div>

        <p
          style={{
            marginTop: 12,
            padding: '10px 13px',
            borderRadius: 12,
            background: 'rgba(245,166,35,.13)',
            border: '1px solid rgba(245,166,35,.32)',
            fontSize: 12,
            lineHeight: 1.45,
            color: ST.onDarkSoft,
          }}
        >
          Pedido <strong style={{ color: ST.primary }}>sem pagamento</strong> — escolhe, envia para a cozinha e paga no
          balcão ou à mesa.
        </p>

        <div style={{ marginTop: 14 }}>
          <div
            style={{
              fontSize: 9.5,
              letterSpacing: '2.4px',
              color: ST.onDarkMuted,
              textTransform: 'uppercase',
              fontWeight: 700,
              marginBottom: 8,
            }}
          >
            A pedir para
          </div>
          <div className="flex flex-wrap" style={{ gap: 7 }}>
            {people.map((person, i) => {
              const active = i === who;
              if (renaming === i) {
                return (
                  <input
                    key={i}
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => commitRename(i)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(i);
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    maxLength={20}
                    style={{
                      padding: '8px 13px',
                      borderRadius: 999,
                      background: 'transparent',
                      border: `1px solid ${ST.primary}`,
                      fontFamily: 'var(--font-display)',
                      fontSize: 13,
                      letterSpacing: '1px',
                      color: ST.onDark,
                      textTransform: 'uppercase',
                      outline: 'none',
                      width: 120,
                    }}
                  />
                );
              }
              return (
                <button
                  key={i}
                  onClick={() => {
                    if (active) {
                      setRenameDraft(person);
                      setRenaming(i);
                    } else {
                      setWho(i);
                    }
                  }}
                  title={active ? 'Tocar para mudar o nome' : undefined}
                  className="flex items-center"
                  style={{
                    gap: 7,
                    padding: '8px 13px',
                    borderRadius: 999,
                    background: active ? ST.grad : 'transparent',
                    border: active ? '1px solid transparent' : '1px solid rgba(255,253,248,.24)',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 13,
                      letterSpacing: '1px',
                      color: active ? ST.text : ST.onDarkSoft,
                      textTransform: 'uppercase',
                    }}
                  >
                    {person}
                  </span>
                  <span
                    style={{
                      fontSize: 10.5,
                      color: active ? 'rgba(42,23,16,.7)' : ST.muted2,
                      fontWeight: 700,
                    }}
                  >
                    {countFor(i)} itens
                  </span>
                </button>
              );
            })}
            <button
              onClick={addPerson}
              className="flex items-center"
              style={{
                gap: 6,
                padding: '8px 13px',
                borderRadius: 999,
                border: '1px dashed rgba(245,166,35,.5)',
                color: ST.primary,
                fontSize: 11.5,
                fontWeight: 600,
              }}
            >
              + Pessoa
            </button>
          </div>
        </div>
      </header>

      {menu && !menu.accepting_orders && (
        <div
          style={{
            margin: '12px 16px 0',
            padding: '10px 13px',
            borderRadius: 12,
            background: 'rgba(232,135,26,.12)',
            border: `1px solid ${ST.primary2}`,
            color: ST.textSoft,
            fontSize: 12.5,
          }}
        >
          A cozinha está fechada de momento.
        </div>
      )}

      {/* ── Categorias ───────────────────────────────────────────────────── */}
      <div
        className="flex overflow-x-auto"
        style={{
          flex: 'none',
          gap: 7,
          padding: '12px 16px',
          background: ST.card,
          borderBottom: `1px solid ${ST.line}`,
        }}
      >
        {categories.map((c) => {
          const active = c.id === currentCat?.id;
          return (
            <button
              key={c.id}
              onClick={() => setActiveCat(c.id)}
              style={{
                flex: 'none',
                padding: '9px 14px',
                borderRadius: 999,
                background: active ? ST.text : 'transparent',
                border: active ? '1px solid transparent' : `1px solid rgba(42,23,16,.14)`,
                fontFamily: 'var(--font-display)',
                fontSize: 12.5,
                letterSpacing: '1.2px',
                color: active ? ST.primary : ST.muted3,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              {c.name}
            </button>
          );
        })}
      </div>

      {/* ── Itens ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto" style={{ padding: '16px 16px 130px' }}>
        <div className="flex flex-col" style={{ gap: 9 }}>
          {currentCat?.items
            .filter((i) => i.available)
            .map((item) => {
              const qty = qtyOfItem(item.id);
              return (
                <div
                  key={item.id}
                  className="flex items-center"
                  style={{
                    gap: 12,
                    padding: 9,
                    background: ST.card,
                    border: `1px solid ${ST.line}`,
                    borderRadius: 14,
                  }}
                >
                  <div
                    className="relative overflow-hidden"
                    style={{ width: 64, height: 64, borderRadius: 11, background: ST.photoBg, flex: 'none' }}
                  >
                    <Image
                      src={item.photo_url || FALLBACK_IMAGE}
                      alt={item.name}
                      fill
                      className="object-cover"
                      sizes="64px"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 15,
                        lineHeight: 1.05,
                        letterSpacing: '.5px',
                        color: ST.text,
                        textTransform: 'uppercase',
                      }}
                    >
                      {item.name}
                    </div>
                    <div style={{ fontSize: 11, color: ST.muted2, marginTop: 2 }}>
                      {item.modifier_groups.length > 0 ? 'Escolhas à medida' : 'Pronto em 15–20 min'}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 14,
                        color: ST.primary2,
                        marginTop: 3,
                      }}
                    >
                      {mt(item.price_cents)}
                    </div>
                  </div>

                  {qty === 0 ? (
                    <button
                      onClick={() => addItem(item)}
                      aria-label={`Adicionar ${item.name}`}
                      className="flex items-center justify-center"
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 999,
                        background: ST.grad,
                        flex: 'none',
                        boxShadow: '0 5px 12px rgba(232,135,26,.3)',
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 14 14" fill="none" aria-hidden>
                        <path d="M7 1.5v11M1.5 7h11" stroke={ST.text} strokeWidth="2.4" strokeLinecap="round" />
                      </svg>
                    </button>
                  ) : (
                    <div
                      className="flex items-center"
                      style={{ gap: 9, padding: '4px 5px', borderRadius: 999, background: ST.text, flex: 'none' }}
                    >
                      <button
                        onClick={() => decItem(item)}
                        aria-label={`Retirar ${item.name}`}
                        className="flex items-center justify-center"
                        style={{ width: 26, height: 26, borderRadius: 999, color: ST.onDarkSoft, fontSize: 17 }}
                      >
                        −
                      </button>
                      <span
                        style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: 14,
                          color: ST.primary,
                          minWidth: 11,
                          textAlign: 'center',
                        }}
                      >
                        {qty}
                      </span>
                      <button
                        onClick={() => addItem(item)}
                        aria-label={`Mais ${item.name}`}
                        className="flex items-center justify-center"
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 999,
                          background: ST.primary,
                          color: ST.text,
                          fontSize: 15,
                          fontWeight: 700,
                        }}
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      {/* ── Barra de confirmação ─────────────────────────────────────────── */}
      {totalCount > 0 && !openMenuItem && (
        <div
          className="fixed bottom-0 z-40 w-full max-w-[430px]"
          style={{
            padding: '14px 16px 40px',
            background: ST.card,
            borderTop: `1px solid rgba(42,23,16,.12)`,
            boxShadow: '0 -10px 26px rgba(42,23,16,.1)',
          }}
        >
          <div className="flex items-center justify-between" style={{ gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 11.5, color: ST.muted3 }}>{summary}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: ST.text }}>{mt(total)}</div>
          </div>

          {error && (
            <p style={{ fontSize: 12, color: ST.primary2, marginBottom: 8 }} role="alert">
              {error}
            </p>
          )}

          <button
            onClick={() => {
              setError('');
              setReviewOpen(true);
            }}
            className="w-full"
            style={{
              padding: 16,
              borderRadius: 14,
              background: ST.grad,
              textAlign: 'center',
              fontFamily: 'var(--font-display)',
              fontSize: 16,
              letterSpacing: '1.8px',
              color: ST.text,
              textTransform: 'uppercase',
              boxShadow: '0 10px 22px rgba(232,135,26,.32)',
            }}
          >
            Confirmar pedido
          </button>
          <div style={{ textAlign: 'center', fontSize: 10, color: ST.faint, marginTop: 7 }}>
            Vais rever o pedido antes de enviar · pagamento no balcão
          </div>
        </div>
      )}

      {/* ── Rever o pedido antes de enviar ──────────────────────────────── */}
      {reviewOpen && !openMenuItem && (
        <div className="fixed inset-0 z-[60] mx-auto w-full max-w-[430px]">
          <button
            aria-label="Voltar ao cardápio"
            onClick={() => setReviewOpen(false)}
            className="absolute inset-0 w-full"
            style={{ background: 'rgba(42,23,16,.6)', backdropFilter: 'blur(2px)' }}
          />
          <div
            className="absolute inset-x-0 bottom-0 flex flex-col overflow-hidden"
            style={{
              maxHeight: '88vh',
              background: ST.bg,
              borderRadius: '26px 26px 0 0',
              boxShadow: '0 -14px 40px rgba(42,23,16,.34)',
            }}
          >
            <div className="flex items-center" style={{ padding: '20px 18px 16px', background: ST.text, gap: 12 }}>
              <div className="flex-1">
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 20,
                    letterSpacing: '1.2px',
                    color: ST.onDark,
                    textTransform: 'uppercase',
                    lineHeight: 1,
                  }}
                >
                  Rever pedido
                </div>
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
                  Mesa {String(tableNumber ?? '').padStart(2, '0')}
                </div>
              </div>
              <button
                onClick={() => setReviewOpen(false)}
                aria-label="Voltar ao cardápio"
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

            <div className="flex-1 overflow-auto" style={{ padding: '16px 18px' }}>
              {people.map((person, i) => {
                const lines = cart.filter((l) => l.who === i);
                if (lines.length === 0) return null;
                return (
                  <div key={i} style={{ marginBottom: 18 }}>
                    <div className="flex items-baseline justify-between" style={{ marginBottom: 8 }}>
                      <div
                        style={{
                          fontFamily: 'var(--font-display)',
                          fontSize: 15,
                          letterSpacing: '1px',
                          color: ST.text,
                          textTransform: 'uppercase',
                        }}
                      >
                        {person}
                      </div>
                      <div style={{ fontSize: 11, color: ST.muted2 }}>
                        {lines.reduce((s, l) => s + l.qty, 0)} itens
                      </div>
                    </div>

                    <div className="flex flex-col" style={{ gap: 8 }}>
                      {lines.map((l) => {
                        const opts = lineOptions(l);
                        return (
                          <div
                            key={l.key}
                            className="flex items-start"
                            style={{
                              gap: 10,
                              padding: '10px 12px',
                              background: ST.card,
                              border: `1px solid ${ST.line}`,
                              borderRadius: 12,
                            }}
                          >
                            <span
                              style={{
                                fontFamily: 'var(--font-display)',
                                fontSize: 14,
                                color: ST.primary2,
                                flex: 'none',
                                minWidth: 22,
                              }}
                            >
                              {l.qty}×
                            </span>
                            <div className="min-w-0 flex-1">
                              <div style={{ fontSize: 13.5, color: ST.text, fontWeight: 600, lineHeight: 1.25 }}>
                                {l.name}
                              </div>
                              {opts && (
                                <div style={{ fontSize: 11, color: ST.muted2, lineHeight: 1.4, marginTop: 2 }}>
                                  {opts}
                                </div>
                              )}
                              {l.notes && (
                                <div style={{ fontSize: 11, color: ST.muted3, lineHeight: 1.4, marginTop: 2 }}>
                                  Obs: {l.notes}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col items-end" style={{ gap: 4, flex: 'none' }}>
                              <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: ST.text }}>
                                {mt(l.unitPreview * l.qty)}
                              </span>
                              <button
                                onClick={() => removeLine(l.key)}
                                aria-label={`Remover ${l.name}`}
                                style={{ fontSize: 10.5, color: ST.faint, textDecoration: 'underline' }}
                              >
                                remover
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ padding: '14px 18px 40px', background: ST.card, borderTop: `1px solid ${ST.line}` }}>
              <div
                className="flex items-baseline justify-between"
                style={{ paddingBottom: 10, borderBottom: '1px dashed rgba(42,23,16,.18)', marginBottom: 12 }}
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
                  Total
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: ST.primary2 }}>
                  {mt(total)}
                </span>
              </div>

              {error && (
                <p style={{ fontSize: 12.5, color: ST.primary2, marginBottom: 10 }} role="alert">
                  {error}
                </p>
              )}

              <button
                onClick={confirmOrder}
                disabled={submitting || cart.length === 0}
                className="w-full disabled:opacity-60"
                style={{
                  padding: 16,
                  borderRadius: 14,
                  background: ST.grad,
                  textAlign: 'center',
                  fontFamily: 'var(--font-display)',
                  fontSize: 16,
                  letterSpacing: '1.8px',
                  color: ST.text,
                  textTransform: 'uppercase',
                  boxShadow: '0 10px 22px rgba(232,135,26,.32)',
                }}
              >
                {submitting ? 'A enviar…' : 'Enviar para o balcão'}
              </button>
              <div style={{ textAlign: 'center', fontSize: 10, color: ST.faint, marginTop: 8 }}>
                A equipa recebe no balcão e lança o pedido · pagamento no balcão ou à mesa
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Folha de opções do item ──────────────────────────────────────── */}
      {openMenuItem && (
        <ItemSheet
          item={openMenuItem}
          selections={draftSelections}
          qty={draftQty}
          notes={draftNotes}
          step={step}
          error={error}
          personLabel={people[who]}
          unitPrice={draftUnitPrice(openMenuItem)}
          onToggle={toggleOption}
          onQty={setDraftQty}
          onNotes={setDraftNotes}
          onStep={setStep}
          onClose={() => setOpenItem(null)}
          onCommit={() => commitDraft(openMenuItem)}
        />
      )}
    </div>
  );
}

// ── Folha de opções (bottom sheet) ──────────────────────────────────────────
function ItemSheet({
  item,
  selections,
  qty,
  notes,
  step,
  error,
  personLabel,
  unitPrice,
  onToggle,
  onQty,
  onNotes,
  onStep,
  onClose,
  onCommit,
}: {
  item: MenuItem;
  selections: Record<string, string[]>;
  qty: number;
  notes: string;
  step: number;
  error: string;
  personLabel: string;
  unitPrice: number;
  onToggle: (group: ModifierGroup, optionId: string) => void;
  onQty: (n: number) => void;
  onNotes: (s: string) => void;
  onStep: (n: number) => void;
  onClose: () => void;
  onCommit: () => void;
}) {
  const groups = item.modifier_groups;
  const guided = isGuided(item);
  const shown = guided ? [groups[step]].filter(Boolean) : groups;
  const lastStep = !guided || step >= groups.length - 1;
  const currentGroup = guided ? groups[step] : null;
  const currentIds = currentGroup ? selections[currentGroup.id] ?? [] : [];
  const blocked = Boolean(currentGroup && currentGroup.min_select > 0 && currentIds.length < currentGroup.min_select);

  const badgeFor = (g: ModifierGroup) => {
    const n = (selections[g.id] ?? []).length;
    if (g.selection_type === 'single') return 'Escolha 1';
    if (g.free_quantity > 0) return `${n} / ${g.free_quantity} grátis`;
    return 'Opcional';
  };

  const hintFor = (g: ModifierGroup) => {
    if (g.free_quantity > 0 && g.extra_price_cents > 0) {
      const over = Math.max((selections[g.id] ?? []).length - g.free_quantity, 0);
      return over > 0
        ? `Mais ${over} — extra ${mt(g.extra_price_cents)} cada (+${mt(over * g.extra_price_cents)})`
        : `Até ${g.free_quantity} grátis · extra ${mt(g.extra_price_cents)} cada`;
    }
    if (g.selection_type === 'single') return 'Mesmo preço';
    return 'Toque para juntar ao prato';
  };

  const priceFor = (g: ModifierGroup, o: ModifierOption, selected: boolean) => {
    if (o.price_cents > 0) return `+ ${mt(o.price_cents)}`;
    const n = (selections[g.id] ?? []).length;
    if (g.free_quantity > 0 && g.extra_price_cents > 0 && !selected && n >= g.free_quantity) {
      return `+ ${mt(g.extra_price_cents)}`;
    }
    return 'Grátis';
  };

  return (
    <div className="fixed inset-0 z-[70] mx-auto w-full max-w-[430px]">
      <button
        aria-label="Fechar"
        onClick={onClose}
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
        {/* Foto + nome */}
        <div className="relative" style={{ height: 180, flex: 'none', background: ST.photoBg }}>
          <Image
            src={item.photo_url || FALLBACK_IMAGE}
            alt={item.name}
            fill
            className="object-cover"
            sizes="430px"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(42,23,16,.35) 0%, rgba(42,23,16,0) 40%, rgba(42,23,16,.7) 100%)',
            }}
          />
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="absolute flex items-center justify-center"
            style={{
              top: 14,
              right: 14,
              width: 34,
              height: 34,
              borderRadius: 999,
              background: 'rgba(42,23,16,.62)',
            }}
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
              {item.name}
            </div>
            <div style={{ fontSize: 10.5, color: ST.primary, fontWeight: 700, marginTop: 4 }}>
              Para {personLabel}
            </div>
          </div>
        </div>

        {/* Passos */}
        {guided && (
          <div className="flex" style={{ flex: 'none', gap: 6, padding: '14px 18px 4px' }}>
            {groups.map((g, i) => (
              <div key={g.id} className="flex flex-1 flex-col" style={{ gap: 6 }}>
                <div
                  style={{
                    height: 4,
                    borderRadius: 99,
                    background: i <= step ? ST.grad : 'rgba(42,23,16,.12)',
                  }}
                />
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 11,
                    letterSpacing: '1.2px',
                    color: i <= step ? ST.text : ST.faint,
                    textTransform: 'uppercase',
                  }}
                >
                  {g.name}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Corpo */}
        <div className="flex-1 overflow-auto" style={{ padding: '16px 18px 18px' }}>
          {item.description && (!guided || step === 0) && (
            <p style={{ fontSize: 13.5, lineHeight: 1.55, color: ST.muted, marginBottom: 16 }}>{item.description}</p>
          )}

          <div className="flex flex-col" style={{ gap: 20 }}>
            {shown.map((g) => (
              <div key={g.id}>
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
                    {badgeFor(g)}
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: ST.muted2, marginBottom: 10 }}>{hintFor(g)}</div>

                <div className="flex flex-col" style={{ gap: 7 }}>
                  {g.options.map((o) => {
                    const selected = (selections[g.id] ?? []).includes(o.id);
                    return (
                      <button
                        key={o.id}
                        onClick={() => onToggle(g, o.id)}
                        className="flex items-center text-left"
                        style={{
                          gap: 11,
                          padding: '12px 13px',
                          borderRadius: 13,
                          background: selected ? '#FFF6E4' : ST.card,
                          border: selected ? `1.5px solid ${ST.primary}` : `1px solid rgba(42,23,16,.12)`,
                        }}
                      >
                        <span
                          className="flex items-center justify-center"
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 999,
                            flex: 'none',
                            background: selected ? ST.grad : 'transparent',
                            border: selected ? 'none' : '1.5px solid rgba(42,23,16,.2)',
                          }}
                        >
                          {selected && (
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
                          style={{ fontSize: 13.5, color: selected ? ST.text : ST.textSoft, fontWeight: selected ? 600 : 400 }}
                        >
                          {o.name}
                        </span>
                        <span
                          style={{
                            fontSize: 11.5,
                            color: selected ? ST.primary2 : ST.muted2,
                            fontWeight: selected ? 700 : 400,
                          }}
                        >
                          {priceFor(g, o, selected)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {lastStep && (
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 17,
                    letterSpacing: '1px',
                    color: ST.text,
                    textTransform: 'uppercase',
                    marginBottom: 8,
                  }}
                >
                  Notas
                </div>
                <input
                  value={notes}
                  onChange={(e) => onNotes(e.target.value)}
                  placeholder="Sem cebola, molho à parte…"
                  style={{
                    width: '100%',
                    padding: 13,
                    borderRadius: 13,
                    border: `1px solid rgba(42,23,16,.12)`,
                    background: ST.card,
                    fontSize: 13,
                    color: ST.text,
                    outline: 'none',
                  }}
                />
              </div>
            )}
          </div>

          {error && (
            <p style={{ fontSize: 12.5, color: ST.primary2, marginTop: 14 }} role="alert">
              {error}
            </p>
          )}
        </div>

        {/* Rodapé */}
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
          {lastStep ? (
            <>
              <div
                className="flex items-center"
                style={{
                  gap: 12,
                  padding: '5px 6px',
                  border: `1px solid rgba(42,23,16,.14)`,
                  borderRadius: 999,
                  flex: 'none',
                }}
              >
                <button
                  onClick={() => onQty(Math.max(1, qty - 1))}
                  aria-label="Menos"
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
                  {qty}
                </span>
                <button
                  onClick={() => onQty(qty + 1)}
                  aria-label="Mais"
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
                onClick={onCommit}
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
                Juntar ao pedido · {mt(unitPrice * qty)}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onStep(Math.max(0, step - 1))}
                style={{
                  padding: '16px 18px',
                  borderRadius: 14,
                  border: `1px solid rgba(42,23,16,.14)`,
                  fontFamily: 'var(--font-display)',
                  fontSize: 14,
                  letterSpacing: '1.2px',
                  color: ST.muted3,
                  textTransform: 'uppercase',
                  flex: 'none',
                }}
              >
                Voltar
              </button>
              <button
                onClick={() => !blocked && onStep(step + 1)}
                disabled={blocked}
                className="flex-1 disabled:opacity-70"
                style={{
                  padding: '16px 14px',
                  borderRadius: 14,
                  background: ST.text,
                  textAlign: 'center',
                  fontFamily: 'var(--font-display)',
                  fontSize: 14.5,
                  letterSpacing: '1.2px',
                  color: ST.primary,
                  textTransform: 'uppercase',
                }}
              >
                {blocked ? 'Escolha uma opção' : 'Continuar'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{ background: ST.bg, color: ST.text, minHeight: '100vh' }}
      className="flex items-center justify-center p-6 text-center"
    >
      {children}
    </div>
  );
}
