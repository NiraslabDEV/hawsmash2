'use client';

import { useEffect, useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';

import { enviarAcao } from '@/lib/garcom/client';
import type { CloseResult, WaiterState, WaiterTable } from '@/lib/garcom/contract';
import { meiosDeCobrar } from '@/lib/garcom/pedido';
import { billLines, itemLabel, REMOVE_ITEM_REASONS, tableTotalCents, type TableOrderItem } from '@/lib/pos/tables';

import { Contador, Folha } from './pedido-mesa';

const money = (c: number) => formatMT(c as Cents);

type Aviso = { tipo: 'ok' | 'erro'; texto: string };

/** Dois toques para confirmar: nada de confirm() do browser em fluxo de venda (§7). */
function useDoisToques(ms = 4000) {
  const [armado, setArmado] = useState(false);
  useEffect(() => {
    if (!armado) return;
    const t = setTimeout(() => setArmado(false), ms);
    return () => clearTimeout(t);
  }, [armado, ms]);
  return { armado, armar: () => setArmado(true), desarmar: () => setArmado(false) };
}

const BOTAO_LINHA = 'rounded-xl border border-white/15 py-3 text-sm font-semibold disabled:opacity-50';

/** O que se faz à conta da mesa: pedir a conta, mudar de mesa e, com autorização, cobrar. */
export function BotoesDaMesa({
  mesa,
  estado,
  aviso,
  recarregar,
  semSessao,
  aoFechar,
}: {
  mesa: WaiterTable;
  estado: WaiterState;
  aviso: (a: Aviso) => void;
  recarregar: () => void;
  semSessao: () => void;
  aoFechar: () => void;
}) {
  const [folha, setFolha] = useState<'conta' | 'mudar' | 'cobrar' | null>(null);
  const meios = meiosDeCobrar(estado.pos_config);
  const podeCobrar = estado.waiter.can_charge && meios.length > 0;
  const fechar = () => setFolha(null);

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <button className={BOTAO_LINHA} onClick={() => setFolha('conta')}>
          Pedir a conta
        </button>
        <button className={BOTAO_LINHA} onClick={() => setFolha('mudar')}>
          Mudar de mesa
        </button>
      </div>
      {podeCobrar && (
        <button
          className="w-full rounded-2xl bg-emerald-500 py-4 text-lg font-bold text-black"
          onClick={() => setFolha('cobrar')}
        >
          Cobrar {money(tableTotalCents(mesa))}
        </button>
      )}

      {folha === 'conta' && (
        <PedirConta mesa={mesa} aviso={aviso} semSessao={semSessao} onFechar={fechar} />
      )}
      {folha === 'mudar' && (
        <MudarMesa
          mesa={mesa}
          mesas={estado.tables}
          aviso={aviso}
          recarregar={recarregar}
          semSessao={semSessao}
          onFechar={fechar}
          aoMudar={aoFechar}
        />
      )}
      {folha === 'cobrar' && (
        <Cobrar
          mesa={mesa}
          meios={meios}
          aviso={aviso}
          recarregar={recarregar}
          semSessao={semSessao}
          onFechar={fechar}
          aoCobrar={aoFechar}
        />
      )}
    </>
  );
}

/** A conta para ler ao cliente: o mesmo artigo de vários pedidos numa linha só. */
function LinhasDaConta({ mesa }: { mesa: WaiterTable }) {
  return (
    <>
      <ul className="divide-y divide-white/5 rounded-2xl border border-white/10">
        {billLines(mesa).map((linha) => (
          <li key={linha.key} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0">
              <b className="text-[var(--gold)]">{linha.qty}×</b> {linha.label}
              {linha.notes && <span className="block text-xs italic text-[var(--ink-dim)]">{linha.notes}</span>}
            </span>
            <span className="shrink-0">{money(linha.totalCents)}</span>
          </li>
        ))}
      </ul>
      <p className="flex items-baseline justify-between">
        <span className="text-[var(--ink-dim)]">Total da mesa</span>
        <b className="text-2xl text-[var(--gold)]">{money(tableTotalCents(mesa))}</b>
      </p>
    </>
  );
}

function PedirConta({
  mesa,
  aviso,
  semSessao,
  onFechar,
}: {
  mesa: WaiterTable;
  aviso: (a: Aviso) => void;
  semSessao: () => void;
  onFechar: () => void;
}) {
  // Uma chave por abertura: dois toques imprimem um papel (Regra 4).
  const [requestId] = useState(() => crypto.randomUUID());
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const imprimir = async () => {
    setErro(null);
    setAEnviar(true);
    const r = await enviarAcao({ action: 'request_bill', requestId, tableId: mesa.id });
    setAEnviar(false);
    if (r.status === 401) return semSessao();
    if (!r.ok) return setErro(r.error ?? 'Não foi possível.');
    aviso({ tipo: 'ok', texto: `Conta da mesa ${mesa.number} a sair no balcão` });
    onFechar();
  };

  return (
    <Folha titulo={`Conta · Mesa ${mesa.number}`} onFechar={onFechar}>
      <LinhasDaConta mesa={mesa} />
      {erro && <p className="rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300">{erro}</p>}
      <button
        onClick={imprimir}
        disabled={aEnviar}
        className="w-full rounded-2xl bg-[var(--gold)] py-4 text-lg font-bold text-black disabled:opacity-60"
      >
        {aEnviar ? 'A enviar…' : 'Imprimir no balcão'}
      </button>
      <p className="text-center text-xs text-[var(--ink-mute)]">Isto não fecha a conta.</p>
    </Folha>
  );
}

