'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMT, type Cents } from '@delivery/core';

import { PosIcon, type PosIconName } from '@/app/(pos)/pos/pos-icons';
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
import { itemLabel, minutesOpen, tableName, tableNote, tableTotalCents, type TableOrder } from '@/lib/pos/tables';

import { Esgotados } from './esgotados';
import { Historico } from './historico';
import { BotoesDaMesa, ReimprimirComanda, RetirarArtigo } from './mesa-accoes';
import { PedidoMesa } from './pedido-mesa';
import { CAMPO, Nota, Secao, Topo, Vazio, type Aviso } from './ui';

const money = (c: number) => formatMT(c as Cents);
const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-PT', { timeZone: 'Africa/Maputo', hour: '2-digit', minute: '2-digit' });
const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

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
      <main className="grid min-h-[100dvh] place-items-center p-6 text-center text-ink-mute">
        {estado.error ? (
          <div className="flex max-w-xs flex-col items-center gap-4">
            <span className="pos-mark pos-mark--warn" aria-hidden>
              <PosIcon name="clock" size={28} />
            </span>
            <p className="text-ink-dim">{(estado.error as Error).message}</p>
            <button className="pos-btn pos-btn--primary w-full" onClick={() => void estado.refetch()}>
              Tentar outra vez
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-gold" aria-hidden />
            A carregar…
          </div>
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
    <main className="mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-8 px-5 py-10">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-[20px] bg-[var(--pos-accent-soft)] text-gold shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--gold)_35%,transparent)]">
          <PosIcon name="table" size={30} />
        </span>
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Garçom</h1>
          <p className="mt-1 text-sm text-ink-mute">Entra com o teu telefone e o PIN que a loja te deu.</p>
        </div>
      </div>
      <form onSubmit={submeter} className="pos-card space-y-4 p-5">
        <label className="block space-y-1.5">
          <span className="pos-eyebrow">Telefone</span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="84 123 4567"
            className={`${CAMPO} pos-num text-lg`}
            required
          />
        </label>
        <label className="block space-y-1.5">
          <span className="pos-eyebrow">PIN</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            pattern="[0-9]{4,6}"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            className={`${CAMPO} text-lg tracking-[0.5em]`}
            required
          />
        </label>
        {erro && <Nota tom="danger">{erro}</Nota>}
        <button type="submit" disabled={aEntrar} className="pos-btn pos-btn--primary w-full">
          {aEntrar ? 'A entrar…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
const SEPARADORES: ReadonlyArray<readonly ['mesas' | 'historico' | 'esgotados', string, PosIconName]> = [
  ['mesas', 'Mesas', 'table'],
  ['historico', 'Os meus pedidos', 'ticket'],
  ['esgotados', 'Esgotados', 'ban'],
];

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
  const prontos = prontosParaServir(estado.tables).length;

  return (
    <>
      {ecra}
      {separador && (
        <nav
          aria-label="Secções"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.07] bg-bg1 pb-[env(safe-area-inset-bottom)]"
        >
          <div className="mx-auto grid max-w-md grid-cols-3 gap-1 px-2 py-1.5">
            {SEPARADORES.map(([kind, label, icone]) => {
              const activo = view.kind === kind;
              return (
                <button
                  key={kind}
                  aria-current={activo ? 'page' : undefined}
                  onClick={() => trocar({ kind })}
                  className={`pos-press relative flex flex-col items-center gap-1 rounded-2xl py-2 text-[11px] font-bold tracking-wide ${
                    activo ? 'bg-[var(--pos-accent-soft)] text-gold' : 'text-ink-mute'
                  }`}
                >
                  <PosIcon name={icone} size={22} strokeWidth={activo ? 2.2 : 1.8} />
                  {label}
                  {kind === 'mesas' && prontos > 0 && !activo && (
                    <span className="pos-num absolute right-[calc(50%-1.6rem)] top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-emerald-400 px-1 text-[10px] font-extrabold text-black">
                      {prontos}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>
      )}
      {aviso && (
        <div className="pointer-events-none fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-50 flex justify-center px-4">
          <button
            role="status"
            onClick={() => setAviso(null)}
            className={`pos-pop pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-bold shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)] ${
              aviso.tipo === 'ok' ? 'bg-emerald-400 text-[#04130d]' : 'bg-red-500 text-white'
            }`}
          >
            <PosIcon name={aviso.tipo === 'ok' ? 'check' : 'ban'} size={20} strokeWidth={2.6} className="shrink-0" />
            {aviso.texto}
          </button>
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
type Filtro = 'todas' | 'ocupadas' | 'livres';

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
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const prontos = prontosParaServir(estado.tables);
  const agora = new Date();
  const ocupadas = estado.tables.filter((t) => t.orders.length > 0);
  const abertoNaSala = ocupadas.reduce((soma, t) => soma + tableTotalCents(t), 0);
  const visiveis = estado.tables.filter((t) =>
    filtro === 'ocupadas' ? t.orders.length > 0 : filtro === 'livres' ? t.orders.length === 0 : true,
  );

  return (
    <main className="mx-auto max-w-md pb-28">
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-bg0 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--pos-accent-soft)] text-sm font-extrabold text-gold shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--gold)_35%,transparent)]">
            {iniciais(estado.waiter.full_name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-extrabold leading-tight">{estado.waiter.full_name}</p>
            <p className="flex items-center gap-1.5 truncate text-xs text-ink-mute">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${estado.store.open ? 'bg-emerald-400' : 'bg-amber-400'}`}
                aria-hidden
              />
              {estado.store.name} · {estado.store.open ? 'aberta' : 'fechada'}
            </p>
          </div>
          <button onClick={sair} className="pos-btn pos-btn--quiet !min-h-10 shrink-0 !rounded-xl !px-3 text-sm">
            Sair
          </button>
        </div>
      </header>

      <div className="space-y-5 px-4 pt-4">
        <section className="grid grid-cols-3 gap-2">
          <Indicador titulo="Ocupadas" valor={`${ocupadas.length}`} sufixo={`/${estado.tables.length}`} />
          <Indicador titulo="Prontos" valor={`${prontos.length}`} tom={prontos.length > 0 ? 'ok' : undefined} />
          <Indicador titulo="Hoje" valor={`${estado.today.orders}`} sufixo={estado.today.orders === 1 ? ' pedido' : ' pedidos'} />
        </section>

        {!estado.store.open && <Nota tom="warn">A loja não está a receber pedidos de mesa agora. Fala com o balcão.</Nota>}

        {prontos.length > 0 && (
          <section className="space-y-2">
            <Secao titulo="Prontos para servir" conta={prontos.length} tom="ok" />
            <ul className="space-y-2">
              {prontos.map(({ table, order }) => (
                <li
                  key={order.id}
                  className="pos-pop overflow-hidden rounded-[20px] bg-emerald-400/[0.08] shadow-[inset_0_0_0_1px_rgba(52,211,153,0.35)]"
                >
                  <button className="pos-press block w-full p-4 pb-3 text-left" onClick={() => abrirMesa(table.id)}>
                    <p className="flex items-center justify-between gap-2">
                      <span className="flex items-baseline gap-2">
                        <span className="pos-eyebrow !text-emerald-300/80">Mesa</span>
                        <span className="pos-num text-3xl font-extrabold leading-none text-emerald-300">{table.number}</span>
                      </span>
                      <span className="pos-num text-xs text-ink-mute">
                        {order.daily_number != null ? `Senha ${order.daily_number} · ` : ''}
                        {hora(order.created_at)}
                      </span>
                    </p>
                    <p className="mt-2 line-clamp-2 text-sm text-ink-dim">
                      {order.items.map((item) => `${item.qty}× ${itemLabel(item)}`).join(' · ')}
                    </p>
                  </button>
                  <div className="px-4 pb-4">
                    <BotaoServir orderId={order.id} servir={servir} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <Secao titulo="Mesas" />
            {abertoNaSala > 0 && (
              <p className="text-xs text-ink-mute">
                Em aberto <span className="pos-num font-bold text-ink-dim">{money(abertoNaSala)}</span>
              </p>
            )}
          </div>
          {estado.tables.length === 0 ? (
            <Vazio>Esta loja ainda não tem mesas. O dono cria-as no painel, em Mesas.</Vazio>
          ) : (
            <>
              <div className="pos-seg" role="group" aria-label="Filtrar mesas">
                {(
                  [
                    ['todas', 'Todas', estado.tables.length],
                    ['ocupadas', 'Ocupadas', ocupadas.length],
                    ['livres', 'Livres', estado.tables.length - ocupadas.length],
                  ] as const
                ).map(([id, label, n]) => (
                  <button key={id} aria-pressed={filtro === id} onClick={() => setFiltro(id)} className="!min-h-11 !text-sm">
                    {label}
                    <span className="pos-num text-xs opacity-70">{n}</span>
                  </button>
                ))}
              </div>
              {visiveis.length === 0 ? (
                <Vazio>{filtro === 'ocupadas' ? 'Nenhuma mesa com conta aberta.' : 'Todas as mesas estão ocupadas.'}</Vazio>
              ) : (
                <ul className="grid grid-cols-3 gap-2">
                  {visiveis.map((table) => (
                    <CartaoMesa key={table.id} table={table} agora={agora} onAbrir={() => abrirMesa(table.id)} />
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function Indicador({ titulo, valor, sufixo, tom }: { titulo: string; valor: string; sufixo?: string; tom?: 'ok' }) {
  return (
    <div
      className={`rounded-2xl px-3 py-2.5 ${
        tom === 'ok' ? 'bg-emerald-400/10 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.3)]' : 'pos-card !rounded-2xl'
      }`}
    >
      <p className={`pos-eyebrow ${tom === 'ok' ? '!text-emerald-300/80' : ''}`}>{titulo}</p>
      <p className="mt-0.5 truncate">
        <span className={`pos-num text-2xl font-extrabold leading-none ${tom === 'ok' ? 'text-emerald-300' : ''}`}>{valor}</span>
        {sufixo && <span className="text-xs font-semibold text-ink-mute">{sufixo}</span>}
      </p>
    </div>
  );
}

function CartaoMesa({ table, agora, onAbrir }: { table: WaiterTable; agora: Date; onAbrir: () => void }) {
  const ocupada = table.orders.length > 0;
  const nome = tableName(table);
  const minutos = minutesOpen(table, agora);
  const temPronto = table.orders.some((order) => order.status === 'ready');
  const porEnviar = artigosPorEnviar(table.id);

  const fundo = temPronto
    ? 'bg-emerald-400/[0.09] shadow-[inset_0_0_0_1.5px_rgba(52,211,153,0.55)]'
    : ocupada
      ? 'bg-[radial-gradient(120%_90%_at_50%_0%,color-mix(in_srgb,var(--gold)_14%,var(--bg-2))_0%,var(--bg-2)_70%)] shadow-[inset_0_0_0_1px_var(--pos-accent-line)]'
      : 'bg-white/[0.025] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]';

  return (
    <li>
      <button
        onClick={onAbrir}
        className={`pos-press relative flex h-[7.25rem] w-full flex-col justify-between rounded-[18px] p-2.5 text-left ${fundo} ${
          table.active ? '' : 'opacity-50'
        }`}
      >
        <span className="flex items-center justify-between gap-1">
          <span className={`text-[10px] font-bold tracking-[0.14em] ${ocupada ? 'text-gold opacity-80' : 'text-ink-mute'}`}>MESA</span>
          {temPronto ? (
            <span className="rounded-full bg-emerald-400 px-1.5 py-px text-[9px] font-extrabold tracking-wide text-black">PRONTO</span>
          ) : porEnviar > 0 ? (
            <span className="rounded-full bg-amber-400 px-1.5 py-px text-[9px] font-extrabold tracking-wide text-black">
              {porEnviar} POR ENVIAR
            </span>
          ) : ocupada && minutos != null ? (
            <span className="pos-num flex items-center gap-0.5 text-[10px] font-semibold text-ink-mute">
              <PosIcon name="clock" size={11} />
              {minutos}m
            </span>
          ) : null}
        </span>
        <span
          className={`pos-num text-[2.5rem] font-extrabold leading-none ${
            temPronto ? 'text-emerald-300' : ocupada ? 'text-gold' : 'text-ink-mute'
          }`}
        >
          {table.number}
        </span>
        <span className="block w-full min-w-0">
          {ocupada ? (
            <>
              {nome && <span className="block truncate text-[11px] font-bold text-ink">{nome}</span>}
              <span className="pos-num block truncate text-xs font-bold text-ink-dim">{money(tableTotalCents(table))}</span>
            </>
          ) : (
            <span className="block truncate text-[11px] font-semibold text-ink-mute">{table.active ? 'Livre' : 'Desactivada'}</span>
          )}
        </span>
      </button>
    </li>
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
  const nota = tableNote(mesa);
  const porEnviar = artigosPorEnviar(mesa.id);
  const agoraMs = Date.now();
  const podePedir = lojaAberta && mesa.active;
  const minutos = minutesOpen(mesa, new Date(agoraMs));
  const temConta = mesa.orders.length > 0;

  return (
    <main className="mx-auto max-w-md pb-10">
      <Topo
        onVoltar={onVoltar}
        sobre={temConta ? `Conta aberta${minutos != null ? ` · há ${minutos} min` : ''}` : 'Livre'}
        titulo={
          <>
            Mesa <span className="pos-num text-gold">{mesa.number}</span>
          </>
        }
        detalhe={
          nome || nota ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <PosIcon name="user" size={13} className="shrink-0" />
              <span className="truncate">
                {nome && <b className="font-bold text-ink">{nome}</b>}
                {nome && nota ? ' · ' : ''}
                {/* Quem é o cliente (1129): é assim que o prato chega à pessoa certa. */}
                {nota}
              </span>
            </span>
          ) : undefined
        }
        direita={
          temConta ? (
            <div className="shrink-0 text-right">
              <p className="pos-eyebrow">Total</p>
              <p className="pos-num text-xl font-extrabold text-gold">{money(tableTotalCents(mesa))}</p>
            </div>
          ) : undefined
        }
      />

      <div className="space-y-4 px-4 pt-4">
        <button
          onClick={onPedir}
          disabled={!podePedir}
          className={`pos-btn pos-btn--lg w-full ${porEnviar > 0 ? '!bg-amber-400 !font-extrabold !text-black' : 'pos-btn--primary'}`}
        >
          <PosIcon name={porEnviar > 0 ? 'pencil' : 'plus'} size={24} strokeWidth={2.4} />
          {porEnviar > 0 ? `Continuar o pedido · ${porEnviar}` : 'Novo pedido'}
        </button>
        {!mesa.active && <Nota tom="warn">Mesa desactivada no painel: só se cobra a conta, no balcão.</Nota>}

        {!temConta ? (
          <Vazio>Mesa livre. O pedido que lançares vai para a cozinha e fica na conta da mesa.</Vazio>
        ) : (
          <>
            <section className="space-y-2">
              <Secao titulo="Pedidos" conta={mesa.orders.length} />
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
            </section>
            <section className="space-y-2">
              <Secao titulo="Conta" />
              <BotoesDaMesa mesa={mesa} estado={estado} aviso={aviso} recarregar={recarregar} semSessao={semSessao} aoFechar={onVoltar} />
              {!estado.waiter.can_charge && <p className="text-center text-xs text-ink-mute">A conta paga-se no balcão, no fim.</p>}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

const TOM_DO_ESTADO: Record<string, string> = {
  ready: 'bg-emerald-400/15 text-emerald-300',
  delivered: 'bg-white/[0.08] text-ink-mute',
};

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
  const pronto = order.status === 'ready';
  return (
    <li
      className={`space-y-3 rounded-[20px] p-4 ${
        pronto ? 'bg-emerald-400/[0.06] shadow-[inset_0_0_0_1px_rgba(52,211,153,0.3)]' : 'pos-card'
      }`}
    >
      <p className="flex items-center justify-between gap-2">
        <span className="pos-num truncate text-xs font-semibold text-ink-mute">
          {origemPedido(order)} · {hora(order.created_at)}
          {order.daily_number != null ? ` · Senha ${order.daily_number}` : ''}
        </span>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider ${
            TOM_DO_ESTADO[order.status] ?? 'bg-amber-400/15 text-amber-300'
          }`}
        >
          {ESTADO_PEDIDO[order.status] ?? order.status}
        </span>
      </p>
      <ul className="space-y-2">
        {order.items.map((item, i) => (
          <li key={item.id ?? i} className="flex items-start gap-3">
            <span className="pos-num grid h-7 min-w-7 shrink-0 place-items-center rounded-lg bg-[var(--pos-accent-soft)] px-1.5 text-sm font-extrabold text-gold">
              {item.qty}
            </span>
            <span className="min-w-0 flex-1 pt-0.5">
              <span className="block font-semibold leading-snug">{itemLabel(item)}</span>
              {item.notes && <span className="block text-xs italic text-amber-200/90">{item.notes}</span>}
            </span>
            {podeRetirarAgora && item.id && (
              <button
                onClick={() => setARetirar(item)}
                className="pos-btn pos-btn--danger !min-h-8 shrink-0 !rounded-lg !px-2.5 text-xs"
              >
                Retirar
              </button>
            )}
          </li>
        ))}
      </ul>
      {order.notes && (
        <p className="pos-well flex gap-2 px-3 py-2 text-sm text-ink-dim">
          <PosIcon name="pencil" size={14} className="mt-0.5 shrink-0" />
          {order.notes}
        </p>
      )}
      {podeServir(order) && (
        <div className="space-y-1">
          <BotaoServir orderId={order.id} servir={servir} />
          <ReimprimirComanda orderId={order.id} aviso={aviso} semSessao={semSessao} />
        </div>
      )}
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
      className={`pos-btn w-full !min-h-[3.25rem] ${
        aConfirmar ? 'pos-btn--ok' : '!bg-emerald-400/10 !text-emerald-300 !shadow-[inset_0_0_0_1px_rgba(52,211,153,0.4)]'
      }`}
    >
      <PosIcon name="check" size={20} strokeWidth={2.6} />
      {aEnviar ? 'A registar…' : aConfirmar ? 'Tocar outra vez para confirmar' : 'Servido'}
    </button>
  );
}
