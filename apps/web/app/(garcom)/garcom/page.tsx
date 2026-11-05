'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMT, type Cents } from '@delivery/core';

import { enviarAcao, lerEstado, SemSessao } from '@/lib/garcom/client';
import type { LaunchResult, WaiterState, WaiterTable } from '@/lib/garcom/contract';
import {
  ESTADO_PEDIDO,
  lerRascunho,
  novosProntos,
  origemPedido,
  podeRetirar,
  podeServir,
  prontosParaServir,
  rascunhoKey,
} from '@/lib/garcom/pedido';
import { cartCount } from '@/lib/pos/cart';
import { resolvePosSettings } from '@/lib/pos/settings';
import { itemLabel, minutesOpen, tableName, tableTotalCents, type TableOrder } from '@/lib/pos/tables';

import { Esgotados } from './esgotados';
import { Historico } from './historico';
import { BotoesDaMesa, ReimprimirComanda, RetirarArtigo } from './mesa-accoes';
import { PedidoMesa } from './pedido-mesa';

const money = (c: number) => formatMT(c as Cents);
const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-PT', { timeZone: 'Africa/Maputo', hour: '2-digit', minute: '2-digit' });

type View =
  | { kind: 'mesas' }
  | { kind: 'historico' }
  | { kind: 'esgotados' }
  | { kind: 'mesa'; tableId: string }
  | { kind: 'pedir'; tableId: string };

/**
 * O ecrã em que se está vive no histórico do browser: o botão "voltar" do
 * Android volta à mesa ou à lista, em vez de fechar a app a meio de um pedido.
 */
