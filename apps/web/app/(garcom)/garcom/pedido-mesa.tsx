'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatMT, type Cents } from '@delivery/core';

import { enviarAcao, lerCardapio, SemSessao } from '@/lib/garcom/client';
import type { LaunchResult, WaiterTable } from '@/lib/garcom/contract';
import {
  buildSellable,
  falhaDeEnvio,
  lerRascunho,
  needsItemSheet,
  novoRascunho,
  rascunhoKey,
  type Rascunho,
} from '@/lib/garcom/pedido';
import {
  cartCount,
  cartLines,
  cartTotalCents,
  changeQty,
  defaultVariant,
  qtyOfItem,
  salePayloadItems,
  type CartLine,
  type PosVariant,
} from '@/lib/pos/cart';
import { posItemAvailability, type PosMenuItem } from '@/lib/pos/offline-store';
import { noteHasChip, toggleNoteChip } from '@/lib/pos/notes';
import { tableName, tableNote } from '@/lib/pos/tables';

const money = (c: number) => formatMT(c as Cents);

/** O preço que aparece no cartão: o da variante única, ou "desde" o mais barato. */
function precoDoCartao(item: PosMenuItem): string {
  const variantes = item.variants ?? [];
  if (variantes.length === 0) return money(item.price_cents);
  if (variantes.length === 1) return money(variantes[0].price_cents);
  return `desde ${money(Math.min(...variantes.map((v) => v.price_cents)))}`;
}

/**
 * O rascunho desta mesa, guardado no telemóvel a cada toque: recarregar a
 * página, bloquear o ecrã ou perder a rede não deita o pedido fora.
 */
function useRascunho(tableId: string) {
  const [rascunho, setRascunho] = useState<Rascunho>(() => {
    const agora = Date.now();
    try {
      const guardado = lerRascunho(window.localStorage.getItem(rascunhoKey(tableId)), tableId, agora);
      if (guardado) return guardado;
    } catch {
      // Sem localStorage (modo privado): o rascunho vive só na memória.
    }
    return novoRascunho(tableId, crypto.randomUUID(), agora);
  });

  useEffect(() => {
    try {
      const vazio =
        cartCount(rascunho.cart) === 0 &&
        !rascunho.pendente &&
        !rascunho.customerName &&
        !rascunho.customerPhone &&
        !rascunho.tabNote &&
        !rascunho.notes;
      if (vazio) window.localStorage.removeItem(rascunhoKey(tableId));
      else window.localStorage.setItem(rascunhoKey(tableId), JSON.stringify(rascunho));
    } catch {
      // idem
    }
  }, [rascunho, tableId]);

  const mudar = (fn: (r: Rascunho) => Rascunho) => setRascunho((r) => ({ ...fn(r), updatedAt: Date.now() }));
  /** Depois de a cozinha o ter: rascunho limpo e chave nova para o próximo. */
  const recomecar = () => setRascunho(novoRascunho(tableId, crypto.randomUUID(), Date.now()));
  return { rascunho, mudar, recomecar };
}

