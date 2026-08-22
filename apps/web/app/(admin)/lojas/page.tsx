'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';

import { parseMTInput } from '@/lib/cash/input';
import { createClient } from '@/utils/supabase/client';

type StoreConfig = {
  id: string;
  slug: string;
  name: string;
  short_name: string;
  order_prefix: string;
  active: boolean;
  accepting_orders: boolean;
  address: string | null;
  maps_url: string | null;
  phone: string | null;
  owner_email: string | null;
  delivery_enabled: boolean;
  pickup_enabled: boolean;
  counter_enabled: boolean;
  mpesa_number: string | null;
  mpesa_name: string | null;
  emola_number: string | null;
  emola_name: string | null;
  payment_provider: string;
  receipt_header: string | null;
  receipt_footer: string | null;
  sort: number;
  missing: string[];
};

type StoreHour = { dow: number; opens: string; closes: string; active: boolean };
type Zone = { id: string; name: string; fee_cents: number; active: boolean; sort: number };

type StoreAdmin = {
  store: StoreConfig;
  hours: StoreHour[];
  zones: Zone[];
  missing: string[];
};

const DOW_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const MISSING_LABELS: Record<string, string> = {
  hours: 'horário da semana',
  zones: 'zonas de entrega',
  payment: 'números M-Pesa/e-Mola',
  receipt_footer: 'rodapé do talão',
};

const mt = (value: number) => formatMT(value as Cents);
const hhmm = (value: string) => value.slice(0, 5);

const emptyHour = (dow: number): StoreHour => ({
  dow,
  opens: '11:00',
  closes: '21:30',
  active: false,
});

