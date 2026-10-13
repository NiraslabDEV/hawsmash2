'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatMT, type Cents } from '@delivery/core';

import { parseMTInput } from '@/lib/cash/input';
import { courierAdminErrorMessage } from '@/lib/estafeta/admin';
import { isStale, positionAge } from '@/lib/estafeta/tracking';
import { createClient } from '@/utils/supabase/client';

import type { PontoEstafeta } from './mapa';

const MapaEstafetas = dynamic(() => import('./mapa').then((m) => m.MapaEstafetas), {
  ssr: false,
  loading: () => <div className="h-[340px] animate-pulse rounded-2xl bg-white/[0.04]" />,
});

type Job = {
  delivery_id: string;
  order_id: string;
  order_number: string;
  daily_number: number | null;
  status: 'assigned' | 'picked_up';
  address: string | null;
  assigned_at: string;
  picked_up_at: string | null;
};

type Courier = {
  id: string;
  full_name: string;
  phone: string;
  active: boolean;
  on_shift: boolean;
  last_seen_at: string | null;
  has_pin: boolean;
  position: { lat: number; lng: number; accuracy_m: number | null; recorded_at: string } | null;
  jobs: Job[];
  delivered_today: number;
  balance_cents: number | null;
};

type Board = {
  store_id: string;
  pay_rule: { fixed_cents: number | null; pct: number };
  couriers: Courier[];
};

type LedgerRow = {
  id: string;
  kind: 'delivery_fee' | 'payout' | 'adjustment';
  amount_cents: number;
  method: string | null;
  note: string | null;
  created_at: string;
};

const GLASS = 'rounded-2xl border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px]';
const INPUT = 'w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[#F5A623]';
const money = (c: number) => formatMT(c as Cents);
const METODO: Record<string, string> = { cash: 'Dinheiro (gaveta)', mpesa: 'M-Pesa', emola: 'e-Mola', other: 'Outro' };