export function PedidoMesa({
  mesa,
  lojaAberta,
  notasRapidas,
  onVoltar,
  onEnviado,
  onSemSessao,
}: {
  mesa: WaiterTable;
  lojaAberta: boolean;
  /** As notas rápidas da loja (aba POS): as mesmas do balcão. */
  notasRapidas: readonly string[];
  onVoltar: () => void;
  onEnviado: (r: LaunchResult) => void;
  onSemSessao: () => void;
}) {
  const cardapio = useQuery({
    queryKey: ['garcom-cardapio'],
    queryFn: lerCardapio,
    staleTime: 30_000,
    // Um esgotado marcado no balcão desaparece daqui sem recarregar.
    refetchInterval: 60_000,
    retry: (n, err) => !(err instanceof SemSessao) && n < 2,
  });
  useEffect(() => {
    if (cardapio.error instanceof SemSessao) onSemSessao();
  }, [cardapio.error, onSemSessao]);

  const { rascunho, mudar, recomecar } = useRascunho(mesa.id);
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [aEscolher, setAEscolher] = useState<PosMenuItem | null>(null);
  const [aRever, setARever] = useState(false);
  const [toque, setToque] = useState<string | null>(null);

  const categorias = useMemo(
    () => (cardapio.data?.categories ?? []).filter((categoria) => categoria.items.length > 0),
    [cardapio.data],
  );
  const categoriaActual = categorias.find((c) => c.id === categoriaId) ?? categorias[0] ?? null;
  const termo = busca.trim().toLowerCase();
  const itens = termo
    ? categorias.flatMap((c) => c.items).filter((item) => item.name.toLowerCase().includes(termo))
    : (categoriaActual?.items ?? []);

  const artigos = cartCount(rascunho.cart);
  const total = cartTotalCents(rascunho.cart);
  const bloqueado = rascunho.pendente;

  useEffect(() => {
    if (!toque) return;
    const t = setTimeout(() => setToque(null), 1200);
    return () => clearTimeout(t);
  }, [toque]);

  const tocarItem = (item: PosMenuItem) => {
    if (bloqueado || !posItemAvailability(item).sellable) return;
    if (needsItemSheet(item)) {
      setAEscolher(item);
      return;
    }
    const sellable = buildSellable(item, defaultVariant(item), [], null);
    mudar((r) => ({ ...r, cart: changeQty(r.cart, sellable, 1) }));
    setToque(`+1 ${sellable.name}`);
  };

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col">
      <header className="sticky top-0 z-20 space-y-3 border-b border-white/10 bg-[var(--bg-0)]/95 px-4 pb-3 pt-4 backdrop-blur">
        <div className="flex items-center gap-3">
          <button
            onClick={onVoltar}
            aria-label="Voltar à mesa"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/10 text-xl"
          >
            ←
          </button>
          <div className="min-w-0">
            <h1 className="font-[family-name:var(--font-display)] text-2xl leading-none tracking-wide text-[var(--gold)]">
              Mesa {mesa.number} · Novo pedido
            </h1>
            <p className="truncate text-xs text-[var(--ink-dim)]">{tableName(mesa) ?? 'Toca nos artigos para os juntar'}</p>
          </div>
        </div>
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Procurar no cardápio"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 outline-none focus:border-[var(--gold)]"
        />
        {!termo && categorias.length > 1 && (
          <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {categorias.map((categoria) => (
              <button
                key={categoria.id}
                onClick={() => setCategoriaId(categoria.id)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${
                  categoria.id === categoriaActual?.id ? 'bg-[var(--gold)] text-black' : 'border border-white/10 text-[var(--ink-dim)]'
                }`}
              >
                {categoria.name}
              </button>
            ))}
          </nav>
        )}
      </header>

      <section className="flex-1 space-y-2 px-4 pb-32 pt-3">
        {!lojaAberta && (
          <p className="rounded-xl bg-amber-500/15 px-4 py-3 text-sm text-amber-200">
            A loja não está a receber pedidos de mesa agora. O pedido fica guardado aqui até abrir.
          </p>
        )}
        {bloqueado && (
          <p className="rounded-xl bg-amber-500/15 px-4 py-3 text-sm text-amber-200">
            O último envio ficou sem resposta. Abre o pedido e envia outra vez antes de mudar alguma coisa.
          </p>
        )}
        {cardapio.isLoading && <p className="py-8 text-center text-[var(--ink-dim)]">A carregar o cardápio…</p>}
        {cardapio.error && !(cardapio.error instanceof SemSessao) && (
          <div className="space-y-3 py-6 text-center">
            <p className="text-[var(--ink-dim)]">{(cardapio.error as Error).message}</p>
            <button className="rounded-xl bg-[var(--gold)] px-5 py-3 font-semibold text-black" onClick={() => void cardapio.refetch()}>
              Tentar outra vez
            </button>
          </div>
        )}
        {cardapio.data && itens.length === 0 && (
          <p className="py-8 text-center text-sm text-[var(--ink-dim)]">{termo ? 'Nada com esse nome.' : 'Sem artigos.'}</p>
        )}
        <ul className="space-y-2">
          {itens.map((item) => {
            const disponivel = posItemAvailability(item);
            const noPedido = qtyOfItem(rascunho.cart, item.id);
            return (
              <li key={item.id}>
                <button
                  onClick={() => tocarItem(item)}
                  disabled={!disponivel.sellable || bloqueado}
                  className={`flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left disabled:opacity-50 ${
                    noPedido > 0 ? 'border-[var(--gold)]/60 bg-[var(--gold)]/10' : 'border-white/10 bg-white/[0.03]'
                  }`}
                >
                  {item.photo_url ? (
                    // A foto do cardápio é a original (centenas de KB); no
                    // telemóvel com dados móveis a lista ficava a carregar.
                    // O otimizador do Next serve-a a 56 px, em WebP.
                    <Image
                      src={item.photo_url}
                      alt=""
                      width={56}
                      height={56}
                      sizes="56px"
                      quality={60}
                      className="h-14 w-14 shrink-0 rounded-xl object-cover"
                    />
                  ) : (
                    <span className="h-14 w-14 shrink-0 rounded-xl bg-white/5" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{item.name}</span>
                    <span className="block text-sm text-[var(--ink-dim)]">
                      {precoDoCartao(item)}
                      {disponivel.badge && <span className="ml-2 text-xs text-amber-300">{disponivel.badge}</span>}
                    </span>
                  </span>
                  {noPedido > 0 && (
                    <span className="grid h-8 min-w-8 place-items-center rounded-full bg-[var(--gold)] px-2 text-sm font-bold text-black">
                      {noPedido}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {toque && (
        <p className="pointer-events-none fixed inset-x-0 bottom-24 z-30 mx-auto w-fit rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-black shadow-xl">
          {toque}
        </p>
      )}

      <footer className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md border-t border-white/10 bg-[var(--bg-0)]/95 p-3 backdrop-blur">
        <button
          onClick={() => setARever(true)}
          disabled={artigos === 0}
          className="flex w-full items-center justify-between rounded-2xl bg-[var(--gold)] px-5 py-4 text-lg font-bold text-black disabled:opacity-40"
        >
          <span>Ver pedido{artigos > 0 ? ` (${artigos})` : ''}</span>
          <span>{money(total)}</span>
        </button>
      </footer>

      {aEscolher && (
        <EscolherArtigo
          item={aEscolher}
          notasRapidas={notasRapidas}
          onFechar={() => setAEscolher(null)}
          onAdicionar={(variant, addonIds, notes, qty) => {
            const sellable = buildSellable(aEscolher, variant, addonIds, notes);
            mudar((r) => ({ ...r, cart: changeQty(r.cart, sellable, qty) }));
            setToque(`+${qty} ${sellable.name}`);
            setAEscolher(null);
          }}
        />
      )}

      {aRever && (
        <Revisao
          mesa={mesa}
          rascunho={rascunho}
          mudar={mudar}
          lojaAberta={lojaAberta}
          onFechar={() => setARever(false)}
          onDescartar={() => {
            recomecar();
            setARever(false);
          }}
          onEnviado={(r) => {
            recomecar();
            setARever(false);
            onEnviado(r);
          }}
          onSemSessao={onSemSessao}
          onRecusado={() => void cardapio.refetch()}
        />
      )}
    </main>
  );
}

// ─── Escolher variante, extras e nota ─────────────────────────────────────────
function EscolherArtigo({
  item,
  notasRapidas,
  onFechar,
  onAdicionar,
}: {
  item: PosMenuItem;
  notasRapidas: readonly string[];
  onFechar: () => void;
  onAdicionar: (variant: PosVariant | null, addonIds: string[], notes: string | null, qty: number) => void;
}) {
  const variantes = item.variants ?? [];
  const extras = item.addons ?? [];
  const [variante, setVariante] = useState<PosVariant | null>(() => defaultVariant(item));
  const [escolhidos, setEscolhidos] = useState<string[]>([]);
  const [nota, setNota] = useState('');
  const [qty, setQty] = useState(1);

  const linha = buildSellable(item, variante, escolhidos, nota);

  return (
    <Folha onFechar={onFechar} titulo={item.name}>
      {variantes.length > 1 && (
        <div className="space-y-2">
          <p className="text-sm text-[var(--ink-dim)]">Qual?</p>
          <div className="grid grid-cols-2 gap-2">
            {variantes.map((v) => (
              <button
                key={v.id}
                onClick={() => setVariante(v)}
                className={`rounded-xl border px-3 py-3 text-left ${
                  variante?.id === v.id ? 'border-[var(--gold)] bg-[var(--gold)]/15' : 'border-white/10'
                }`}
              >
                <span className="block font-semibold">{v.name}</span>
                <span className="text-sm text-[var(--ink-dim)]">{money(v.price_cents)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {extras.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-[var(--ink-dim)]">Extras</p>
          <div className="grid grid-cols-2 gap-2">
            {extras.map((extra) => {
              const ligado = escolhidos.includes(extra.id);
              return (
                <button
                  key={extra.id}
                  onClick={() =>
                    setEscolhidos((atual) => (ligado ? atual.filter((id) => id !== extra.id) : [...atual, extra.id]))
                  }
                  className={`rounded-xl border px-3 py-3 text-left ${
                    ligado ? 'border-[var(--gold)] bg-[var(--gold)]/15' : 'border-white/10'
                  }`}
                >
                  <span className="block font-semibold">{ligado ? '✓ ' : '+ '}{extra.name}</span>
                  <span className="text-sm text-[var(--ink-dim)]">{money(extra.price_cents)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <label className="block space-y-2">
        <span className="text-sm text-[var(--ink-dim)]">Nota para a cozinha</span>
        <input
          value={nota}
          maxLength={140}
          onChange={(e) => setNota(e.target.value)}
          placeholder="ex.: sem cebola, bem passado"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-[var(--gold)]"
        />
        {notasRapidas.length > 0 && (
          <span className="flex flex-wrap gap-2 pt-1">
            {notasRapidas.map((atalho) => (
              <button
                key={atalho}
                type="button"
                onClick={() => setNota((n) => toggleNoteChip(n, atalho).slice(0, 140))}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  noteHasChip(nota, atalho)
                    ? 'border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold)]'
                    : 'border-white/10 text-[var(--ink-dim)]'
                }`}
              >
                {atalho}
              </button>
            ))}
          </span>
        )}
      </label>

      <div className="flex items-center justify-between gap-3">
        <Contador qty={qty} onMenos={() => setQty((q) => Math.max(1, q - 1))} onMais={() => setQty((q) => Math.min(99, q + 1))} />
        <button
          onClick={() => onAdicionar(variante, escolhidos, nota, qty)}
          className="flex-1 rounded-2xl bg-[var(--gold)] py-4 text-lg font-bold text-black"
        >
          Juntar · {money(linha.price_cents * qty)}
        </button>
      </div>
    </Folha>
  );
}

