'use client';

import { useEffect, useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';

import { enviarAcao } from '@/lib/garcom/client';
import type { CloseResult, WaiterState, WaiterTable } from '@/lib/garcom/contract';
import { meiosDeCobrar } from '@/lib/garcom/pedido';
import { billLines, itemLabel, REMOVE_ITEM_REASONS, tableTotalCents, type TableOrderItem } from '@/lib/pos/tables';

import { PosIcon } from '@/app/(pos)/pos/pos-icons';

import { Contador, Folha, Nota, type Aviso } from './ui';

const money = (c: number) => formatMT(c as Cents);

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
        <button className="pos-btn !min-h-[3.5rem] !gap-2 !px-3 whitespace-nowrap text-[0.9375rem]" onClick={() => setFolha('conta')}>
          <PosIcon name="printer" size={19} className="text-ink-mute" />
          Pedir a conta
        </button>
        <button className="pos-btn !min-h-[3.5rem] !gap-2 !px-3 whitespace-nowrap text-[0.9375rem]" onClick={() => setFolha('mudar')}>
          <PosIcon name="arrow" size={19} className="text-ink-mute" />
          Mudar de mesa
        </button>
      </div>
      {podeCobrar && (
        <button className="pos-btn pos-btn--ok pos-btn--lg w-full !justify-between !px-5" onClick={() => setFolha('cobrar')}>
          <span className="flex items-center gap-2">
            <PosIcon name="cash" size={24} />
            Cobrar
          </span>
          <span className="pos-num">{money(tableTotalCents(mesa))}</span>
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
      <div className="pos-well overflow-hidden">
        <ul className="divide-y divide-white/[0.06]">
          {billLines(mesa).map((linha) => (
            <li key={linha.key} className="flex items-start justify-between gap-3 px-4 py-3 text-[0.9375rem]">
              <span className="min-w-0">
                <span className="pos-num font-extrabold text-gold">{linha.qty}×</span> {linha.label}
                {linha.notes && <span className="block text-xs italic text-ink-mute">{linha.notes}</span>}
              </span>
              <span className="pos-num shrink-0 font-semibold text-ink-dim">{money(linha.totalCents)}</span>
            </li>
          ))}
        </ul>
        <p className="flex items-baseline justify-between border-t border-white/[0.08] bg-white/[0.03] px-4 py-3">
          <span className="pos-eyebrow">Total da mesa</span>
          <span className="pos-num text-2xl font-extrabold text-gold">{money(tableTotalCents(mesa))}</span>
        </p>
      </div>
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
    <Folha titulo={`Conta da mesa ${mesa.number}`} subtitulo="Para ler ao cliente ou imprimir" onFechar={onFechar}>
      <LinhasDaConta mesa={mesa} />
      {erro && <Nota tom="danger">{erro}</Nota>}
      <button onClick={imprimir} disabled={aEnviar} className="pos-btn pos-btn--primary w-full">
        <PosIcon name="printer" size={20} />
        {aEnviar ? 'A enviar…' : 'Imprimir no balcão'}
      </button>
      <p className="text-center text-xs text-ink-mute">Isto não fecha a conta.</p>
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
    <Folha titulo={`Mudar a mesa ${mesa.number}`} subtitulo="Para qual mesa vai a conta?" onFechar={onFechar} fechar={!aEnviar}>
      <ul className="grid grid-cols-4 gap-2">
        {opcoes.map((t) => (
          <li key={t.id}>
            <button
              onClick={() => setDestino(t)}
              aria-pressed={destino?.id === t.id}
              className={`pos-choice pos-num w-full !min-h-14 !text-lg !font-extrabold ${
                t.orders.length > 0 && destino?.id !== t.id ? '!text-gold !shadow-[inset_0_0_0_1px_var(--pos-accent-line)]' : ''
              }`}
            >
              {t.number}
            </button>
          </li>
        ))}
      </ul>
      <p className="flex items-center gap-2 text-xs text-ink-mute">
        <span className="h-3 w-3 rounded-[4px] shadow-[inset_0_0_0_1px_var(--pos-accent-line)]" aria-hidden />
        Com conta aberta
      </p>
      {destino && destino.orders.length > 0 && (
        <Nota tom="warn">A mesa {destino.number} já tem conta aberta: as duas juntam-se e pagam-se juntas.</Nota>
      )}
      {erro && <Nota tom="danger">{erro}</Nota>}
      <button onClick={mudar} disabled={!destino || aEnviar} className="pos-btn pos-btn--primary w-full">
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
    <Folha titulo={`Cobrar a mesa ${mesa.number}`} onFechar={onFechar} fechar={!aEnviar}>
      <LinhasDaConta mesa={mesa} />
      <div className="space-y-2">
        <p className="pos-eyebrow">Como pagou?</p>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Meio de pagamento">
          {meios.map((m) => (
            <button
              key={m.id}
              aria-pressed={metodo === m.id}
              onClick={() => {
                setMetodo(m.id);
                confirmacao.desarmar();
              }}
              className="pos-choice !min-h-[3.25rem] !px-2 text-sm"
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <Nota tom="warn">
        Confirma que o dinheiro entrou antes de tocar: este registo não fala com a operadora. Em notas, cobra-se no balcão.
      </Nota>
      {erro && <Nota tom="danger">{erro}</Nota>}
      <button
        onClick={cobrar}
        disabled={aEnviar}
        className={`pos-btn pos-btn--ok pos-btn--lg w-full !text-lg ${confirmacao.armado ? 'pos-pop !bg-emerald-300' : ''}`}
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
    <Folha titulo="Retirar artigo" subtitulo={itemLabel(item)} onFechar={onFechar} fechar={!aEnviar}>
      {item.qty > 1 && (
        <div className="flex items-center justify-between">
          <span className="pos-eyebrow">Quantos?</span>
          <Contador
            qty={qty}
            onMenos={() => setQty((q) => Math.max(1, q - 1))}
            onMais={() => setQty((q) => Math.min(item.qty, q + 1))}
          />
        </div>
      )}
      <div className="space-y-2">
        <p className="pos-eyebrow">Porquê?</p>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Motivo">
          {REMOVE_ITEM_REASONS.map((r) => (
            <button key={r} aria-pressed={motivo === r} onClick={() => setMotivo(r)} className="pos-choice !min-h-[3.25rem] !px-2 text-sm">
              {r}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-ink-mute">Sai um papel &quot;ANULAR&quot; na cozinha e o stock volta.</p>
      {erro && <Nota tom="danger">{erro}</Nota>}
      <button onClick={retirar} disabled={!motivo || aEnviar} className="pos-btn pos-btn--danger-solid w-full">
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
    <button
      onClick={tocar}
      disabled={aEnviar}
      className={`pos-press flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold disabled:opacity-60 ${
        confirmacao.armado ? 'bg-white/[0.08] text-ink' : 'text-ink-mute'
      }`}
    >
      <PosIcon name="printer" size={14} />
      {aEnviar ? 'A enviar…' : confirmacao.armado ? 'Tocar outra vez para reimprimir' : 'Reimprimir comanda'}
    </button>
  );
}