function MudarMesa({
  mesa,
  mesas,
  aviso,
  recarregar,
  semSessao,
  onFechar,
  aoMudar,
}: {
  mesa: WaiterTable;
  mesas: WaiterTable[];
  aviso: (a: Aviso) => void;
  recarregar: () => void;
  semSessao: () => void;
  onFechar: () => void;
  aoMudar: () => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [destino, setDestino] = useState<WaiterTable | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const opcoes = mesas.filter((t) => t.active && t.id !== mesa.id);

  const mudar = async () => {
    if (!destino) return;
    setErro(null);
    setAEnviar(true);
    const r = await enviarAcao({ action: 'move', requestId, fromTableId: mesa.id, toTableId: destino.id });
    setAEnviar(false);
    if (r.status === 401) return semSessao();
    if (!r.ok) return setErro(r.error ?? 'Não foi possível.');
    aviso({ tipo: 'ok', texto: `Conta passou para a mesa ${destino.number}. A cozinha foi avisada.` });
    recarregar();
    onFechar();
    aoMudar();
  };

  return (
    <Folha titulo={`Mudar a mesa ${mesa.number}`} onFechar={onFechar} fechar={!aEnviar}>
      <p className="text-sm text-[var(--ink-dim)]">Para qual mesa vai a conta?</p>
      <ul className="grid grid-cols-4 gap-2">
        {opcoes.map((t) => (
          <li key={t.id}>
            <button
              onClick={() => setDestino(t)}
              aria-pressed={destino?.id === t.id}
              className={`h-14 w-full rounded-xl border font-bold ${
                destino?.id === t.id
                  ? 'border-[var(--gold)] bg-[var(--gold)] text-black'
                  : t.orders.length > 0
                    ? 'border-[var(--gold)]/50 text-[var(--gold)]'
                    : 'border-white/10'
              }`}
            >
              {t.number}
            </button>
          </li>
        ))}
      </ul>
      {destino && destino.orders.length > 0 && (
        <p className="rounded-xl bg-amber-500/15 px-4 py-3 text-sm text-amber-200">
          A mesa {destino.number} já tem conta aberta: as duas juntam-se e pagam-se juntas.
        </p>
      )}
      {erro && <p className="rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300">{erro}</p>}
      <button
        onClick={mudar}
        disabled={!destino || aEnviar}
        className="w-full rounded-2xl bg-[var(--gold)] py-4 text-lg font-bold text-black disabled:opacity-50"
      >
        {aEnviar ? 'A mudar…' : destino ? `Mudar para a mesa ${destino.number}` : 'Escolhe a mesa'}
      </button>
    </Folha>
  );
}

function Cobrar({
  mesa,
  meios,
  aviso,
  recarregar,
  semSessao,
  onFechar,
  aoCobrar,
}: {
  mesa: WaiterTable;
  meios: ReturnType<typeof meiosDeCobrar>;
  aviso: (a: Aviso) => void;
  recarregar: () => void;
  semSessao: () => void;
  onFechar: () => void;
  aoCobrar: () => void;
}) {
  // Uma chave por abertura: repetir depois de uma rede falhada nunca cobra duas vezes.
  const [clientCloseId] = useState(() => crypto.randomUUID());
  // O total fica preso ao abrir: se entrar um pedido entretanto, a BD recusa.
  const [total] = useState(() => tableTotalCents(mesa));
  const [metodo, setMetodo] = useState(meios[0]?.id ?? 'mpesa');
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const confirmacao = useDoisToques(6000);
  const nomeDoMeio = meios.find((m) => m.id === metodo)?.label ?? '';

  const cobrar = async () => {
    if (!confirmacao.armado) return confirmacao.armar();
    setErro(null);
    setAEnviar(true);
    const r = await enviarAcao<CloseResult>({
      action: 'close',
      clientCloseId,
      tableId: mesa.id,
      expectedTotalCents: total,
      method: metodo,
    });
    setAEnviar(false);
    confirmacao.desarmar();
    if (r.status === 401) return semSessao();
    if (!r.ok) {
      setErro(r.error ?? 'Não foi possível.');
      // Só uma recusa da BD: sem resposta, a conta pode ter fechado — mantém-se a chave.
      if (r.reason === 'table_bill_changed') recarregar();
      return;
    }
    aviso({ tipo: 'ok', texto: `Mesa ${mesa.number} paga · ${money(total)} · ${nomeDoMeio}` });
    recarregar();
    onFechar();
    aoCobrar();
  };

  return (
    <Folha titulo={`Cobrar · Mesa ${mesa.number}`} onFechar={onFechar} fechar={!aEnviar}>
      <LinhasDaConta mesa={mesa} />
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Meio de pagamento">
        {meios.map((m) => (
          <button
            key={m.id}
            aria-pressed={metodo === m.id}
            onClick={() => {
              setMetodo(m.id);
              confirmacao.desarmar();
            }}
            className={`rounded-xl border px-2 py-3 text-sm font-semibold ${
              metodo === m.id ? 'border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold)]' : 'border-white/10'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="rounded-xl bg-white/5 px-4 py-3 text-sm text-[var(--ink-dim)]">
        Confirma que o dinheiro entrou antes de tocar: este registo não fala com a operadora. Em notas, cobra-se no balcão.
      </p>
      {erro && <p className="rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300">{erro}</p>}
      <button
        onClick={cobrar}
        disabled={aEnviar}
        className={`w-full rounded-2xl py-4 text-lg font-bold text-black disabled:opacity-60 ${
          confirmacao.armado ? 'bg-emerald-300' : 'bg-emerald-500'
        }`}
      >
        {aEnviar
          ? 'A registar…'
          : confirmacao.armado
            ? `Tocar outra vez: recebi ${money(total)}`
            : `Recebi ${money(total)} por ${nomeDoMeio}`}
      </button>
    </Folha>
  );
}

/** Retirar um artigo do pedido dele, ainda na cozinha. Vai um papel "ANULAR" à cozinha. */
export function RetirarArtigo({
  item,
  aviso,
  recarregar,
  semSessao,
  onFechar,
}: {
  item: TableOrderItem;
  aviso: (a: Aviso) => void;
  recarregar: () => void;
  semSessao: () => void;
  onFechar: () => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [qty, setQty] = useState(1);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const retirar = async () => {
    if (!motivo || !item.id) return;
    setErro(null);
    setAEnviar(true);
    const r = await enviarAcao({ action: 'remove', requestId, orderItemId: item.id, qty, reason: motivo });
    setAEnviar(false);
    if (r.status === 401) return semSessao();
    if (!r.ok) {
      setErro(r.error ?? 'Não foi possível.');
      recarregar();
      return;
    }
    aviso({ tipo: 'ok', texto: `Retirado: ${qty}× ${itemLabel(item)}. A cozinha foi avisada.` });
    recarregar();
    onFechar();
  };

  return (
    <Folha titulo="Retirar artigo" onFechar={onFechar} fechar={!aEnviar}>
      <p className="font-semibold">{itemLabel(item)}</p>
      {item.qty > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--ink-dim)]">Quantos?</span>
          <Contador
            qty={qty}
            onMenos={() => setQty((q) => Math.max(1, q - 1))}
            onMais={() => setQty((q) => Math.min(item.qty, q + 1))}
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Motivo">
        {REMOVE_ITEM_REASONS.map((r) => (
          <button
            key={r}
            aria-pressed={motivo === r}
            onClick={() => setMotivo(r)}
            className={`rounded-xl border px-2 py-3 text-sm font-semibold ${
              motivo === r ? 'border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold)]' : 'border-white/10'
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      {erro && <p className="rounded-xl bg-red-500/15 px-4 py-3 text-sm text-red-300">{erro}</p>}
      <button
        onClick={retirar}
        disabled={!motivo || aEnviar}
        className="w-full rounded-2xl bg-red-500 py-4 text-lg font-bold text-white disabled:opacity-40"
      >
        {aEnviar ? 'A retirar…' : motivo ? `Retirar ${qty} · ${money(qty * item.unit_price_cents)}` : 'Escolhe o motivo'}
      </button>
    </Folha>
  );
}

/** Reimprimir pede dois toques: fica no registo e marcado no papel. */
export function ReimprimirComanda({
  orderId,
  aviso,
  semSessao,
}: {
  orderId: string;
  aviso: (a: Aviso) => void;
  semSessao: () => void;
}) {
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [aEnviar, setAEnviar] = useState(false);
  const confirmacao = useDoisToques();

  const tocar = async () => {
    if (!confirmacao.armado) return confirmacao.armar();
    setAEnviar(true);
    const r = await enviarAcao({ action: 'reprint', requestId, orderId });
    setAEnviar(false);
    confirmacao.desarmar();
    if (r.status === 401) return semSessao();
    if (!r.ok) return aviso({ tipo: 'erro', texto: r.error ?? 'Não foi possível.' });
    // Uma reimpressão pedida de propósito depois desta é outra: chave nova.
    setRequestId(crypto.randomUUID());
    aviso({ tipo: 'ok', texto: 'Comanda a sair na cozinha, marcada REIMPRESSÃO' });
  };

  return (
    <button onClick={tocar} disabled={aEnviar} className="w-full py-1 text-xs font-semibold text-[var(--ink-dim)] underline disabled:opacity-60">
      {aEnviar ? 'A enviar…' : confirmacao.armado ? 'Tocar outra vez para reimprimir' : 'Reimprimir comanda'}
    </button>
  );
}