// ─── Rever e enviar ───────────────────────────────────────────────────────────
function Revisao({
  mesa,
  rascunho,
  mudar,
  lojaAberta,
  onFechar,
  onDescartar,
  onEnviado,
  onSemSessao,
  onRecusado,
}: {
  mesa: WaiterTable;
  rascunho: Rascunho;
  mudar: (fn: (r: Rascunho) => Rascunho) => void;
  lojaAberta: boolean;
  onFechar: () => void;
  onDescartar: () => void;
  onEnviado: (r: LaunchResult) => void;
  onSemSessao: () => void;
  onRecusado: () => void;
}) {
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aDescartar, setADescartar] = useState(false);
  const linhas = cartLines(rascunho.cart);
  const nomeDaConta = tableName(mesa);
  const bloqueado = rascunho.pendente || aEnviar;

  useEffect(() => {
    if (!aDescartar) return;
    const t = setTimeout(() => setADescartar(false), 4000);
    return () => clearTimeout(t);
  }, [aDescartar]);

  const mexer = (linha: CartLine, delta: number) => {
    if (bloqueado) return;
    mudar((r) => ({ ...r, cart: changeQty(r.cart, linha, delta) }));
  };

  const enviar = async () => {
    if (linhas.length === 0 || aEnviar) return;
    setErro(null);
    setAEnviar(true);
    // Marca-se antes de sair: se o telemóvel bloquear a meio, o rascunho já
    // diz que este envio pode ter chegado.
    mudar((r) => ({ ...r, pendente: true }));
    const r = await enviarAcao<LaunchResult>({
      action: 'launch',
      clientSaleId: rascunho.clientSaleId,
      tableId: mesa.id,
      // Os mesmos ids e quantidades que o balcão manda — nunca o preço (Regra 2).
      items: salePayloadItems(linhas),
      ...(rascunho.customerName.trim() ? { customerName: rascunho.customerName.trim() } : {}),
      ...(rascunho.customerPhone.trim() ? { customerPhone: rascunho.customerPhone.trim() } : {}),
      ...(rascunho.tabNote.trim() ? { tabNote: rascunho.tabNote.trim() } : {}),
      ...(rascunho.notes.trim() ? { notes: rascunho.notes.trim() } : {}),
    });
    setAEnviar(false);
    if (r.ok && r.data) {
      onEnviado(r.data);
      return;
    }
    const tipo = falhaDeEnvio(r.status);
    mudar((atual) => ({ ...atual, pendente: tipo === 'incerto' }));
    if (r.status === 401) {
      onSemSessao();
      return;
    }
    setErro(r.error ?? 'Não foi possível enviar.');
    if (tipo === 'recusado') onRecusado();
  };

  return (
    <Folha onFechar={onFechar} titulo={`Mesa ${mesa.number}`} fechar={!aEnviar}>
      {linhas.length === 0 ? (
        <p className="py-4 text-center text-[var(--ink-dim)]">O pedido está vazio.</p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-2xl border border-white/10">
          {linhas.map((linha) => (
            <li key={linha.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{linha.name}</span>
                {linha.addons && linha.addons.length > 0 && (
                  <span className="block text-xs text-[var(--ink-dim)]">+ {linha.addons.map((a) => a.name).join(' + ')}</span>
                )}
                {linha.notes && <span className="block text-xs italic text-amber-200">{linha.notes}</span>}
                <span className="block text-sm text-[var(--ink-dim)]">{money(linha.price_cents * linha.qty)}</span>
              </span>
              <Contador
                qty={linha.qty}
                disabled={bloqueado}
                onMenos={() => mexer(linha, -1)}
                onMais={() => mexer(linha, 1)}
              />
            </li>
          ))}
        </ul>
      )}

      {nomeDaConta ? (
        <p className="text-sm text-[var(--ink-dim)]">
          Conta de <b className="text-[var(--ink)]">{nomeDaConta}</b>
        </p>
      ) : (
        <input
          value={rascunho.customerName}
          disabled={bloqueado}
          maxLength={60}
          onChange={(e) => mudar((r) => ({ ...r, customerName: e.target.value }))}
          placeholder="Nome do cliente (opcional)"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-[var(--gold)] disabled:opacity-60"
        />
      )}
      <input
        value={rascunho.customerPhone}
        disabled={bloqueado}
        type="tel"
        inputMode="tel"
        autoComplete="off"
        maxLength={20}
        onChange={(e) => mudar((r) => ({ ...r, customerPhone: e.target.value }))}
        placeholder="Telefone do cliente (opcional)"
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-[var(--gold)] disabled:opacity-60"
      />
      {tableNote(mesa) ? (
        <p className="text-sm text-[var(--ink-dim)]">
          Cliente: <b className="text-[var(--ink)]">{tableNote(mesa)}</b>
        </p>
      ) : (
        <input
          value={rascunho.tabNote}
          disabled={bloqueado}
          maxLength={120}
          onChange={(e) => mudar((r) => ({ ...r, tabNote: e.target.value }))}
          placeholder="Característica do cliente, ex.: camisa azul (opcional)"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-[var(--gold)] disabled:opacity-60"
        />
      )}
      <input
        value={rascunho.notes}
        disabled={bloqueado}
        maxLength={300}
        onChange={(e) => mudar((r) => ({ ...r, notes: e.target.value }))}
        placeholder="Nota do pedido (opcional)"
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-[var(--gold)] disabled:opacity-60"
      />

      {rascunho.pendente && !aEnviar && (
        <p className="rounded-xl bg-amber-500/15 px-4 py-3 text-sm text-amber-200">
          Não sabemos se chegou à cozinha. Envia outra vez: se já tinha chegado, não fica em dobro.
        </p>
      )}
      {erro && <p className="rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300">{erro}</p>}

      <div className="flex items-baseline justify-between">
        <span className="text-[var(--ink-dim)]">Total</span>
        <span className="text-2xl font-bold text-[var(--gold)]">{money(cartTotalCents(rascunho.cart))}</span>
      </div>

      <button
        onClick={enviar}
        disabled={aEnviar || linhas.length === 0 || !lojaAberta}
        className="w-full rounded-2xl bg-[var(--gold)] py-5 text-lg font-bold text-black disabled:opacity-50"
      >
        {aEnviar ? 'A enviar…' : rascunho.pendente ? 'Enviar outra vez' : 'Enviar para a cozinha'}
      </button>
      <p className="text-center text-xs text-[var(--ink-mute)]">Sai na cozinha e no balcão. A mesa paga no fim, no balcão.</p>

      {!aEnviar && (
        <button
          onClick={() => (aDescartar ? onDescartar() : setADescartar(true))}
          className={`w-full rounded-xl py-3 text-sm ${aDescartar ? 'bg-red-500 font-bold text-white' : 'text-[var(--ink-mute)]'}`}
        >
          {aDescartar
            ? rascunho.pendente
              ? 'Tocar outra vez: apagar (se já chegou à cozinha, fica lá)'
              : 'Tocar outra vez para apagar o pedido'
            : 'Apagar este pedido'}
        </button>
      )}
    </Folha>
  );
}

// ─── Peças ────────────────────────────────────────────────────────────────────
export function Folha({
  titulo,
  onFechar,
  fechar = true,
  children,
}: {
  titulo: string;
  onFechar: () => void;
  fechar?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70" onClick={() => fechar && onFechar()}>
      <div
        className="max-h-[92dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-3xl border-t border-white/10 bg-[var(--bg-1)] p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">{titulo}</h2>
          {fechar && (
            <button onClick={onFechar} aria-label="Fechar" className="grid h-10 w-10 place-items-center rounded-xl border border-white/10">
              ✕
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Contador({
  qty,
  onMenos,
  onMais,
  disabled = false,
}: {
  qty: number;
  onMenos: () => void;
  onMais: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        onClick={onMenos}
        disabled={disabled}
        aria-label="Menos um"
        className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 text-xl disabled:opacity-40"
      >
        −
      </button>
      <span className="w-8 text-center text-lg font-bold">{qty}</span>
      <button
        onClick={onMais}
        disabled={disabled}
        aria-label="Mais um"
        className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 text-xl disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