export default function EstafetasPage() {
  const supabase = useMemo(() => createClient(), []);
  const [stores, setStores] = useState<Array<{ id: string; short_name: string }>>([]);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [painel, setPainel] = useState<
    | { kind: 'novo' }
    | { kind: 'editar'; courier: Courier }
    | { kind: 'pin'; courier: Courier }
    | { kind: 'pagar'; courier: Courier }
    | { kind: 'acerto'; courier: Courier }
    | { kind: 'conta'; courier: Courier }
    | null
  >(null);

  useEffect(() => {
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: perfil } = await supabase.from('staff_profiles').select('role').eq('user_id', session.user.id).maybeSingle();
        setRole((perfil?.role as string | undefined) ?? null);
      }
      const { data } = await supabase.from('stores').select('id,short_name').eq('active', true).order('sort');
      const lista = (data ?? []) as Array<{ id: string; short_name: string }>;
      setStores(lista);
      setStoreId((atual) => atual ?? lista[0]?.id ?? null);
    })();
  }, [supabase]);

  const board = useQuery({
    queryKey: ['couriers-board', storeId],
    enabled: Boolean(storeId),
    // O mapa e o quadro andam sozinhos; o telemóvel manda posição a cada 15–60 s.
    refetchInterval: 15_000,
    queryFn: async (): Promise<Board> => {
      const { data, error } = await supabase.rpc('get_couriers_board', { p_store_id: storeId });
      if (error) throw new Error(courierAdminErrorMessage(error.message));
      return data as Board;
    },
  });

  const gere = role === 'owner' || role === 'manager';
  const dono = role === 'owner';
  const couriers = board.data?.couriers ?? [];
  const ativos = couriers.filter((c) => c.active);
  const inativos = couriers.filter((c) => !c.active);

  const pontos: PontoEstafeta[] = ativos
    .filter((c) => c.on_shift && c.position)
    .map((c) => ({
      id: c.id,
      nome: c.full_name.split(' ')[0],
      lat: c.position!.lat,
      lng: c.position!.lng,
      recordedAt: c.position!.recorded_at,
      aCaminho: c.jobs.some((j) => j.status === 'picked_up'),
    }));

  const terminou = useCallback(
    (texto: string) => {
      setMessage({ type: 'success', text: texto });
      setPainel(null);
      void board.refetch();
    },
    [board],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Estafetas</h1>
          <p className="text-sm text-[#8A7A69]">
            Quem está de serviço, onde está e o que leva. O estafeta entra em{' '}
            <span className="font-mono text-[#F5A623]">/estafeta</span> no telemóvel, com o telefone e o PIN.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {stores.length > 1 && (
            <select value={storeId ?? ''} onChange={(e) => setStoreId(e.target.value)} className={`${INPUT} w-auto`}>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.short_name}</option>
              ))}
            </select>
          )}
          {gere && (
            <button onClick={() => setPainel({ kind: 'novo' })} className="rounded-lg bg-[#F5A623] px-4 py-2 text-sm font-semibold text-black">
              + Estafeta
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className={`rounded-lg px-4 py-2 text-sm ${message.type === 'success' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
          {message.text}
        </div>
      )}
      {board.error && <div className="rounded-lg bg-red-500/15 px-4 py-2 text-sm text-red-300">{(board.error as Error).message}</div>}

      <section className="space-y-2">
        <MapaEstafetas pontos={pontos} />
        <p className="text-xs text-[#8A7A69]">
          Verde: de serviço · Azul: a caminho · Cinzento: sem sinal há mais de 5 min. O telemóvel só envia a posição com a página
          aberta e o ecrã aceso.
        </p>
      </section>

      {board.data && (
        <RegraPagamento
          storeId={board.data.store_id}
          regra={board.data.pay_rule}
          podeEditar={dono}
          onGuardado={() => terminou('Regra de pagamento guardada.')}
          onErro={(t) => setMessage({ type: 'error', text: t })}
        />
      )}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {board.isLoading && <p className="text-sm text-[#8A7A69]">A carregar…</p>}
        {board.data && ativos.length === 0 && (
          <p className={`${GLASS} p-5 text-sm text-[#8A7A69]`}>Ainda não há estafetas nesta loja.</p>
        )}
        {ativos.map((c) => (
          <CartaoEstafeta key={c.id} c={c} gere={gere} abrir={(kind) => setPainel({ kind, courier: c } as typeof painel)} />
        ))}
      </section>

      {inativos.length > 0 && (
        <details className="text-sm text-[#8A7A69]">
          <summary className="cursor-pointer">Desactivados ({inativos.length})</summary>
          <ul className="mt-2 space-y-1">
            {inativos.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2">
                <span>{c.full_name} · {c.phone}</span>
                {gere && (
                  <button className="text-[#F5A623]" onClick={() => setPainel({ kind: 'editar', courier: c })}>Editar</button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {painel && (
        <Modal onClose={() => setPainel(null)}>
          {painel.kind === 'novo' && storeId && (
            <FormEstafeta storeId={storeId} onDone={terminou} onErro={(t) => setMessage({ type: 'error', text: t })} />
          )}
          {painel.kind === 'editar' && (
            <FormEstafeta storeId={storeId!} courier={painel.courier} onDone={terminou} onErro={(t) => setMessage({ type: 'error', text: t })} />
          )}
          {painel.kind === 'pin' && <FormPin courier={painel.courier} onDone={terminou} />}
          {painel.kind === 'pagar' && <FormPagar courier={painel.courier} onDone={terminou} />}
          {painel.kind === 'acerto' && <FormAcerto courier={painel.courier} onDone={terminou} />}
          {painel.kind === 'conta' && <ContaCorrente courier={painel.courier} />}
        </Modal>
      )}
    </div>
  );
}

function CartaoEstafeta({
  c,
  gere,
  abrir,
}: {
  c: Courier;
  gere: boolean;
  abrir: (kind: 'editar' | 'pin' | 'pagar' | 'acerto' | 'conta') => void;
}) {
  const sinal = c.position ? (isStale(c.position.recorded_at) ? 'sem sinal' : 'a partilhar') : null;
  return (
    <article className={`${GLASS} space-y-3 p-4`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-white">{c.full_name}</p>
          <p className="text-xs text-[#8A7A69]">{c.phone}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${c.on_shift ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-[#8A7A69]'}`}>
          {c.on_shift ? 'De serviço' : 'Fora'}
        </span>
      </div>

      <div className="text-xs text-[#B8A898]">
        {c.position ? (
          <span>📍 {sinal} · {positionAge(c.position.recorded_at)}</span>
        ) : c.on_shift ? (
          <span className="text-amber-300">Sem localização (permissão ou página fechada)</span>
        ) : null}
        {!c.has_pin && <p className="text-amber-300">Sem PIN — não consegue entrar no telemóvel.</p>}
      </div>

      {c.jobs.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {c.jobs.map((j) => (
            <li key={j.delivery_id} className="flex items-center justify-between rounded-lg bg-black/20 px-2 py-1">
              <span className="text-white">{j.daily_number != null ? `#${j.daily_number}` : j.order_number}</span>
              <span className={j.status === 'picked_up' ? 'text-sky-300' : 'text-amber-300'}>
                {j.status === 'picked_up' ? 'a caminho' : 'por levantar'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[#8A7A69]">Sem entregas abertas.</p>
      )}

      <div className="flex items-center justify-between border-t border-white/[0.06] pt-2 text-sm">
        <span className="text-[#8A7A69]">Hoje: {c.delivered_today}</span>
        {c.balance_cents != null && (
          <span className="text-[#8A7A69]">
            A pagar: <b className="text-[#F5A623]">{money(c.balance_cents)}</b>
          </span>
        )}
      </div>

      {gere && (
        <div className="flex flex-wrap gap-2 text-xs">
          <button className="rounded-md bg-[#F5A623] px-2.5 py-1.5 font-semibold text-black" onClick={() => abrir('pagar')}>Pagar</button>
          <button className="rounded-md border border-white/10 px-2.5 py-1.5 text-white" onClick={() => abrir('conta')}>Conta</button>
          <button className="rounded-md border border-white/10 px-2.5 py-1.5 text-white" onClick={() => abrir('acerto')}>Acerto</button>
          <button className="rounded-md border border-white/10 px-2.5 py-1.5 text-white" onClick={() => abrir('pin')}>PIN</button>
          <button className="rounded-md border border-white/10 px-2.5 py-1.5 text-white" onClick={() => abrir('editar')}>Editar</button>
        </div>
      )}
    </article>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#1E140D] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function Erro({ texto }: { texto: string | null }) {
  return texto ? <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{texto}</p> : null;
}

function FormEstafeta({
  storeId,
  courier,
  onDone,
  onErro,
}: {
  storeId: string;
  courier?: Courier;
  onDone: (t: string) => void;
  onErro: (t: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [nome, setNome] = useState(courier?.full_name ?? '');
  const [telefone, setTelefone] = useState(courier?.phone ?? '');
  const [ativo, setAtivo] = useState(courier?.active ?? true);
  const [pin, setPin] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aGuardar, setAGuardar] = useState(false);

  const guardar = async () => {
    setErro(null);
    if (!courier && !/^[0-9]{4,6}$/.test(pin)) {
      setErro('O PIN tem 4 a 6 dígitos.');
      return;
    }
    setAGuardar(true);
    const { data: id, error } = await supabase.rpc('save_courier', {
      p_courier_id: courier?.id ?? null,
      p_store_id: storeId,
      p_full_name: nome,
      p_phone: telefone,
      p_active: ativo,
    });
    if (error) {
      setAGuardar(false);
      setErro(courierAdminErrorMessage(error.message));
      return;
    }
    if (!courier) {
      const { error: pinError } = await supabase.rpc('set_courier_pin', { p_courier_id: id, p_pin: pin });
      if (pinError) onErro(`Estafeta criado, mas o PIN falhou: ${courierAdminErrorMessage(pinError.message)}`);
    }
    setAGuardar(false);
    onDone(courier ? 'Estafeta actualizado.' : `${nome} criado. Entra em /estafeta com ${telefone} e o PIN.`);
  };

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-white">{courier ? 'Editar estafeta' : 'Novo estafeta'}</h2>
      <input className={INPUT} placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
      <input className={INPUT} placeholder="Telefone (84 123 4567)" inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
      {!courier && (
        <input
          className={INPUT}
          placeholder="PIN (4 a 6 dígitos)"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
      )}
      {courier && (
        <label className="flex items-center gap-2 text-sm text-white">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          Activo (desactivar termina a sessão no telemóvel dele)
        </label>
      )}
      <Erro texto={erro} />
      <button disabled={aGuardar} onClick={guardar} className="w-full rounded-lg bg-[#F5A623] py-2.5 font-semibold text-black disabled:opacity-60">
        {aGuardar ? 'A guardar…' : 'Guardar'}
      </button>
    </div>
  );
}

function FormPin({ courier, onDone }: { courier: Courier; onDone: (t: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [pin, setPin] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const guardar = async () => {
    const { error } = await supabase.rpc('set_courier_pin', { p_courier_id: courier.id, p_pin: pin });
    if (error) setErro(courierAdminErrorMessage(error.message));
    else onDone(`PIN de ${courier.full_name} definido. O telemóvel antigo deixa de entrar.`);
  };
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-white">PIN de {courier.full_name}</h2>
      <input
        className={INPUT}
        placeholder="Novo PIN (4 a 6 dígitos)"
        inputMode="numeric"
        maxLength={6}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
      />
      <Erro texto={erro} />
      <button onClick={guardar} className="w-full rounded-lg bg-[#F5A623] py-2.5 font-semibold text-black">Definir PIN</button>
    </div>
  );
}

function FormPagar({ courier, onDone }: { courier: Courier; onDone: (t: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const saldo = courier.balance_cents ?? 0;
  const [valor, setValor] = useState(saldo > 0 ? (saldo / 100).toFixed(2) : '');
  const [metodo, setMetodo] = useState('cash');
  const [nota, setNota] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aPagar, setAPagar] = useState(false);
  // Uma chave por abertura do formulário: tocar duas vezes não paga duas vezes (regra 4).
  const [requestId] = useState(() => crypto.randomUUID());

  const pagar = async () => {
    const cents = parseMTInput(valor);
    if (!cents || cents <= 0) {
      setErro('Valor inválido.');
      return;
    }
    setAPagar(true);
    setErro(null);
    const { error } = await supabase.rpc('courier_payout', {
      p_courier_id: courier.id,
      p_amount_cents: cents,
      p_method: metodo,
      p_note: nota || null,
      p_request_id: requestId,
    });
    setAPagar(false);
    if (error) setErro(courierAdminErrorMessage(error.message));
    else onDone(`Pagamento de ${money(cents)} a ${courier.full_name} registado.`);
  };

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-white">Pagar a {courier.full_name}</h2>
      <p className="text-sm text-[#8A7A69]">Em conta: <b className="text-[#F5A623]">{money(saldo)}</b></p>
      <input className={INPUT} inputMode="decimal" placeholder="Valor (MT)" value={valor} onChange={(e) => setValor(e.target.value)} />
      <select className={INPUT} value={metodo} onChange={(e) => setMetodo(e.target.value)}>
        {Object.entries(METODO).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      {metodo === 'cash' && (
        <p className="text-xs text-[#8A7A69]">Sai da gaveta como despesa do turno aberto. Sem turno aberto, não regista.</p>
      )}
      <input className={INPUT} placeholder="Nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} />
      <Erro texto={erro} />
      <button disabled={aPagar} onClick={pagar} className="w-full rounded-lg bg-[#F5A623] py-2.5 font-semibold text-black disabled:opacity-60">
        {aPagar ? 'A registar…' : 'Registar pagamento'}
      </button>
    </div>
  );
}

function FormAcerto({ courier, onDone }: { courier: Courier; onDone: (t: string) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [valor, setValor] = useState('');
  const [sinal, setSinal] = useState<'mais' | 'menos'>('mais');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());

  const guardar = async () => {
    const cents = parseMTInput(valor);
    if (!cents) {
      setErro('Valor inválido.');
      return;
    }
    const { error } = await supabase.rpc('courier_adjust', {
      p_courier_id: courier.id,
      p_amount_cents: sinal === 'mais' ? cents : -cents,
      p_reason: motivo,
      p_request_id: requestId,
    });
    if (error) setErro(courierAdminErrorMessage(error.message));
    else onDone('Acerto registado.');
  };

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-white">Acerto — {courier.full_name}</h2>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <button className={`rounded-lg py-2 ${sinal === 'mais' ? 'bg-emerald-600 text-white' : 'border border-white/10 text-white'}`} onClick={() => setSinal('mais')}>
          A loja deve mais
        </button>
        <button className={`rounded-lg py-2 ${sinal === 'menos' ? 'bg-red-600 text-white' : 'border border-white/10 text-white'}`} onClick={() => setSinal('menos')}>
          A loja deve menos
        </button>
      </div>
      <input className={INPUT} inputMode="decimal" placeholder="Valor (MT)" value={valor} onChange={(e) => setValor(e.target.value)} />
      <input className={INPUT} placeholder="Motivo (obrigatório)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      <Erro texto={erro} />
      <button onClick={guardar} className="w-full rounded-lg bg-[#F5A623] py-2.5 font-semibold text-black">Registar acerto</button>
    </div>
  );
}

function ContaCorrente({ courier }: { courier: Courier }) {
  const supabase = useMemo(() => createClient(), []);
  const conta = useQuery({
    queryKey: ['courier-ledger', courier.id],
    queryFn: async (): Promise<LedgerRow[]> => {
      const { data, error } = await supabase
        .from('courier_ledger')
        .select('id,kind,amount_cents,method,note,created_at')
        .eq('courier_id', courier.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(courierAdminErrorMessage(error.message));
      return (data ?? []) as LedgerRow[];
    },
  });
  const rotulo = (r: LedgerRow) =>
    r.kind === 'delivery_fee' ? 'Entrega' : r.kind === 'payout' ? `Pago · ${METODO[r.method ?? ''] ?? r.method}` : 'Acerto';

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-white">Conta de {courier.full_name}</h2>
      <p className="text-sm text-[#8A7A69]">Saldo: <b className="text-[#F5A623]">{money(courier.balance_cents ?? 0)}</b> (últimos 100 movimentos)</p>
      <ul className="max-h-[50vh] divide-y divide-white/5 overflow-y-auto text-sm">
        {(conta.data ?? []).map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-2">
            <span className="min-w-0">
              <span className="text-white">{rotulo(r)}</span>
              {r.note && <span className="block truncate text-xs text-[#8A7A69]">{r.note}</span>}
              <span className="block text-xs text-[#8A7A69]">
                {new Date(r.created_at).toLocaleString('pt-PT', { timeZone: 'Africa/Maputo', dateStyle: 'short', timeStyle: 'short' })}
              </span>
            </span>
            <span className={r.amount_cents > 0 ? 'text-emerald-400' : 'text-[#B8A898]'}>
              {r.amount_cents > 0 ? '+' : '−'}{money(Math.abs(r.amount_cents))}
            </span>
          </li>
        ))}
        {conta.data?.length === 0 && <li className="py-3 text-[#8A7A69]">Sem movimentos.</li>}
      </ul>
    </div>
  );
}

function RegraPagamento({
  storeId,
  regra,
  podeEditar,
  onGuardado,
  onErro,
}: {
  storeId: string;
  regra: { fixed_cents: number | null; pct: number };
  podeEditar: boolean;
  onGuardado: () => void;
  onErro: (t: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [modo, setModo] = useState<'pct' | 'fixo'>(regra.fixed_cents != null ? 'fixo' : 'pct');
  const [pct, setPct] = useState(String(regra.pct));
  const [fixo, setFixo] = useState(regra.fixed_cents != null ? (regra.fixed_cents / 100).toFixed(2) : '');

  const descricao =
    regra.fixed_cents != null ? `${money(regra.fixed_cents)} por entrega` : `${regra.pct}% da taxa de entrega cobrada ao cliente`;

  const guardar = async () => {
    const fixedCents = modo === 'fixo' ? parseMTInput(fixo) : null;
    if (modo === 'fixo' && fixedCents == null) {
      onErro('Valor fixo inválido.');
      return;
    }
    const p = Number(pct);
    const { error } = await supabase.rpc('set_courier_pay', {
      p_store_id: storeId,
      p_fixed_cents: fixedCents,
      p_pct: Number.isInteger(p) ? p : 100,
    });
    if (error) onErro(courierAdminErrorMessage(error.message));
    else onGuardado();
  };

  return (
    <section className={`${GLASS} flex flex-wrap items-center justify-between gap-3 p-4 text-sm`}>
      <p className="text-[#B8A898]">
        Paga-se ao estafeta: <b className="text-white">{descricao}</b>. Fica registado na conta dele no momento em que entrega.
      </p>
      {podeEditar && (
        <div className="flex flex-wrap items-center gap-2">
          <select className={`${INPUT} w-auto`} value={modo} onChange={(e) => setModo(e.target.value as 'pct' | 'fixo')}>
            <option value="pct">% da taxa</option>
            <option value="fixo">Valor fixo</option>
          </select>
          {modo === 'pct' ? (
            <input className={`${INPUT} w-20`} inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value.replace(/\D/g, ''))} />
          ) : (
            <input className={`${INPUT} w-28`} inputMode="decimal" placeholder="MT" value={fixo} onChange={(e) => setFixo(e.target.value)} />
          )}
          <button onClick={guardar} className="rounded-lg border border-[#F5A623] px-3 py-2 text-[#F5A623]">Guardar</button>
        </div>
      )}
    </section>
  );
}
