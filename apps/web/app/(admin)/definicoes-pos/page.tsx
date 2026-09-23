'use client';

/**
 * Aba POS — as definições do balcão, loja a loja.
 *
 * Tudo o que aqui se grava vai para `store_pos_settings` (migration 1067) por
 * `save_pos_settings`, fica no `event_log` com quem mudou, e chega ao POS da
 * loja no próximo refresh do cardápio (2 min) — sem deploy, sem reiniciar.
 *
 * O painel limpa o que envia com o mesmo `resolvePosSettings` com que o POS o
 * lê: o que se vê aqui depois de guardar é exactamente o que o balcão usa.
 *
 * Contrato e portabilidade: docs/POS-DEFINICOES.md.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  FACTORY_POS_SETTINGS,
  POS_FULFILLMENT_NAMES,
  POS_LIMITS,
  POS_PAYMENT_METHOD_NAMES,
  POS_UPSELL_STEP_NAMES,
  resolvePosSettings,
  type PosFulfillment,
  type PosSettings,
  type PosUpsellStepId,
} from '@/lib/pos/settings';
import { createClient } from '@/utils/supabase/client';

type StoreRow = { id: string; short_name: string; slug: string };
type Message = { tone: 'ok' | 'error'; text: string } | null;

const INPUT =
  'mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white placeholder:text-[#6f6a62]';
const LABEL = 'block text-xs font-bold uppercase tracking-wide text-[#8b8378]';
const CARD = 'rounded-2xl border border-white/[0.08] p-5';

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-xl bg-white/[0.03] px-4 py-3">
      <span>
        <span className="block text-sm font-bold text-white">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-[#8b8378]">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 accent-[#e5a93c]"
      />
    </label>
  );
}

export default function DefinicoesPosPage() {
  const supabase = useMemo(() => createClient(), []);

  const [stores, setStores] = useState<StoreRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Loja a que pertence o `draft` — ver guarda `stale` mais abaixo. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [saved, setSaved] = useState<PosSettings | null>(null);
  const [draft, setDraft] = useState<PosSettings | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [newNote, setNewNote] = useState('');
  const [copyTarget, setCopyTarget] = useState('');

  const loadStores = useCallback(async () => {
    const { data, error } = await supabase.from('stores').select('id,slug,short_name').order('sort');
    if (error) {
      setMessage({ tone: 'error', text: `Não foi possível listar as lojas: ${error.message}` });
      return;
    }
    setStores(data ?? []);
    setSelectedId((current) => current ?? data?.[0]?.id ?? null);
  }, [supabase]);

  const loadSettings = useCallback(async () => {
    if (!selectedId) return;
    const { data, error } = await supabase.rpc('get_pos_settings', { p_store_id: selectedId });
    if (error) {
      if (error.message.includes('pos_settings_denied')) setDenied(true);
      else setMessage({ tone: 'error', text: `Não foi possível abrir as definições: ${error.message}` });
      return;
    }
    const payload = data as { config: unknown; updated_at: string | null };
    const resolvidas = resolvePosSettings(payload.config);
    setSaved(resolvidas);
    setDraft(resolvidas);
    setUpdatedAt(payload.updated_at);
    setLoadedFor(selectedId);
    setDenied(false);
  }, [selectedId, supabase]);

  useEffect(() => {
    void loadStores();
  }, [loadStores]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Entre clicar noutra loja e a resposta chegar, o rascunho ainda é o da loja
  // anterior. Guardar nesse intervalo gravava as definições de uma loja na
  // outra — o mesmo erro que a aba Lojas já apanhou (F10).
  const stale = !draft || loadedFor !== selectedId;
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);
  const store = stores.find((s) => s.id === selectedId);

  function patch(update: (current: PosSettings) => PosSettings) {
    setDraft((current) => (current ? update(current) : current));
    setMessage(null);
  }

  async function save(target: string, config: PosSettings, okText: string) {
    setBusy(true);
    setMessage(null);
    // Limpo pelo mesmo resolver que o POS usa: frases vazias, repetidas ou
    // grandes demais não chegam à BD.
    const limpo = resolvePosSettings(config);
    const { error } = await supabase.rpc('save_pos_settings', { p_store_id: target, p_config: limpo });
    setBusy(false);
    if (error) {
      setMessage({
        tone: 'error',
        text: error.message.includes('pos_settings_denied')
          ? 'Só o dono ou o gerente desta loja mudam o POS.'
          : `Não foi possível guardar: ${error.message}`,
      });
      return false;
    }
    setMessage({ tone: 'ok', text: okText });
    return true;
  }

  async function saveCurrent() {
    if (!draft || !selectedId || stale) return;
    const ok = await save(
      selectedId,
      draft,
      `Guardado. O POS de ${store?.short_name ?? 'loja'} actualiza sozinho em até 2 minutos.`,
    );
    if (ok) await loadSettings();
  }

  async function copyTo() {
    if (!draft || stale || !copyTarget) return;
    const destino = stores.find((s) => s.id === copyTarget);
    await save(
      copyTarget,
      draft,
      `Definições copiadas para ${destino?.short_name ?? 'a outra loja'}.`,
    );
    setCopyTarget('');
  }

  function moveMethod(index: number, delta: -1 | 1) {
    patch((current) => {
      const lista = [...current.payments.methods];
      const alvo = index + delta;
      if (alvo < 0 || alvo >= lista.length) return current;
      [lista[index], lista[alvo]] = [lista[alvo], lista[index]];
      return { ...current, payments: { ...current.payments, methods: lista } };
    });
  }

  function addNote() {
    const nota = newNote.trim().toUpperCase().slice(0, POS_LIMITS.quickNoteMax);
    if (!nota) return;
    patch((current) =>
      current.quickNotes.some((n) => n.toUpperCase() === nota)
        ? current
        : { ...current, quickNotes: [...current.quickNotes, nota].slice(0, POS_LIMITS.quickNotes) },
    );
    setNewNote('');
  }

  function patchStep(step: PosUpsellStepId, update: Partial<PosSettings['upsell']['steps'][PosUpsellStepId]>) {
    patch((current) => ({
      ...current,
      upsell: {
        ...current.upsell,
        steps: { ...current.upsell.steps, [step]: { ...current.upsell.steps[step], ...update } },
      },
    }));
  }

  if (denied) {
    return (
      <div className="rounded-2xl border border-white/[0.08] p-6 text-center text-[#C9BCAC]">
        <h1 className="text-xl font-black text-white">POS</h1>
        <p className="mt-2 text-sm">Não tens acesso às definições do POS desta loja.</p>
      </div>
    );
  }

  const ligados = draft?.payments.methods.filter((m) => m.enabled).length ?? 0;

  return (
    <div className="space-y-6 pb-28">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">POS</h1>
          <p className="text-sm text-[#8b8378]">
            Como o balcão de cada loja vende: pagamentos, upsell, notas e ecrã. Tudo fica registado.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {stores.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                if (dirty && !window.confirm('Há alterações por guardar nesta loja. Sair sem guardar?')) return;
                setSelectedId(entry.id);
                setMessage(null);
              }}
              className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                entry.id === selectedId
                  ? 'border-[#e5a93c] bg-[#e5a93c]/15 text-[#e5a93c]'
                  : 'border-white/10 text-[#C9BCAC] hover:bg-white/[0.04]'
              }`}
            >
              {entry.short_name}
            </button>
          ))}
        </div>
      </header>

      {message && (
        <p
          className={`rounded-xl border px-4 py-3 text-sm ${
            message.tone === 'ok'
              ? 'border-[#2f6b3f] bg-[#16281c] text-[#a8e0b6]'
              : 'border-[#7a2b2b] bg-[#2a1616] text-[#ffb0b0]'
          }`}
        >
          {message.text}
        </p>
      )}

      {stale && (
        <p className="rounded-2xl border border-white/[0.08] p-6 text-center text-sm text-[#8b8378]">
          A carregar as definições…
        </p>
      )}

      {draft && !stale && (
        <>
          {!updatedAt && (
            <p className="rounded-2xl border border-[#e5a93c]/40 bg-[#e5a93c]/[0.07] p-4 text-sm text-[#e5a93c]">
              Esta loja ainda usa os valores de fábrica. Ajusta o que quiseres e guarda.
            </p>
          )}

          {/* ── Pagamentos ─────────────────────────────────────────────── */}
          <section className={CARD}>
            <h2 className="text-lg font-black text-white">Meios de pagamento</h2>
            <p className="text-xs text-[#8b8378]">
              Quais aparecem no ecrã de pagamento, com que nome e por que ordem. Os números de
              M-Pesa/e-Mola estão na aba Lojas. Tem de ficar pelo menos um ligado.
            </p>
            <div className="mt-4 space-y-2">
              {draft.payments.methods.map((method, index) => (
                <div
                  key={method.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl bg-white/[0.03] px-4 py-3"
                >
                  <input
                    type="checkbox"
                    checked={method.enabled}
                    disabled={method.enabled && ligados === 1}
                    onChange={(event) =>
                      patch((current) => ({
                        ...current,
                        payments: {
                          ...current.payments,
                          methods: current.payments.methods.map((m) =>
                            m.id === method.id ? { ...m, enabled: event.target.checked } : m,
                          ),
                        },
                      }))
                    }
                    className="h-5 w-5 accent-[#e5a93c]"
                    aria-label={`Ligar ${POS_PAYMENT_METHOD_NAMES[method.id]}`}
                  />
                  <span className="w-20 text-xs font-bold uppercase text-[#8b8378]">
                    {POS_PAYMENT_METHOD_NAMES[method.id]}
                  </span>
                  <input
                    value={method.label}
                    maxLength={POS_LIMITS.labelMax}
                    onChange={(event) =>
                      patch((current) => ({
                        ...current,
                        payments: {
                          ...current.payments,
                          methods: current.payments.methods.map((m) =>
                            m.id === method.id ? { ...m, label: event.target.value } : m,
                          ),
                        },
                      }))
                    }
                    placeholder="Nome no botão"
                    className="min-w-40 flex-1 rounded-lg border border-white/10 bg-[#0f0e0c] px-3 py-2 text-sm text-white"
                  />
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => moveMethod(index, -1)}
                      disabled={index === 0}
                      className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white disabled:opacity-30"
                      aria-label="Subir"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveMethod(index, 1)}
                      disabled={index === draft.payments.methods.length - 1}
                      className="rounded-lg border border-white/10 px-3 py-2 text-sm text-white disabled:opacity-30"
                      aria-label="Descer"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <Toggle
                checked={draft.payments.allowMixed}
                onChange={(value) =>
                  patch((current) => ({ ...current, payments: { ...current.payments, allowMixed: value } }))
                }
                label="Permitir pagamento misto"
                hint="Dividir a conta entre dois meios (ex.: dinheiro + M-Pesa)."
              />
            </div>
          </section>

          {/* ── Upsell ─────────────────────────────────────────────────── */}
          <section className={CARD}>
            <h2 className="text-lg font-black text-white">Upsell no balcão</h2>
            <p className="text-xs text-[#8b8378]">
              O ecrã entre o carrinho e o pagamento. Os produtos oferecidos são os marcados como upsell
              no Cardápio; aqui escolhes os passos e o que o operador diz. Uma frase por linha — roda
              uma por venda. Curtas, com pergunta aberta, sem pressão.
            </p>
            <div className="mt-4 space-y-3">
              <Toggle
                checked={draft.upsell.enabled}
                onChange={(value) => patch((current) => ({ ...current, upsell: { ...current.upsell, enabled: value } }))}
                label="Mostrar o upsell no POS"
                hint="Desligado, o carrinho vai directo ao pagamento."
              />
              {(Object.keys(draft.upsell.steps) as PosUpsellStepId[]).map((stepId) => {
                const step = draft.upsell.steps[stepId];
                return (
                  <div
                    key={stepId}
                    className={`rounded-xl border border-white/[0.06] p-4 ${
                      draft.upsell.enabled ? '' : 'opacity-50'
                    }`}
                  >
                    <Toggle
                      checked={step.enabled}
                      onChange={(value) => patchStep(stepId, { enabled: value })}
                      label={POS_UPSELL_STEP_NAMES[stepId]}
                    />
                    <label className={`${LABEL} mt-3`}>
                      Título do ecrã
                      <input
                        value={step.title}
                        maxLength={POS_LIMITS.titleMax}
                        onChange={(event) => patchStep(stepId, { title: event.target.value })}
                        className={INPUT}
                      />
                    </label>
                    <label className={`${LABEL} mt-3`}>
                      Frases ({step.scripts.filter((s) => s.trim()).length}/{POS_LIMITS.scriptsPerStep})
                      <textarea
                        value={step.scripts.join('\n')}
                        rows={Math.max(3, step.scripts.length + 1)}
                        onChange={(event) => patchStep(stepId, { scripts: event.target.value.split('\n') })}
                        placeholder="Uma frase por linha"
                        className={`${INPUT} font-normal normal-case tracking-normal`}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Notas rápidas ──────────────────────────────────────────── */}
          <section className={CARD}>
            <h2 className="text-lg font-black text-white">Notas rápidas</h2>
            <p className="text-xs text-[#8b8378]">
              Os atalhos da nota do artigo e do pedido (&quot;SEM CEBOLA&quot;). No POS somam-se: tocar em
              dois dá &quot;SEM CEBOLA, SEM MOLHO&quot;.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {draft.quickNotes.map((nota) => (
                <span
                  key={nota}
                  className="inline-flex items-center gap-2 rounded-full bg-white/[0.07] py-1.5 pl-4 pr-2 text-sm font-bold text-white"
                >
                  {nota}
                  <button
                    type="button"
                    onClick={() =>
                      patch((current) => ({
                        ...current,
                        quickNotes: current.quickNotes.filter((n) => n !== nota),
                      }))
                    }
                    className="grid h-6 w-6 place-items-center rounded-full bg-white/10 text-xs hover:bg-[#7a2b2b]"
                    aria-label={`Tirar ${nota}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {draft.quickNotes.length === 0 && (
                <span className="text-sm text-[#8b8378]">Sem atalhos — o POS só terá o teclado.</span>
              )}
            </div>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                addNote();
              }}
            >
              <input
                value={newNote}
                maxLength={POS_LIMITS.quickNoteMax}
                onChange={(event) => setNewNote(event.target.value)}
                placeholder="Ex.: SEM PICLES"
                className="flex-1 rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white placeholder:text-[#6f6a62]"
              />
              <button
                type="submit"
                disabled={!newNote.trim() || draft.quickNotes.length >= POS_LIMITS.quickNotes}
                className="rounded-xl bg-white/10 px-4 text-sm font-black text-white disabled:opacity-40"
              >
                Adicionar
              </button>
            </form>
          </section>

          {/* ── Carrinho, venda e alertas ─────────────────────────────── */}
          <section className={CARD}>
            <h2 className="text-lg font-black text-white">Ecrã do balcão</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className={LABEL}>
                Tipo de pedido ao abrir
                <select
                  value={draft.cart.defaultFulfillment}
                  onChange={(event) =>
                    patch((current) => ({
                      ...current,
                      cart: { ...current.cart, defaultFulfillment: event.target.value as PosFulfillment },
                    }))
                  }
                  className={INPUT}
                >
                  {(Object.keys(POS_FULFILLMENT_NAMES) as PosFulfillment[]).map((tipo) => (
                    <option key={tipo} value={tipo}>
                      {POS_FULFILLMENT_NAMES[tipo]}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block font-normal normal-case tracking-normal">
                  Se esse canal estiver desligado na loja ou o POS estiver sem rede, abre em Balcão.
                </span>
              </label>
              <label className={LABEL}>
                Segundos no ecrã &quot;venda registada&quot;
                <input
                  type="number"
                  min={POS_LIMITS.confirmationMin}
                  max={POS_LIMITS.confirmationMax}
                  value={draft.sale.confirmationSeconds}
                  onChange={(event) =>
                    patch((current) => ({
                      ...current,
                      sale: { confirmationSeconds: Number(event.target.value) || POS_LIMITS.confirmationMin },
                    }))
                  }
                  className={INPUT}
                />
              </label>
            </div>
            <div className="mt-3 space-y-2">
              <Toggle
                checked={draft.cart.askCustomerOnCounter}
                onChange={(value) => patch((current) => ({ ...current, cart: { ...current.cart, askCustomerOnCounter: value } }))}
                label="Pedir nome e telefone também no balcão"
                hint="É o que liga a compra presencial à ficha do cliente. Na entrega e no levantamento pede-se sempre."
              />
              <Toggle
                checked={draft.alerts.newOrderChime}
                onChange={(value) => patch((current) => ({ ...current, alerts: { newOrderChime: value } }))}
                label="Tocar quando chega um pedido online"
                hint="Desligado, o botão Pedidos continua a piscar — só não toca."
              />
            </div>
          </section>

          {/* ── Copiar ─────────────────────────────────────────────────── */}
          {stores.length > 1 && (
            <section className={CARD}>
              <h2 className="text-lg font-black text-white">Copiar para outra loja</h2>
              <p className="text-xs text-[#8b8378]">
                Grava na outra loja o que está neste ecrã (incluindo alterações ainda por guardar aqui).
                Substitui as definições do POS dessa loja.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <select
                  value={copyTarget}
                  onChange={(event) => setCopyTarget(event.target.value)}
                  className="rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white"
                >
                  <option value="">Escolher loja…</option>
                  {stores
                    .filter((s) => s.id !== selectedId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.short_name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={busy || !copyTarget}
                  onClick={() => {
                    const destino = stores.find((s) => s.id === copyTarget)?.short_name;
                    if (window.confirm(`Substituir as definições do POS de ${destino}?`)) void copyTo();
                  }}
                  className="rounded-xl bg-white/10 px-4 py-3 text-sm font-black text-white disabled:opacity-40"
                >
                  Copiar
                </button>
              </div>
            </section>
          )}

          {/* ── Barra de guardar ───────────────────────────────────────── */}
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[#0f0e0c]/95 px-4 py-3 backdrop-blur lg:left-64">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-[#8b8378]">
                {dirty ? 'Alterações por guardar' : updatedAt ? `Guardado ${new Date(updatedAt).toLocaleString('pt-PT')}` : 'Valores de fábrica'}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm('Repor os valores de fábrica neste ecrã? Só grava quando carregares em Guardar.')) {
                      setDraft(resolvePosSettings(FACTORY_POS_SETTINGS));
                    }
                  }}
                  className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-bold text-[#C9BCAC] disabled:opacity-40"
                >
                  Repor fábrica
                </button>
                <button
                  type="button"
                  disabled={busy || !dirty}
                  onClick={() => setDraft(saved)}
                  className="rounded-xl border border-white/10 px-4 py-2.5 text-sm font-bold text-[#C9BCAC] disabled:opacity-40"
                >
                  Descartar
                </button>
                <button
                  type="button"
                  disabled={busy || !dirty}
                  onClick={() => void saveCurrent()}
                  className="rounded-xl bg-[#e5a93c] px-5 py-2.5 text-sm font-black text-black disabled:opacity-40"
                >
                  {busy ? 'A guardar…' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