function useNavegacao() {
  const [view, setView] = useState<View>({ kind: 'mesas' });
  useEffect(() => {
    window.history.replaceState({ garcom: { kind: 'mesas' } }, '');
    const onPop = (e: PopStateEvent) => setView((e.state?.garcom as View | undefined) ?? { kind: 'mesas' });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const abrir = useCallback((v: View) => {
    window.history.pushState({ garcom: v }, '');
    setView(v);
  }, []);
  const voltar = useCallback(() => window.history.back(), []);
  /** Mudar de separador não enche o histórico: o "voltar" não os percorre um a um. */
  const trocar = useCallback((v: View) => {
    window.history.replaceState({ garcom: v }, '');
    setView(v);
  }, []);
  return { view, abrir, voltar, trocar };
}

export default function GarcomPage() {
  const queryClient = useQueryClient();
  const estado = useQuery({
    queryKey: ['garcom'],
    queryFn: lerEstado,
    // A cozinha marca pronto, o QR lança na mesa: aparece sozinho.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: (n, err) => !(err instanceof SemSessao) && n < 2,
  });

  if (estado.error instanceof SemSessao) {
    return <Entrar onEntrou={() => void queryClient.invalidateQueries({ queryKey: ['garcom'] })} />;
  }
  if (!estado.data) {
    return (
      <main className="grid min-h-[100dvh] place-items-center p-6 text-center text-[var(--ink-dim)]">
        {estado.error ? (
          <div className="space-y-3">
            <p>{(estado.error as Error).message}</p>
            <button
              className="rounded-xl bg-[var(--gold)] px-5 py-3 font-semibold text-black"
              onClick={() => void estado.refetch()}
            >
              Tentar outra vez
            </button>
          </div>
        ) : (
          'A carregar…'
        )}
      </main>
    );
  }
  return <App estado={estado.data} recarregar={() => void estado.refetch()} />;
}

// ─── Entrar ───────────────────────────────────────────────────────────────────
function Entrar({ onEntrou }: { onEntrou: () => void }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aEntrar, setAEntrar] = useState(false);

  const submeter = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    setAEntrar(true);
    try {
      const res = await fetch('/api/garcom/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, pin }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(body.error ?? 'Não foi possível entrar.');
        setPin('');
        return;
      }
      onEntrou();
    } catch {
      setErro('Sem rede. Tenta outra vez.');
    } finally {
      setAEntrar(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-6 px-5">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-4xl tracking-wide text-[var(--gold)]">Garçom</h1>
        <p className="mt-1 text-sm text-[var(--ink-dim)]">Entra com o teu telefone e o PIN que a loja te deu.</p>
      </div>
      <form onSubmit={submeter} className="space-y-4">
        <label className="block">
          <span className="text-sm text-[var(--ink-dim)]">Telefone</span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="84 123 4567"
            className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-lg outline-none focus:border-[var(--gold)]"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm text-[var(--ink-dim)]">PIN</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            pattern="[0-9]{4,6}"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-lg tracking-[0.4em] outline-none focus:border-[var(--gold)]"
            required
          />
        </label>
        {erro && <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{erro}</p>}
        <button
          type="submit"
          disabled={aEntrar}
          className="w-full rounded-xl bg-[var(--gold)] py-4 text-lg font-semibold text-black disabled:opacity-60"
        >
          {aEntrar ? 'A entrar…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
type Aviso = { tipo: 'ok' | 'erro'; texto: string };

function App({ estado, recarregar }: { estado: WaiterState; recarregar: () => void }) {
  const queryClient = useQueryClient();
  const { view, abrir, voltar, trocar } = useNavegacao();
  const notasRapidas = resolvePosSettings(estado.pos_config ?? {}).quickNotes;
  const [aviso, setAviso] = useState<Aviso | null>(null);

  // Pedido que ficou pronto: o telemóvel vibra, para quem o tem no bolso.
  const prontosVistos = useRef<Set<string> | null>(null);
  useEffect(() => {
    const novos = prontosVistos.current ? novosProntos(prontosVistos.current, estado.tables) : [];
    if (novos.length > 0 && 'vibrate' in navigator) navigator.vibrate([250, 120, 250]);
    prontosVistos.current = new Set(prontosParaServir(estado.tables).map(({ order }) => order.id));
  }, [estado.tables]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), aviso.tipo === 'ok' ? 6000 : 9000);
    return () => clearTimeout(t);
  }, [aviso]);

  const semSessao = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: ['garcom'] }),
    [queryClient],
  );

  const servir = useCallback(
    async (orderId: string) => {
      const r = await enviarAcao({ action: 'serve', orderId });
      if (r.status === 401) {
        semSessao();
        return false;
      }
      if (!r.ok) setAviso({ tipo: 'erro', texto: r.error ?? 'Não foi possível.' });
      recarregar();
      return r.ok;
    },
    [recarregar, semSessao],
  );

  const sair = async () => {
    await enviarAcao({ action: 'logout' });
    semSessao();
  };

  const mesa =
    view.kind === 'mesa' || view.kind === 'pedir' ? estado.tables.find((t) => t.id === view.tableId) ?? null : null;

  let ecra: React.ReactNode;
  if (view.kind === 'pedir' && mesa) {
    ecra = (
      <PedidoMesa
        mesa={mesa}
        lojaAberta={estado.store.open}
        notasRapidas={notasRapidas}
        onVoltar={voltar}
        onSemSessao={semSessao}
        onEnviado={(r: LaunchResult) => {
          setAviso({
            tipo: 'ok',
            texto: r.duplicate
              ? `Já tinha chegado à cozinha · Mesa ${r.table_number}`
              : `Na cozinha · Mesa ${r.table_number}${r.daily_number != null ? ` · Senha ${r.daily_number}` : ''} · ${money(r.total_cents)}`,
          });
          recarregar();
          voltar();
        }}
      />
    );
  } else if (mesa) {
    ecra = (
      <DetalheMesa
        mesa={mesa}
        estado={estado}
        onVoltar={voltar}
        onPedir={() => abrir({ kind: 'pedir', tableId: mesa.id })}
        servir={servir}
        aviso={setAviso}
        recarregar={recarregar}
        semSessao={semSessao}
      />
    );
  } else if (view.kind === 'historico') {
    ecra = <Historico onSemSessao={semSessao} />;
  } else if (view.kind === 'esgotados') {
    ecra = <Esgotados aviso={setAviso} onSemSessao={semSessao} />;
  } else {
    ecra = (
      <ListaMesas
        estado={estado}
        abrirMesa={(id) => abrir({ kind: 'mesa', tableId: id })}
        servir={servir}
        sair={sair}
      />
    );
  }

  const separador = view.kind === 'mesas' || view.kind === 'historico' || view.kind === 'esgotados';

  return (
    <>
      {ecra}
      {separador && (
        <nav
          aria-label="Secções"
          className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-md grid-cols-3 border-t border-white/10 bg-[var(--bg-1)]"
        >
          {(
            [
              ['mesas', 'Mesas'],
              ['historico', 'Os meus pedidos'],
              ['esgotados', 'Esgotados'],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              aria-current={view.kind === kind ? 'page' : undefined}
              onClick={() => trocar({ kind })}
              className={`py-4 text-sm font-semibold ${view.kind === kind ? 'text-[var(--gold)]' : 'text-[var(--ink-dim)]'}`}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      {aviso && (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4">
          <p
            role="status"
            className={`pointer-events-auto max-w-md rounded-xl px-4 py-3 text-center text-sm font-semibold shadow-2xl ${
              aviso.tipo === 'ok' ? 'bg-emerald-500 text-black' : 'bg-red-500 text-white'
            }`}
            onClick={() => setAviso(null)}
          >
            {aviso.texto}
          </p>
        </div>
      )}
    </>
  );
}

/** Quantos artigos estão no rascunho desta mesa, guardado no telemóvel. */
function artigosPorEnviar(tableId: string): number {
  try {
    const r = lerRascunho(window.localStorage.getItem(rascunhoKey(tableId)), tableId, Date.now());
    return r ? cartCount(r.cart) : 0;
  } catch {
    return 0;
  }
}

// ─── Lista de mesas ───────────────────────────────────────────────────────────
function ListaMesas({
  estado,
  abrirMesa,
  servir,
  sair,
}: {
  estado: WaiterState;
  abrirMesa: (id: string) => void;
  servir: (orderId: string) => Promise<boolean>;
  sair: () => void;
}) {
  const prontos = prontosParaServir(estado.tables);
  const agora = new Date();

  return (
    <main className="mx-auto max-w-md space-y-5 px-4 pb-24 pt-4">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{estado.waiter.full_name}</p>
          <p className="truncate text-xs text-[var(--ink-dim)]">
            {estado.store.name} · {estado.today.orders} {estado.today.orders === 1 ? 'pedido' : 'pedidos'} hoje
          </p>
        </div>
        <button onClick={sair} className="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-sm text-[var(--ink-dim)]">
          Sair
        </button>
      </header>

      {!estado.store.open && (
        <p className="rounded-xl bg-amber-500/15 px-4 py-3 text-sm text-amber-200">
          A loja não está a receber pedidos de mesa agora. Fala com o balcão.
        </p>
      )}

      {prontos.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-300">
            Prontos para servir ({prontos.length})
          </h2>
          <ul className="space-y-2">
            {prontos.map(({ table, order }) => (
              <li key={order.id} className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 p-3">
                <button className="block w-full text-left" onClick={() => abrirMesa(table.id)}>
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="font-[family-name:var(--font-display)] text-2xl tracking-wide text-emerald-300">
                      Mesa {table.number}
                    </span>
                    <span className="text-xs text-[var(--ink-dim)]">
                      {order.daily_number != null ? `Senha ${order.daily_number} · ` : ''}
                      {hora(order.created_at)}
                    </span>
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-[var(--ink-dim)]">
                    {order.items.map((item) => `${item.qty}× ${itemLabel(item)}`).join(' · ')}
                  </p>
                </button>
                <div className="mt-2">
                  <BotaoServir orderId={order.id} servir={servir} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-dim)]">Mesas</h2>
        {estado.tables.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center text-sm text-[var(--ink-dim)]">
            Esta loja ainda não tem mesas. O dono cria-as no painel, em Mesas.
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-2">
            {estado.tables.map((table) => {
              const ocupada = table.orders.length > 0;
              const nome = tableName(table);
              const minutos = minutesOpen(table, agora);
              const temPronto = table.orders.some((order) => order.status === 'ready');
              const porEnviar = artigosPorEnviar(table.id);
              return (
                <li key={table.id}>
                  <button
                    onClick={() => abrirMesa(table.id)}
                    className={`relative flex h-24 w-full flex-col items-center justify-center rounded-2xl border px-1 text-center transition-colors ${
                      temPronto
                        ? 'border-emerald-400/70 bg-emerald-500/15'
                        : ocupada
                          ? 'border-[var(--gold)]/60 bg-[var(--gold)]/10'
                          : 'border-white/10 bg-white/[0.03]'
                    } ${table.active ? '' : 'opacity-60'}`}
                  >
                    <span
                      className={`font-[family-name:var(--font-display)] text-3xl leading-none tracking-wide ${
                        ocupada ? 'text-[var(--gold)]' : 'text-[var(--ink-dim)]'
                      }`}
                    >
                      {table.number}
                    </span>
                    <span className="mt-1 w-full truncate text-[11px] text-[var(--ink-dim)]">
                      {nome ?? (ocupada ? money(tableTotalCents(table)) : table.active ? 'Livre' : 'Desactivada')}
                    </span>
                    {ocupada && minutos != null && (
                      <span className="text-[10px] text-[var(--ink-mute)]">{minutos} min</span>
                    )}
                    {porEnviar > 0 && (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-black">
                        {porEnviar}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

// ─── Mesa ─────────────────────────────────────────────────────────────────────
function DetalheMesa({
  mesa,
  estado,
  onVoltar,
  onPedir,
  servir,
  aviso,
  recarregar,
  semSessao,
}: {
  mesa: WaiterTable;
  estado: WaiterState;
  onVoltar: () => void;
  onPedir: () => void;
  servir: (orderId: string) => Promise<boolean>;
  aviso: (a: Aviso) => void;
  recarregar: () => void;
  semSessao: () => void;
}) {
  const lojaAberta = estado.store.open;
  const nome = tableName(mesa);
  const porEnviar = artigosPorEnviar(mesa.id);
  const agoraMs = Date.now();
  const podePedir = lojaAberta && mesa.active;

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 pb-10 pt-4">
      <header className="flex items-center gap-3">
        <button
          onClick={onVoltar}
          aria-label="Voltar às mesas"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 text-xl"
        >
          ←
        </button>
        <div className="min-w-0">
          <h1 className="font-[family-name:var(--font-display)] text-3xl leading-none tracking-wide text-[var(--gold)]">
            Mesa {mesa.number}
          </h1>
          <p className="truncate text-sm text-[var(--ink-dim)]">{nome ?? (mesa.orders.length > 0 ? 'Conta aberta' : 'Livre')}</p>
        </div>
      </header>

      <button
        onClick={onPedir}
        disabled={!podePedir}
        className={`w-full rounded-2xl py-5 text-lg font-bold disabled:opacity-50 ${
          porEnviar > 0 ? 'bg-amber-400 text-black' : 'bg-[var(--gold)] text-black'
        }`}
      >
        {porEnviar > 0 ? `Continuar o pedido (${porEnviar} por enviar)` : '+ Novo pedido'}
      </button>
      {!mesa.active && (
        <p className="text-center text-sm text-amber-200">Mesa desactivada no painel: só se cobra a conta, no balcão.</p>
      )}

      {mesa.orders.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-center text-sm text-[var(--ink-dim)]">
          Mesa livre. O pedido que lançares vai para a cozinha e fica na conta da mesa.
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {mesa.orders.map((order) => (
              <PedidoNaMesa
                key={order.id}
                order={order}
                servir={servir}
                podeRetirarAgora={podeRetirar(order, estado.waiter.id, estado.store.remove_minutes, agoraMs)}
                aviso={aviso}
                recarregar={recarregar}
                semSessao={semSessao}
              />
            ))}
          </ul>
          <div className="flex items-baseline justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <span className="text-sm text-[var(--ink-dim)]">Conta da mesa</span>
            <span className="text-xl font-bold text-[var(--gold)]">{money(tableTotalCents(mesa))}</span>
          </div>
          <BotoesDaMesa mesa={mesa} estado={estado} aviso={aviso} recarregar={recarregar} semSessao={semSessao} aoFechar={onVoltar} />
          {!estado.waiter.can_charge && (
            <p className="text-center text-xs text-[var(--ink-mute)]">A conta paga-se no balcão, no fim.</p>
          )}
        </>
      )}
    </main>
  );
}

function PedidoNaMesa({
  order,
  servir,
  podeRetirarAgora,
  aviso,
  recarregar,
  semSessao,
}: {
  order: TableOrder;
  servir: (orderId: string) => Promise<boolean>;
  podeRetirarAgora: boolean;
  aviso: (a: Aviso) => void;
  recarregar: () => void;
  semSessao: () => void;
}) {
  const [aRetirar, setARetirar] = useState<TableOrder['items'][number] | null>(null);
  const cor =
    order.status === 'ready'
      ? 'bg-emerald-500/20 text-emerald-300'
      : order.status === 'delivered'
        ? 'bg-white/10 text-[var(--ink-dim)]'
        : 'bg-amber-500/20 text-amber-300';
  return (
    <li className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <p className="flex items-center justify-between gap-2 text-xs text-[var(--ink-mute)]">
        <span>
          {origemPedido(order)} · {hora(order.created_at)}
          {order.daily_number != null ? ` · Senha ${order.daily_number}` : ''}
        </span>
        <span className={`rounded-full px-2 py-0.5 font-semibold ${cor}`}>{ESTADO_PEDIDO[order.status] ?? order.status}</span>
      </p>
      <ul className="space-y-1 text-[0.95rem]">
        {order.items.map((item, i) => (
          <li key={item.id ?? i}>
            <span className="font-bold text-[var(--gold)]">{item.qty}×</span> {itemLabel(item)}
            {item.notes && <span className="block pl-6 text-xs italic text-[var(--ink-dim)]">{item.notes}</span>}
            {podeRetirarAgora && item.id && (
              <button onClick={() => setARetirar(item)} className="ml-6 block py-1 text-xs font-semibold text-red-300 underline">
                Retirar
              </button>
            )}
          </li>
        ))}
      </ul>
      {order.notes && <p className="rounded-lg bg-white/5 px-2 py-1 text-sm">📝 {order.notes}</p>}
      {podeServir(order) && <BotaoServir orderId={order.id} servir={servir} />}
      {podeServir(order) && <ReimprimirComanda orderId={order.id} aviso={aviso} semSessao={semSessao} />}
      {aRetirar && (
        <RetirarArtigo
          item={aRetirar}
          aviso={aviso}
          recarregar={recarregar}
          semSessao={semSessao}
          onFechar={() => setARetirar(null)}
        />
      )}
    </li>
  );
}

/**
 * "Servido" pede dois toques — nada de confirm() do browser (§7), e um toque
 * sem querer no bolso não tira o pedido da lista dos prontos.
 */
function BotaoServir({ orderId, servir }: { orderId: string; servir: (orderId: string) => Promise<boolean> }) {
  const [aConfirmar, setAConfirmar] = useState(false);
  const [aEnviar, setAEnviar] = useState(false);

  useEffect(() => {
    if (!aConfirmar) return;
    const t = setTimeout(() => setAConfirmar(false), 4000);
    return () => clearTimeout(t);
  }, [aConfirmar]);

  const tocar = async () => {
    if (!aConfirmar) {
      setAConfirmar(true);
      return;
    }
    setAEnviar(true);
    await servir(orderId);
    setAEnviar(false);
    setAConfirmar(false);
  };

  return (
    <button
      onClick={tocar}
      disabled={aEnviar}
      className={`w-full rounded-xl py-3 font-bold disabled:opacity-60 ${
        aConfirmar ? 'bg-emerald-400 text-black' : 'border border-emerald-400/50 text-emerald-300'
      }`}
    >
      {aEnviar ? 'A registar…' : aConfirmar ? 'Tocar outra vez para confirmar' : 'Servido ✓'}
    </button>
  );
}
