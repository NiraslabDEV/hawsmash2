'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';
import { createClient } from '@/utils/supabase/client';
import {
  REMOVE_ITEM_REASONS,
  TABLE_ORDER_STATUS_LABEL,
  fetchTableOverview,
  itemLabel,
  minutesOpen,
  removeTableItem,
  tableErrorMessage,
  tableName,
  tableTotalCents,
  type PosTable,
  type TableOrderItem,
  type TableRef,
} from '@/lib/pos/tables';
import { PosIcon } from './pos-icons';

const mt = (cents: number) => formatMT(cents as Cents);

/** Sem realtime, a aba anda sozinha a este ritmo (CLAUDE §11.3). */
const POLL_MS = 10_000;

/** O artigo que se está a retirar. O `requestId` nasce ao abrir: dois toques em "Retirar" são uma só remoção. */
type Retirada = {
  itemId: string;
  item: TableOrderItem;
  qty: number;
  reason: string | null;
  requestId: string;
};

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-PT', {
    timeZone: 'Africa/Maputo',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * A aba Mesas: cada mesa da loja com a sua conta aberta.
 *
 * O que a mesa pediu pelo QR e o que se lançou ao balcão aparecem juntos, por
 * ordem de chegada. Daqui pede-se mais para a mesa (volta ao cardápio com a
 * mesa escolhida) ou fecha-se a conta (abre o pagamento do POS com o total da
 * mesa). A conta é a do servidor: esta aba só a mostra.
 *
 * Um artigo que a mesa ainda não pagou pode sair da conta (1102): a caixa
 * toca em "Retirar", escolhe quantos e o motivo. O servidor recalcula, repõe o
 * stock e manda "ANULAR" à cozinha.
 */
