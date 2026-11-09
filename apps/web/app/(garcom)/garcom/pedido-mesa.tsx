'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatMT, type Cents } from '@delivery/core';

import { PosIcon } from '@/app/(pos)/pos/pos-icons';
import { enviarAcao, lerCardapio, SemSessao } from '@/lib/garcom/client';
import type { LaunchResult, WaiterTable } from '@/lib/garcom/contract';
import {
  buildSellable,
  falhaDeEnvio,
  itensDoEnvio,
  lerRascunho,
  MAX_PESSOA,
  naPessoa,
  needsItemSheet,
  nomeDePessoa,
  novoRascunho,
  porPessoa,
  pratosDe,
  rascunhoKey,
  renomearPessoa,
  tirarPessoa,
  type Rascunho,
} from '@/lib/garcom/pedido';
import {
  cartCount,
  cartLines,
  cartTotalCents,
  changeQty,
  defaultVariant,
  qtyOfItem,
  type CartLine,
  type PosVariant,
} from '@/lib/pos/cart';
import { posItemAvailability, type PosMenuItem } from '@/lib/pos/offline-store';
import { noteHasChip, toggleNoteChip } from '@/lib/pos/notes';
import { tableName, tableNote } from '@/lib/pos/tables';

import { CAMPO, Contador, Folha, Nota, Topo } from './ui';

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
        !rascunho.notes &&
        rascunho.pessoas.length === 0;
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
  const [toque, setToque] = useState<{ texto: string; n: number } | null>(null);
  /** A folha de juntar alguém (NOVA) ou de corrigir quem já está. */
  const [aEditarPessoa, setAEditarPessoa] = useState<string | null>(null);

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

  const avisarToque = (texto: string) => setToque((t) => ({ texto, n: (t?.n ?? 0) + 1 }));
  const paraQuem = rascunho.pessoa ? ` · ${rascunho.pessoa}` : '';

  const tocarItem = (item: PosMenuItem) => {
    if (bloqueado || !posItemAvailability(item).sellable) return;
    if (needsItemSheet(item)) {
      setAEscolher(item);
      return;
    }
    const sellable = naPessoa(buildSellable(item, defaultVariant(item), [], null), rascunho.pessoa);
    mudar((r) => ({ ...r, cart: changeQty(r.cart, sellable, 1) }));
    avisarToque(`+1 ${sellable.name}${paraQuem}`);
  };

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col">
      <Topo
        onVoltar={onVoltar}
        sobre="Novo pedido"
        titulo={
          <>
            Mesa <span className="pos-num text-gold">{mesa.number}</span>
          </>
        }
        detalhe={tableName(mesa) ?? 'Toca nos artigos para os juntar'}
      >
        <label className="relative mt-3 block">
          <PosIcon name="search" size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-mute" />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar no cardápio"
            aria-label="Procurar no cardápio"
            className={`${CAMPO} !py-3 !pl-11`}
          />
        </label>
        {!termo && categorias.length > 1 && (
          <nav className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]" aria-label="Categorias">
            {categorias.map((categoria) => {
              const activa = categoria.id === categoriaActual?.id;
              const naCategoria = categoria.items.reduce((n, item) => n + qtyOfItem(rascunho.cart, item.id), 0);
              return (
                <button
                  key={categoria.id}
                  onClick={() => setCategoriaId(categoria.id)}
                  aria-pressed={activa}
                  className={`pos-press flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold ${
                    activa ? 'bg-gold text-[var(--pos-on-accent)]' : 'bg-white/[0.06] text-ink-dim'
                  }`}
                >
                  {categoria.name}
                  {naCategoria > 0 && (
                    <span
                      className={`pos-num grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-extrabold ${
                        activa ? 'bg-black/20' : 'bg-gold text-[var(--pos-on-accent)]'
                      }`}
                    >
                      {naCategoria}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        )}
      </Topo>

      <section className="flex-1 space-y-3 px-4 pb-48 pt-4">
        {!lojaAberta && <Nota tom="warn">A loja não está a receber pedidos de mesa agora. O pedido fica guardado aqui até abrir.</Nota>}
        {bloqueado && (
          <Nota tom="warn">O último envio ficou sem resposta. Abre o pedido e envia outra vez antes de mudar alguma coisa.</Nota>
        )}
        {cardapio.isLoading && (
          <ul className="grid grid-cols-2 gap-2.5" aria-hidden>
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="h-48 animate-pulse rounded-2xl bg-white/[0.04]" />
            ))}
          </ul>
        )}
        {cardapio.error && !(cardapio.error instanceof SemSessao) && (
          <div className="space-y-3 py-6 text-center">
            <p className="text-ink-dim">{(cardapio.error as Error).message}</p>
            <button className="pos-btn pos-btn--primary" onClick={() => void cardapio.refetch()}>
              Tentar outra vez
            </button>
          </div>
        )}
        {cardapio.data && itens.length === 0 && (
          <p className="py-8 text-center text-sm text-ink-mute">{termo ? 'Nada com esse nome.' : 'Sem artigos.'}</p>
        )}
        <ul className="grid grid-cols-2 gap-2.5">
          {itens.map((item) => {
            const disponivel = posItemAvailability(item);
            const noPedido = qtyOfItem(rascunho.cart, item.id);
            return (
              <li key={item.id}>
                <button
                  onClick={() => tocarItem(item)}
                  disabled={!disponivel.sellable || bloqueado}
                  data-in-cart={noPedido > 0 ? 'true' : undefined}
                  className="pos-product h-full w-full"
                >
                  <span className="pos-product__media aspect-[4/3]">
                    {item.photo_url ? (
                      // O otimizador do Next serve a foto à medida do cartão,
                      // em WebP: com dados móveis a lista abre logo.
                      <Image
                        src={item.photo_url}
                        alt=""
                        fill
                        sizes="(max-width: 448px) 50vw, 220px"
                        quality={70}
                        draggable={false}
                        className="object-contain p-2.5 drop-shadow-[0_10px_14px_rgba(0,0,0,.45)]"
                      />
                    ) : (
                      <span className="absolute inset-0 grid place-items-center text-ink-mute opacity-40">
                        <PosIcon name="bag" size={32} strokeWidth={1.5} />
                      </span>
                    )}
                    {disponivel.badge && (
                      <span className="pos-tag pos-tag--danger absolute bottom-2 left-2">{disponivel.badge}</span>
                    )}
                    {noPedido > 0 && <span className="pos-qty absolute right-2 top-2">{noPedido}</span>}
                  </span>
                  <span className="flex flex-1 flex-col justify-between gap-1 p-3">
                    <span className="line-clamp-2 text-[0.9375rem] font-bold leading-snug">{item.name}</span>
                    <span className="pos-num text-sm font-bold text-gold">{precoDoCartao(item)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {toque && (
        <p
          key={toque.n}
          className="pos-pop pointer-events-none fixed inset-x-0 bottom-44 z-30 mx-auto flex w-fit items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-black shadow-[0_12px_30px_-10px_rgba(0,0,0,0.8)]"
        >
          <PosIcon name="check" size={16} strokeWidth={2.8} className="text-emerald-600" />
          {toque.texto}
        </p>
      )}

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-white/[0.07] bg-bg1 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <ParaQuem
          rascunho={rascunho}
          bloqueado={bloqueado}
          onEscolher={(pessoa) => mudar((r) => ({ ...r, pessoa }))}
          onEditar={setAEditarPessoa}
        />
        <button
          onClick={() => setARever(true)}
          disabled={artigos === 0}
          className="pos-btn pos-btn--primary mx-auto flex w-full max-w-md !justify-between !px-5"
        >
          <span className="flex items-center gap-2.5">
            <span className="pos-num grid h-7 min-w-7 place-items-center rounded-full bg-black/20 px-1.5 text-sm">{artigos}</span>
            Ver pedido
          </span>
          <span className="pos-num">{money(total)}</span>
        </button>
      </footer>

      {aEscolher && (
        <EscolherArtigo
          item={aEscolher}
          pessoa={rascunho.pessoa}
          notasRapidas={notasRapidas}
          onFechar={() => setAEscolher(null)}
          onAdicionar={(variant, addonIds, notes, qty) => {
            const sellable = naPessoa(buildSellable(aEscolher, variant, addonIds, notes), rascunho.pessoa);
            mudar((r) => ({ ...r, cart: changeQty(r.cart, sellable, qty) }));
            avisarToque(`+${qty} ${sellable.name}${paraQuem}`);
            setAEscolher(null);
          }}
        />
      )}

      {aEditarPessoa !== null && (
        <PessoaFolha
          nome={aEditarPessoa === NOVA ? null : aEditarPessoa}
          rascunho={rascunho}
          onFechar={() => setAEditarPessoa(null)}
          onJuntar={(nome) => {
            mudar((r) => ({ ...r, pessoas: [...r.pessoas, nome], pessoa: nome }));
            avisarToque(`${nome} na mesa`);
            setAEditarPessoa(null);
          }}
          onRenomear={(de, para) => {
            mudar((r) => renomearPessoa(r, de, para));
            setAEditarPessoa(null);
          }}
          onTirar={(nome) => {
            mudar((r) => tirarPessoa(r, nome));
            setAEditarPessoa(null);
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
  pessoa,
  notasRapidas,
  onFechar,
  onAdicionar,
}: {
  item: PosMenuItem;
  pessoa: string | null;
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
    <Folha onFechar={onFechar} titulo={item.name} subtitulo={`${precoDoCartao(item)}${pessoa ? ` · para ${pessoa}` : ''}`}>
      {variantes.length > 1 && (
        <div className="space-y-2">
          <p className="pos-eyebrow">Qual?</p>
          <div className="grid grid-cols-2 gap-2">
            {variantes.map((v) => (
              <button
                key={v.id}
                onClick={() => setVariante(v)}
                aria-pressed={variante?.id === v.id}
                className="pos-choice !min-h-[3.75rem] !flex-col !items-start !gap-0.5 !px-3.5 text-left"
              >
                <span className="font-bold">{v.name}</span>
                <span className="pos-num text-sm opacity-80">{money(v.price_cents)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {extras.length > 0 && (
        <div className="space-y-2">
          <p className="pos-eyebrow">Extras</p>
          <div className="grid grid-cols-2 gap-2">
            {extras.map((extra) => {
              const ligado = escolhidos.includes(extra.id);
              return (
                <button
                  key={extra.id}
                  aria-pressed={ligado}
                  onClick={() =>
                    setEscolhidos((atual) => (ligado ? atual.filter((id) => id !== extra.id) : [...atual, extra.id]))
                  }
                  className="pos-choice !min-h-[3.75rem] !justify-start !gap-2.5 !px-3 text-left"
                >
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg ${
                      ligado ? 'bg-black/20' : 'shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.2)]'
                    }`}
                  >
                    <PosIcon name={ligado ? 'check' : 'plus'} size={14} strokeWidth={2.8} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-bold">{extra.name}</span>
                    <span className="pos-num block text-xs opacity-80">+{money(extra.price_cents)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <label className="block space-y-2">
        <span className="pos-eyebrow">Nota para a cozinha</span>
        <input
          value={nota}
          maxLength={140}
          onChange={(e) => setNota(e.target.value)}
          placeholder="ex.: sem cebola, bem passado"
          className={CAMPO}
        />
        {notasRapidas.length > 0 && (
          <span className="flex flex-wrap gap-2 pt-1">
            {notasRapidas.map((atalho) => {
              const ligado = noteHasChip(nota, atalho);
              return (
                <button
                  key={atalho}
                  type="button"
                  aria-pressed={ligado}
                  onClick={() => setNota((n) => toggleNoteChip(n, atalho).slice(0, 140))}
                  className={`pos-press rounded-full px-3.5 py-2 text-xs font-bold ${
                    ligado ? 'bg-gold text-[var(--pos-on-accent)]' : 'bg-white/[0.06] text-ink-dim'
                  }`}
                >
                  {atalho}
                </button>
              );
            })}
          </span>
        )}
      </label>

      <div className="flex items-center gap-3 pt-1">
        <Contador qty={qty} onMenos={() => setQty((q) => Math.max(1, q - 1))} onMais={() => setQty((q) => Math.min(99, q + 1))} />
        <button
          onClick={() => onAdicionar(variante, escolhidos, nota, qty)}
          className="pos-btn pos-btn--primary flex-1 !justify-between !px-4"
        >
          Juntar
          <span className="pos-num">{money(linha.price_cents * qty)}</span>
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
      // E de quem é cada prato (1137): a comanda sai arrumada por pessoa.
      items: itensDoEnvio(linhas),
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
    <Folha onFechar={onFechar} titulo={`Pedido da mesa ${mesa.number}`} subtitulo="Confere com o cliente antes de enviar" fechar={!aEnviar}>
      {linhas.length === 0 ? (
        <p className="py-4 text-center text-ink-mute">O pedido está vazio.</p>
      ) : (
        porPessoa(rascunho).map((grupo) => (
          <section key={grupo.pessoa ?? ''} className="space-y-2">
            {rascunho.pessoas.length > 0 && (
              <p className="flex items-center gap-2">
                <Inicial nome={grupo.pessoa} />
                <span className="min-w-0 flex-1 truncate font-extrabold">{grupo.pessoa ?? 'Mesa toda'}</span>
                <span className="pos-num shrink-0 text-sm font-bold text-ink-dim">
                  {money(grupo.linhas.reduce((soma, l) => soma + l.price_cents * l.qty, 0))}
                </span>
              </p>
            )}
            <ul className="pos-well divide-y divide-white/[0.06] overflow-hidden">
              {grupo.linhas.map((linha) => (
                <li key={linha.id} className="flex items-center gap-3 px-3.5 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold leading-snug">{linha.name}</span>
                    {linha.addons && linha.addons.length > 0 && (
                      <span className="block text-xs text-ink-mute">+ {linha.addons.map((a) => a.name).join(' + ')}</span>
                    )}
                    {linha.notes && <span className="block text-xs italic text-amber-200/90">{linha.notes}</span>}
                    <span className="pos-num block text-sm font-semibold text-gold">{money(linha.price_cents * linha.qty)}</span>
                  </span>
                  <Contador qty={linha.qty} disabled={bloqueado} onMenos={() => mexer(linha, -1)} onMais={() => mexer(linha, 1)} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <div className="space-y-2">
        <p className="pos-eyebrow">Cliente (opcional)</p>
        {nomeDaConta ? (
          <p className="pos-well flex items-center gap-2 px-4 py-3 text-sm text-ink-dim">
            <PosIcon name="user" size={15} />
            Conta de <b className="text-ink">{nomeDaConta}</b>
          </p>
        ) : (
          <input
            value={rascunho.customerName}
            disabled={bloqueado}
            maxLength={60}
            onChange={(e) => mudar((r) => ({ ...r, customerName: e.target.value }))}
            placeholder="Nome do cliente"
            className={CAMPO}
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
          placeholder="Telefone do cliente"
          className={CAMPO}
        />
        {tableNote(mesa) ? (
          <p className="pos-well px-4 py-3 text-sm text-ink-dim">
            Cliente: <b className="text-ink">{tableNote(mesa)}</b>
          </p>
        ) : (
          <input
            value={rascunho.tabNote}
            disabled={bloqueado}
            maxLength={120}
            onChange={(e) => mudar((r) => ({ ...r, tabNote: e.target.value }))}
            placeholder="Característica, ex.: camisa azul"
            className={CAMPO}
          />
        )}
        <input
          value={rascunho.notes}
          disabled={bloqueado}
          maxLength={300}
          onChange={(e) => mudar((r) => ({ ...r, notes: e.target.value }))}
          placeholder="Nota do pedido"
          className={CAMPO}
        />
      </div>

      {rascunho.pendente && !aEnviar && (
        <Nota tom="warn">Não sabemos se chegou à cozinha. Envia outra vez: se já tinha chegado, não fica em dobro.</Nota>
      )}
      {erro && <Nota tom="danger">{erro}</Nota>}

      <button
        onClick={enviar}
        disabled={aEnviar || linhas.length === 0 || !lojaAberta}
        className="pos-btn pos-btn--primary pos-btn--lg w-full !justify-between !px-5"
      >
        <span className="flex items-center gap-2">
          <PosIcon name="arrow" size={22} strokeWidth={2.4} />
          {aEnviar ? 'A enviar…' : rascunho.pendente ? 'Enviar outra vez' : 'Enviar à cozinha'}
        </span>
        <span className="pos-num whitespace-nowrap">{money(cartTotalCents(rascunho.cart))}</span>
      </button>
      <p className="text-center text-xs text-ink-mute">Sai na cozinha e no balcão. A mesa paga no fim, no balcão.</p>

      {!aEnviar && (
        <button
          onClick={() => (aDescartar ? onDescartar() : setADescartar(true))}
          className={`pos-btn w-full !min-h-12 text-sm ${aDescartar ? 'pos-btn--danger-solid' : 'pos-btn--quiet'}`}
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

// ─── Para quem (1137) ─────────────────────────────────────────────────────────
/** A chave de "juntar alguém novo" na folha (nenhum nome escrito a tem). */
const NOVA = '\u0000nova';

/** O círculo com a inicial da pessoa; a mesa toda tem o ícone da mesa. */
function Inicial({ nome, activo = false }: { nome: string | null; activo?: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-extrabold ${
        activo ? 'bg-gold text-[var(--pos-on-accent)]' : 'bg-white/[0.08] text-ink-dim'
      }`}
    >
      {nome ? nome.trim().charAt(0).toLocaleUpperCase('pt') : <PosIcon name="table" size={14} />}
    </span>
  );
}

/**
 * A fila "Para: Mesa toda · Ana · Rui · + Pessoa", por cima de "Ver pedido".
 * Tocar escolhe para quem vão os próximos artigos; tocar outra vez em quem já
 * está escolhido abre o nome para corrigir.
 */
function ParaQuem({
  rascunho,
  bloqueado,
  onEscolher,
  onEditar,
}: {
  rascunho: Rascunho;
  bloqueado: boolean;
  onEscolher: (pessoa: string | null) => void;
  onEditar: (pessoa: string) => void;
}) {
  const opcoes: Array<string | null> = [null, ...rascunho.pessoas];
  const fila = useRef<HTMLDivElement>(null);
  // Quem acabou de entrar fica à vista, mesmo com a mesa cheia.
  useEffect(() => {
    fila.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [rascunho.pessoa, rascunho.pessoas.length]);
  return (
    <div className="mx-auto mb-2.5 flex max-w-md items-center gap-2.5">
      <span className="pos-eyebrow shrink-0">Para</span>
      <div
        ref={fila}
        className="-mr-4 flex min-w-0 flex-1 gap-2 overflow-x-auto pr-4 [scrollbar-width:none]"
        role="group"
        aria-label="Para quem é o pedido"
      >
        {opcoes.map((pessoa) => {
          const activo = rascunho.pessoa === pessoa;
          const pratos = pratosDe(rascunho.cart, pessoa);
          return (
            <button
              key={pessoa ?? ''}
              disabled={bloqueado}
              aria-pressed={activo}
              onClick={() => (activo && pessoa ? onEditar(pessoa) : onEscolher(pessoa))}
              className={`pos-press flex h-11 shrink-0 items-center gap-2 rounded-full pl-2 pr-3.5 text-sm font-bold disabled:opacity-50 ${
                activo
                  ? 'bg-[var(--pos-accent-soft)] text-gold shadow-[inset_0_0_0_1.5px_var(--gold)]'
                  : 'bg-white/[0.04] text-ink-dim shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]'
              }`}
            >
              <Inicial nome={pessoa} activo={activo} />
              <span className="max-w-[9rem] truncate">{pessoa ?? 'Mesa toda'}</span>
              {pratos > 0 && <span className="pos-num text-xs opacity-80">{pratos}</span>}
              {activo && pessoa && <PosIcon name="pencil" size={12} className="opacity-70" />}
            </button>
          );
        })}
        <button
          disabled={bloqueado}
          onClick={() => onEditar(NOVA)}
          className="pos-press flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-white/25 px-3.5 text-sm font-bold text-ink-dim disabled:opacity-50"
        >
          <PosIcon name="plus" size={15} strokeWidth={2.6} />
          Pessoa
        </button>
      </div>
    </div>
  );
}

/** Juntar alguém à mesa, ou corrigir/tirar quem já lá está. */
function PessoaFolha({
  nome,
  rascunho,
  onFechar,
  onJuntar,
  onRenomear,
  onTirar,
}: {
  /** Null = juntar alguém novo. */
  nome: string | null;
  rascunho: Rascunho;
  onFechar: () => void;
  onJuntar: (nome: string) => void;
  onRenomear: (de: string, para: string) => void;
  onTirar: (nome: string) => void;
}) {
  const [escrito, setEscrito] = useState(nome ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const pratos = nome ? pratosDe(rascunho.cart, nome) : 0;
  const sugestao = nomeDePessoa('', rascunho.pessoas) ?? 'Pessoa';

  const guardar = () => {
    const final = nomeDePessoa(escrito, rascunho.pessoas, nome ?? undefined);
    if (!final) return setErro('Já há alguém com esse nome nesta mesa.');
    if (nome) onRenomear(nome, final);
    else onJuntar(final);
  };

  return (
    <Folha
      onFechar={onFechar}
      titulo={nome ?? 'Quem está na mesa?'}
      subtitulo={
        nome
          ? pratos > 0
            ? `${pratos} ${pratos === 1 ? 'artigo' : 'artigos'} neste pedido`
            : 'Ainda sem artigos'
          : 'Os próximos artigos ficam em nome desta pessoa'
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          guardar();
        }}
      >
        <label className="block space-y-2">
          <span className="pos-eyebrow">Nome</span>
          <input
            autoFocus
            value={escrito}
            maxLength={MAX_PESSOA}
            enterKeyHint="done"
            onChange={(e) => {
              setEscrito(e.target.value);
              setErro(null);
            }}
            placeholder={nome ? nome : `ex.: Ana, camisa azul. Vazio fica ${sugestao}`}
            className={CAMPO}
          />
        </label>
        {erro && <Nota tom="danger">{erro}</Nota>}
        <button type="submit" className="pos-btn pos-btn--primary pos-btn--lg w-full">
          {nome ? 'Guardar nome' : 'Juntar à mesa'}
        </button>
      </form>
      {nome && (
        <div className="space-y-1.5">
          <button onClick={() => onTirar(nome)} className="pos-btn pos-btn--quiet w-full !min-h-12 text-sm">
            Tirar {nome} da mesa
          </button>
          {pratos > 0 && <p className="text-center text-xs text-ink-mute">Os artigos passam para a mesa toda.</p>}
        </div>
      )}
    </Folha>
  );
}