export default function LojasPage() {
  const supabase = useMemo(() => createClient(), []);

  const [stores, setStores] = useState<Array<{ id: string; short_name: string; slug: string }>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [config, setConfig] = useState<StoreAdmin | null>(null);
  const [hours, setHours] = useState<StoreHour[]>([]);
  const [denied, setDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newStore, setNewStore] = useState({ slug: '', name: '', short_name: '', order_prefix: '' });
  const [zoneDraft, setZoneDraft] = useState<{ id?: string; name: string; fee: string }>({
    name: '',
    fee: '',
  });
  const [switchReason, setSwitchReason] = useState('');

  const loadStores = useCallback(async () => {
    const { data, error } = await supabase
      .from('stores')
      .select('id,slug,short_name')
      .order('sort');
    if (error) {
      setMessage({ tone: 'error', text: `Não foi possível listar as lojas: ${error.message}` });
      setLoading(false);
      return;
    }
    setStores(data ?? []);
    setSelectedId((current) => current ?? data?.[0]?.id ?? null);
  }, [supabase]);

  const loadConfig = useCallback(async () => {
    if (!selectedId) return;
    const { data, error } = await supabase.rpc('get_store_admin', { p_store_id: selectedId });
    if (error) {
      if (error.message.includes('staff_admin_denied')) setDenied(true);
      else setMessage({ tone: 'error', text: `Não foi possível abrir a loja: ${error.message}` });
      setLoading(false);
      return;
    }
    const payload = data as StoreAdmin;
    setConfig(payload);
    setHours(
      Array.from({ length: 7 }, (_, dow) => {
        const saved = payload.hours.find((entry) => entry.dow === dow);
        return saved
          ? { ...saved, opens: hhmm(saved.opens), closes: hhmm(saved.closes) }
          : emptyHour(dow);
      }),
    );
    setDenied(false);
    setLoading(false);
  }, [selectedId, supabase]);

  useEffect(() => {
    void loadStores();
  }, [loadStores]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  // A ficha aberta pode ainda ser da loja anterior: entre clicar noutra loja e
  // o `get_store_admin` responder, `config` continua a ser a de antes. Sem esta
  // guarda, quem clicasse "Matola" e logo a seguir "Fechar loja agora" fechava
  // MAPUTO — a loja errada, no dia errado (apanhado pelo e2e da F10).
  const stale = !config || config.store.id !== selectedId;

  function updateField<K extends keyof StoreConfig>(field: K, value: StoreConfig[K]) {
    setConfig((current) => (current ? { ...current, store: { ...current.store, [field]: value } } : current));
  }

  async function saveStore() {
    if (stale) return;
    if (!config) return;
    setBusy(true);
    const { store } = config;
    const { error } = await supabase.rpc('save_store', {
      p_payload: {
        id: store.id,
        name: store.name,
        short_name: store.short_name,
        address: store.address,
        maps_url: store.maps_url,
        phone: store.phone,
        owner_email: store.owner_email,
        delivery_enabled: store.delivery_enabled,
        pickup_enabled: store.pickup_enabled,
        counter_enabled: store.counter_enabled,
        mpesa_number: store.mpesa_number,
        mpesa_name: store.mpesa_name,
        emola_number: store.emola_number,
        emola_name: store.emola_name,
        receipt_header: store.receipt_header,
        receipt_footer: store.receipt_footer,
      },
    });
    setBusy(false);
    if (error) {
      setMessage({ tone: 'error', text: `Não foi possível guardar: ${error.message}` });
      return;
    }
    setMessage({ tone: 'ok', text: 'Dados da loja guardados.' });
    await Promise.all([loadStores(), loadConfig()]);
  }

  async function saveHours() {
    if (stale) return;
    if (!config) return;
    setBusy(true);
    const { error } = await supabase.rpc('set_store_hours', {
      p_store_id: config.store.id,
      p_hours: hours
        .filter((entry) => entry.active)
        .map((entry) => ({
          dow: entry.dow,
          opens: entry.opens,
          closes: entry.closes,
          active: true,
        })),
    });
    setBusy(false);
    if (error) {
      setMessage({
        tone: 'error',
        text: error.message.includes('invalid_hours_range')
          ? 'A hora de fecho tem de ser depois da hora de abertura.'
          : `Horário recusado: ${error.message}`,
      });
      return;
    }
    setMessage({ tone: 'ok', text: 'Horário da semana actualizado.' });
    await loadConfig();
  }

  async function saveZone() {
    if (stale) return;
    if (!config) return;
    const fee = parseMTInput(zoneDraft.fee);
    if (zoneDraft.name.trim().length < 2 || fee === null) {
      setMessage({ tone: 'error', text: 'Indica o nome da zona e a taxa em MT.' });
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('save_delivery_zone', {
      p_store_id: config.store.id,
      p_zone: {
        ...(zoneDraft.id ? { id: zoneDraft.id } : {}),
        name: zoneDraft.name.trim(),
        fee_cents: fee,
      },
    });
    setBusy(false);
    if (error) {
      setMessage({ tone: 'error', text: `Zona recusada: ${error.message}` });
      return;
    }
    setZoneDraft({ name: '', fee: '' });
    setMessage({ tone: 'ok', text: 'Zona de entrega guardada.' });
    await loadConfig();
  }

  async function removeZone(zone: Zone) {
    if (stale) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('delete_delivery_zone', { p_zone_id: zone.id });
    setBusy(false);
    if (error) {
      setMessage({ tone: 'error', text: `Não foi possível remover: ${error.message}` });
      return;
    }
    setMessage({
      tone: 'ok',
      text: (data as { deleted: boolean }).deleted
        ? `Zona ${zone.name} removida.`
        : `Zona ${zone.name} desactivada (tem pedidos no histórico).`,
    });
    await loadConfig();
  }

  async function toggleAccepting() {
    if (stale) return;
    if (!config) return;
    if (switchReason.trim().length < 3) {
      setMessage({ tone: 'error', text: 'Escreve o motivo — fica no registo de auditoria.' });
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('set_store_accepting_orders', {
      p_store_id: config.store.id,
      p_accepting: !config.store.accepting_orders,
      p_reason: switchReason.trim(),
    });
    setBusy(false);
    if (error) {
      setMessage({ tone: 'error', text: `Recusado: ${error.message}` });
      return;
    }
    setSwitchReason('');
    setMessage({
      tone: 'ok',
      text: config.store.accepting_orders
        ? `${config.store.short_name} deixou de aceitar pedidos.`
        : `${config.store.short_name} voltou a aceitar pedidos.`,
    });
    await loadConfig();
  }

  async function createStore() {
    setBusy(true);
    const { error } = await supabase.rpc('save_store', {
      p_payload: {
        slug: newStore.slug.trim().toLowerCase(),
        name: newStore.name.trim(),
        short_name: newStore.short_name.trim(),
        order_prefix: newStore.order_prefix.trim().toUpperCase(),
        accepting_orders: false,
      },
    });
    setBusy(false);
    if (error) {
      setMessage({
        tone: 'error',
        text: error.message.includes('invalid_order_prefix')
          ? 'O prefixo do pedido são 2 a 5 letras (ex.: MPT).'
          : error.message.includes('invalid_store_slug')
            ? 'O endereço da loja só aceita letras minúsculas e hífen (ex.: beira).'
            : `Loja não criada: ${error.message}`,
      });
      return;
    }
    setCreating(false);
    setNewStore({ slug: '', name: '', short_name: '', order_prefix: '' });
    setMessage({
      tone: 'ok',
      text: 'Loja criada e fechada. Preenche horário, zonas e pagamento antes de a abrir.',
    });
    await loadStores();
  }

  if (denied) {
    return (
      <div className="rounded-2xl border border-white/[0.08] p-6 text-center text-[#C9BCAC]">
        <h1 className="text-xl font-black text-white">Lojas</h1>
        <p className="mt-2 text-sm">Só o dono configura lojas. Fala com ele.</p>
      </div>
    );
  }

  const store = config?.store;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">Lojas</h1>
          <p className="text-sm text-[#8b8378]">
            Horário, zonas, pagamento e rodapé de cada unidade. Tudo o que mudares fica registado.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {stores.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSelectedId(entry.id)}
              className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                entry.id === selectedId
                  ? 'border-[#e5a93c] bg-[#e5a93c]/15 text-[#e5a93c]'
                  : 'border-white/10 text-[#C9BCAC] hover:bg-white/[0.04]'
              }`}
            >
              {entry.short_name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-xl bg-[#e5a93c] px-4 py-2 text-sm font-black text-black"
          >
            Nova loja
          </button>
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

      {loading && !store && (
        <p className="rounded-2xl border border-white/[0.08] p-6 text-center text-sm text-[#8b8378]">
          A carregar a configuração…
        </p>
      )}

      {store && (
        <>
          {config!.missing.length > 0 && (
            <section className="rounded-2xl border border-[#e5a93c]/40 bg-[#e5a93c]/[0.07] p-4 text-sm text-[#e5a93c]">
              <strong className="font-black uppercase">Falta preencher:</strong>{' '}
              {config!.missing.map((key) => MISSING_LABELS[key] ?? key).join(' · ')}
            </section>
          )}

          <section className="rounded-2xl border border-white/[0.08] p-5">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-white">
                  {store.short_name}{' '}
                  <span className="text-sm font-normal text-[#8b8378]">
                    /{store.slug} · pedidos {store.order_prefix}-0000
                  </span>
                </h2>
                <p className="text-xs text-[#8b8378]">
                  O endereço e o prefixo do pedido não mudam depois de criados.
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  store.accepting_orders
                    ? 'bg-[#16281c] text-[#a8e0b6]'
                    : 'bg-[#2a1616] text-[#ffb0b0]'
                }`}
              >
                {store.accepting_orders ? 'A aceitar pedidos' : 'Pedidos desligados'}
              </span>
            </header>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="flex-1 text-xs font-bold uppercase tracking-wide text-[#8b8378]">
                Motivo (fica no registo)
                <input
                  value={switchReason}
                  onChange={(event) => setSwitchReason(event.target.value)}
                  placeholder={store.accepting_orders ? 'Ex.: falta de energia' : 'Ex.: energia reposta'}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white placeholder:text-[#6f6a62]"
                />
              </label>
              <button
                type="button"
                disabled={busy || stale}
                onClick={() => void toggleAccepting()}
                className={`rounded-xl px-4 py-3 text-sm font-black disabled:opacity-50 ${
                  store.accepting_orders ? 'bg-[#7a2b2b] text-white' : 'bg-[#e5a93c] text-black'
                }`}
              >
                {store.accepting_orders ? 'Fechar loja agora' : 'Reabrir loja'}
              </button>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-2xl border border-white/[0.08] p-5">
              <h2 className="font-black text-white">Identidade e contactos</h2>
              <div className="mt-4 space-y-3">
                {(
                  [
                    ['name', 'Nome completo'],
                    ['short_name', 'Nome curto (talão e TV)'],
                    ['address', 'Morada'],
                    ['phone', 'Telefone'],
                    ['maps_url', 'Link do Google Maps'],
                    ['owner_email', 'Email para alertas desta loja'],
                  ] as Array<[keyof StoreConfig, string]>
                ).map(([field, label]) => (
                  <label
                    key={field}
                    className="block text-xs font-bold uppercase tracking-wide text-[#8b8378]"
                  >
                    {label}
                    <input
                      value={(store[field] as string | null) ?? ''}
                      onChange={(event) => updateField(field, event.target.value as never)}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white"
                    />
                  </label>
                ))}
              </div>
            </article>

            <article className="rounded-2xl border border-white/[0.08] p-5">
              <h2 className="font-black text-white">Pagamento e talão</h2>
              <div className="mt-4 space-y-3">
                {(
                  [
                    ['mpesa_number', 'Número M-Pesa'],
                    ['mpesa_name', 'Titular M-Pesa'],
                    ['emola_number', 'Número e-Mola'],
                    ['emola_name', 'Titular e-Mola'],
                    ['receipt_header', 'Cabeçalho do talão'],
                    ['receipt_footer', 'Rodapé do talão'],
                  ] as Array<[keyof StoreConfig, string]>
                ).map(([field, label]) => (
                  <label
                    key={field}
                    className="block text-xs font-bold uppercase tracking-wide text-[#8b8378]"
                  >
                    {label}
                    <input
                      value={(store[field] as string | null) ?? ''}
                      onChange={(event) => updateField(field, event.target.value as never)}
                      className="mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white"
                    />
                  </label>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {(
                  [
                    ['delivery_enabled', 'Entrega'],
                    ['pickup_enabled', 'Levantamento'],
                    ['counter_enabled', 'Balcão'],
                  ] as Array<[keyof StoreConfig, string]>
                ).map(([field, label]) => (
                  <button
                    key={field}
                    type="button"
                    onClick={() => updateField(field, !store[field] as never)}
                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                      store[field]
                        ? 'bg-[#e5a93c]/20 text-[#e5a93c]'
                        : 'border border-white/10 text-[#8b8378]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </article>
          </section>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={busy || stale}
              onClick={() => void saveStore()}
              className="rounded-xl bg-[#e5a93c] px-5 py-3 text-sm font-black text-black disabled:opacity-50"
            >
              Guardar dados da loja
            </button>
          </div>

          <section className="rounded-2xl border border-white/[0.08] p-5">
            <h2 className="font-black text-white">Horário da semana</h2>
            <p className="mt-1 text-xs text-[#8b8378]">
              Dia desligado é dia fechado: o site não aceita agendamento e a loja aparece fechada.
            </p>
            <ul className="mt-4 space-y-2">
              {hours.map((entry, index) => (
                <li key={entry.dow} className="flex flex-wrap items-center gap-3 text-sm">
                  <button
                    type="button"
                    onClick={() =>
                      setHours((current) =>
                        current.map((item, position) =>
                          position === index ? { ...item, active: !item.active } : item,
                        ),
                      )
                    }
                    className={`w-28 rounded-full px-3 py-1 text-xs font-bold ${
                      entry.active
                        ? 'bg-[#e5a93c]/20 text-[#e5a93c]'
                        : 'border border-white/10 text-[#8b8378]'
                    }`}
                  >
                    {DOW_LABELS[entry.dow]}
                  </button>
                  <input
                    type="time"
                    value={entry.opens}
                    disabled={!entry.active}
                    onChange={(event) =>
                      setHours((current) =>
                        current.map((item, position) =>
                          position === index ? { ...item, opens: event.target.value } : item,
                        ),
                      )
                    }
                    className="rounded-xl border border-white/10 bg-[#0f0e0c] px-3 py-2 text-sm text-white disabled:opacity-40"
                  />
                  <span className="text-[#8b8378]">até</span>
                  <input
                    type="time"
                    value={entry.closes}
                    disabled={!entry.active}
                    onChange={(event) =>
                      setHours((current) =>
                        current.map((item, position) =>
                          position === index ? { ...item, closes: event.target.value } : item,
                        ),
                      )
                    }
                    className="rounded-xl border border-white/10 bg-[#0f0e0c] px-3 py-2 text-sm text-white disabled:opacity-40"
                  />
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                disabled={busy || stale}
                onClick={() => void saveHours()}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-[#C9BCAC] hover:bg-white/[0.05] disabled:opacity-50"
              >
                Guardar horário
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-white/[0.08] p-5">
            <h2 className="font-black text-white">Zonas de entrega</h2>
            <ul className="mt-4 divide-y divide-white/[0.06]">
              {config!.zones.length === 0 && (
                <li className="py-3 text-sm text-[#8b8378]">
                  Sem zonas. Enquanto assim for, esta loja não aceita entregas.
                </li>
              )}
              {config!.zones.map((zone) => (
                <li key={zone.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <span className="flex-1 font-bold text-white">
                    {zone.name}
                    {!zone.active && <span className="ml-2 text-xs text-[#8b8378]">(inactiva)</span>}
                  </span>
                  <span className="font-black text-[#e5a93c]">{mt(zone.fee_cents)}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setZoneDraft({ id: zone.id, name: zone.name, fee: String(zone.fee_cents / 100) })
                    }
                    className="rounded-lg border border-white/10 px-3 py-1 text-xs font-bold text-[#C9BCAC] hover:bg-white/[0.05]"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    disabled={busy || stale}
                    onClick={() => void removeZone(zone)}
                    className="rounded-lg border border-[#7a2b2b] px-3 py-1 text-xs font-bold text-[#ffb0b0] hover:bg-[#2a1616] disabled:opacity-50"
                  >
                    Remover
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="flex-1 text-xs font-bold uppercase tracking-wide text-[#8b8378]">
                Zona
                <input
                  value={zoneDraft.name}
                  onChange={(event) => setZoneDraft({ ...zoneDraft, name: event.target.value })}
                  placeholder="Ex.: Matola-Rio"
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white placeholder:text-[#6f6a62]"
                />
              </label>
              <label className="w-40 text-xs font-bold uppercase tracking-wide text-[#8b8378]">
                Taxa (MT)
                <input
                  value={zoneDraft.fee}
                  onChange={(event) => setZoneDraft({ ...zoneDraft, fee: event.target.value })}
                  inputMode="decimal"
                  className="mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white"
                />
              </label>
              <button
                type="button"
                disabled={busy || stale}
                onClick={() => void saveZone()}
                className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-[#C9BCAC] hover:bg-white/[0.05] disabled:opacity-50"
              >
                {zoneDraft.id ? 'Guardar zona' : 'Adicionar zona'}
              </button>
            </div>
          </section>
        </>
      )}

      {creating && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#151311] p-5">
            <h2 className="text-lg font-black text-white">Nova loja</h2>
            <p className="mt-2 text-sm text-[#8b8378]">
              O endereço e o prefixo do pedido ficam presos para sempre — o histórico de pedidos depende
              deles. A loja nasce fechada.
            </p>

            <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-[#8b8378]">
              Nome completo
              <input
                value={newStore.name}
                onChange={(event) => setNewStore({ ...newStore, name: event.target.value })}
                placeholder="HAWSMASH Beira"
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white placeholder:text-[#6f6a62]"
              />
            </label>

            <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[#8b8378]">
              Nome curto
              <input
                value={newStore.short_name}
                onChange={(event) => setNewStore({ ...newStore, short_name: event.target.value })}
                placeholder="Beira"
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white placeholder:text-[#6f6a62]"
              />
            </label>

            <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[#8b8378]">
              Endereço no site (/l/…)
              <input
                value={newStore.slug}
                onChange={(event) =>
                  setNewStore({
                    ...newStore,
                    slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                  })
                }
                placeholder="beira"
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white placeholder:text-[#6f6a62]"
              />
            </label>

            <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[#8b8378]">
              Prefixo do pedido (2 a 5 letras)
              <input
                value={newStore.order_prefix}
                onChange={(event) =>
                  setNewStore({
                    ...newStore,
                    order_prefix: event.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5),
                  })
                }
                placeholder="BEI"
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm font-black tracking-widest text-white placeholder:text-[#6f6a62]"
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-[#C9BCAC]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy || stale}
                onClick={() => void createStore()}
                className="rounded-xl bg-[#e5a93c] px-4 py-2 text-sm font-black text-black disabled:opacity-50"
              >
                Criar loja
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