export function MesasTab({
  deviceId,
  storeId,
  storeName,
  refreshKey,
  onPedir,
  onFecharConta,
}: {
  deviceId: string;
  storeId: string;
  storeName: string;
  /** Muda quando uma conta fecha ou um pedido é lançado: relê já. */
  refreshKey: number;
  onPedir: (mesa: TableRef) => void;
  onFecharConta: (mesa: PosTable) => void;
}) {
  const [supabase] = useState(() => createClient());
  const [tables, setTables] = useState<PosTable[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [retirada, setRetirada] = useState<Retirada | null>(null);
  const [retirando, setRetirando] = useState(false);
  const [retiradaErro, setRetiradaErro] = useState<string | null>(null);
  const [retiradaFeita, setRetiradaFeita] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const overview = await fetchTableOverview(supabase, deviceId);
      setTables(overview.tables);
      setLoadError(null);
    } catch (error) {
      setLoadError(
        `${tableErrorMessage(error instanceof Error ? error.message : undefined)} A lista é da última consulta.`,
      );
    }
  }, [deviceId, supabase]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, refreshKey]);

  // Realtime só dispara o refetch; nunca constrói a conta (§11.3).
  useEffect(() => {
    const channel = supabase
      .channel(`pos-mesas-${storeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `store_id=eq.${storeId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, storeId, supabase]);

  // "Há 25 min" anda sozinho.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const selected = tables?.find((table) => table.id === selectedId) ?? null;

  function abrirRetirada(item: TableOrderItem) {
    if (!item.id) return;
    setRetiradaErro(null);
    setRetiradaFeita(null);
    setRetirada({ itemId: item.id, item, qty: 1, reason: null, requestId: crypto.randomUUID() });
  }

  async function confirmarRetirada() {
    if (!retirada?.reason || retirando) return;
    setRetirando(true);
    setRetiradaErro(null);
    try {
      const result = await removeTableItem(supabase, {
        requestId: retirada.requestId,
        deviceId,
        orderItemId: retirada.itemId,
        qty: retirada.qty,
        reason: retirada.reason,
      });
      setRetiradaFeita(
        `Retirado: ${retirada.qty}× ${itemLabel(retirada.item)} (−${mt(result.removed_cents)}).` +
          (result.order_cancelled ? ' O pedido ficou vazio e saiu da conta.' : ''),
      );
      setRetirada(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : undefined;
      setRetiradaErro(tableErrorMessage(message));
      if (message && /not_found|not_open|already_paid/.test(message)) setRetirada(null);
    } finally {
      setRetirando(false);
      void load();
    }
  }

  if (tables === null) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        {loadError ? (
          <p role="alert" className="pos-note pos-note--warn">{loadError}</p>
        ) : (
          <p className="text-ink-mute">A carregar as mesas…</p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div className="flex min-w-0 flex-col gap-3">
        <div>
          <h2 className="text-xl font-bold">Mesas · {storeName}</h2>
          <p className="text-sm text-ink-mute">
            O que a mesa pede pelo QR e ao balcão fica na mesma conta. Paga-se no fim.
          </p>
        </div>

        {loadError && <p role="alert" className="pos-note pos-note--warn">{loadError}</p>}

        {tables.length === 0 ? (
          <p className="rounded-2xl border border-white/[0.07] bg-bg2 p-4 text-center text-sm text-ink-mute">
            Esta loja ainda não tem mesas. O dono cria-as no painel, em Mesas.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {tables.map((table) => {
              const total = tableTotalCents(table);
              const ocupada = table.orders.length > 0;
              const minutos = minutesOpen(table, now);
              const doQr = table.orders.filter((order) => order.origin === 'qr').length;
              const nome = tableName(table);
              return (
                <li key={table.id}>
                  <button
                    type="button"
                    aria-pressed={selectedId === table.id}
                    onClick={() => {
                      setSelectedId(table.id);
                      setRetirada(null);
                      setRetiradaErro(null);
                      setRetiradaFeita(null);
                    }}
                    className={`flex min-h-32 w-full flex-col items-start justify-between rounded-2xl border p-3 text-left active:bg-white/10 ${
                      selectedId === table.id
                        ? 'border-gold bg-gold/[0.08]'
                        : ocupada
                          ? 'border-gold/40 bg-bg2'
                          : 'border-white/[0.07] bg-bg2'
                    }`}
                  >
                    <span className="flex w-full items-baseline justify-between gap-2">
                      <span className="text-[11px] font-bold tracking-[0.15em] text-ink-dim">MESA</span>
                      {doQr > 0 && (
                        <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-bold tracking-[0.1em] text-gold">
                          QR {doQr}
                        </span>
                      )}
                    </span>
                    <span className={`pos-num text-5xl font-extrabold leading-none ${ocupada ? 'text-gold' : 'text-ink'}`}>
                      {table.number}
                    </span>
                    {/* Em Maputo a mesa a mais é a conta de uma pessoa: o nome
                        é o que a caixa procura (1092). */}
                    {nome && (
                      <span className="block w-full truncate text-base font-bold text-ink">{nome}</span>
                    )}
                    {ocupada ? (
                      <span className="w-full">
                        <span className="pos-num block text-lg font-bold">{mt(total)}</span>
                        <span className="block text-xs text-ink-mute">
                          {table.orders.length} {table.orders.length === 1 ? 'pedido' : 'pedidos'}
                          {minutos !== null ? ` · há ${minutos} min` : ''}
                        </span>
                      </span>
                    ) : (
                      <span className="text-sm text-ink-mute">{table.active ? 'Livre' : 'Desactivada'}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <aside className="flex min-w-0 flex-col gap-3">
        {!selected ? (
          <p className="rounded-2xl border border-white/[0.07] bg-bg2 p-4 text-center text-sm text-ink-mute">
            Toca numa mesa para ver a conta.
          </p>
        ) : (
          <div className="pos-card flex flex-col gap-3 !p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="min-w-0 truncate text-2xl font-extrabold">
                Mesa {selected.number}
                {tableName(selected) ? ` · ${tableName(selected)}` : ''}
              </h3>
              <span className="pos-num text-2xl font-extrabold text-gold">
                {mt(tableTotalCents(selected))}
              </span>
            </div>

            {retiradaFeita && <p role="status" className="pos-note pos-note--ok">{retiradaFeita}</p>}
            {retiradaErro && <p role="alert" className="pos-note pos-note--danger">{retiradaErro}</p>}

            {selected.orders.length === 0 ? (
              <p className="text-sm text-ink-mute">
                Mesa livre. Pede para ela aqui ao balcão, ou o cliente pede pelo QR.
              </p>
            ) : (
              <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
                {selected.orders.map((order) => (
                  <li key={order.id} className="rounded-xl border border-white/[0.07] bg-bg1 p-3">
                    <p className="flex items-baseline justify-between gap-2 text-[11px] font-bold tracking-[0.12em] text-ink-dim">
                      <span>
                        {order.origin === 'qr' ? 'QR' : 'BALCÃO'}
                        {order.daily_number != null ? ` · SENHA ${order.daily_number}` : ''} · {hora(order.created_at)}
                      </span>
                      <span>{(TABLE_ORDER_STATUS_LABEL[order.status] ?? order.status).toUpperCase()}</span>
                    </p>
                    <ul className="mt-2 space-y-1">
                      {order.items.map((item, index) => {
                        const aRetirar = retirada && item.id && retirada.itemId === item.id ? retirada : null;
                        return (
                          <li key={item.id ?? `${order.id}-${index}`} className="text-[0.9375rem] font-medium">
                            <span className="flex items-center justify-between gap-3">
                              <span className="min-w-0">
                                <span className="pos-num font-bold text-gold">{item.qty}×</span> {itemLabel(item)}
                              </span>
                              <span className="flex shrink-0 items-center gap-2">
                                <span className="pos-num text-ink-dim">{mt(item.qty * item.unit_price_cents)}</span>
                                {item.id && !aRetirar && (
                                  <button
                                    type="button"
                                    onClick={() => abrirRetirada(item)}
                                    aria-label={`Retirar ${itemLabel(item)}`}
                                    className="pos-btn pos-btn--danger !min-h-11 !px-3 !py-1 text-sm"
                                  >
                                    <PosIcon name="close" size={16} />
                                    Retirar
                                  </button>
                                )}
                              </span>
                            </span>
                            {(item.notes || item.person) && (
                              <span className="block text-xs text-ink-mute">
                                {[item.person, item.notes].filter(Boolean).join(' · ')}
                              </span>
                            )}
                            {aRetirar && (
                              <div className="mt-2 flex flex-col gap-3 rounded-xl border border-red-400/30 bg-red-400/[0.06] p-3">
                                <p className="text-sm font-bold">Retirar da conta: {itemLabel(item)}</p>
                                {item.qty > 1 && (
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-sm text-ink-mute">Quantos?</span>
                                    <span className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        aria-label="Menos um"
                                        disabled={aRetirar.qty <= 1 || retirando}
                                        onClick={() => setRetirada({ ...aRetirar, qty: aRetirar.qty - 1 })}
                                        className="pos-btn !min-h-11 !px-3"
                                      >
                                        <PosIcon name="minus" size={18} />
                                      </button>
                                      <span className="pos-num w-10 text-center text-xl font-extrabold">
                                        {aRetirar.qty}
                                      </span>
                                      <button
                                        type="button"
                                        aria-label="Mais um"
                                        disabled={aRetirar.qty >= item.qty || retirando}
                                        onClick={() => setRetirada({ ...aRetirar, qty: aRetirar.qty + 1 })}
                                        className="pos-btn !min-h-11 !px-3"
                                      >
                                        <PosIcon name="plus" size={18} />
                                      </button>
                                      <span className="text-sm text-ink-mute">de {item.qty}</span>
                                    </span>
                                  </div>
                                )}
                                <div className="flex flex-wrap gap-2" role="group" aria-label="Motivo">
                                  {REMOVE_ITEM_REASONS.map((reason) => (
                                    <button
                                      key={reason}
                                      type="button"
                                      aria-pressed={aRetirar.reason === reason}
                                      disabled={retirando}
                                      onClick={() => setRetirada({ ...aRetirar, reason })}
                                      className={`pos-btn !min-h-11 !px-3 text-sm ${
                                        aRetirar.reason === reason ? 'pos-btn--accent-outline' : 'pos-btn--quiet'
                                      }`}
                                    >
                                      {reason}
                                    </button>
                                  ))}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <button
                                    type="button"
                                    disabled={retirando}
                                    onClick={() => {
                                      setRetirada(null);
                                      setRetiradaErro(null);
                                    }}
                                    className="pos-btn"
                                  >
                                    Voltar
                                  </button>
                                  <button
                                    type="button"
                                    disabled={!aRetirar.reason || retirando}
                                    onClick={() => void confirmarRetirada()}
                                    className="pos-btn pos-btn--danger-solid"
                                  >
                                    {retirando ? 'A retirar…' : `Retirar −${mt(aRetirar.qty * item.unit_price_cents)}`}
                                  </button>
                                </div>
                                {!aRetirar.reason && (
                                  <p className="text-xs text-ink-mute">Escolhe o motivo — fica registado.</p>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {order.notes && <p className="mt-2 text-xs text-ink-mute">Nota: {order.notes}</p>}
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              disabled={!selected.active}
              onClick={() =>
                onPedir({ id: selected.id, number: selected.number, name: tableName(selected) })
              }
              className="pos-btn w-full"
            >
              <PosIcon name="plus" size={20} />
              Pedir para a mesa {selected.number}
            </button>
            <button
              type="button"
              disabled={selected.orders.length === 0}
              onClick={() => onFecharConta(selected)}
              className="pos-btn pos-btn--primary pos-btn--lg w-full !justify-between"
            >
              <span>FECHAR CONTA</span>
              <span className="pos-num">{mt(tableTotalCents(selected))}</span>
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
