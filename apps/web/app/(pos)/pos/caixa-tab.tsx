'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatMT, type Cents } from '@delivery/core';
import { createClient } from '@/utils/supabase/client';
import {
  CASH_MOVEMENT_HINTS,
  CASH_MOVEMENT_LABELS,
  CASH_MOVEMENT_TYPES,
  cashErrorMessage,
  movementReady,
  openTablesNotice,
  parseCashStore,
  pressCashKey,
  type CashCloseReport,
  type CashMovementType,
  type CashStore,
} from '@/lib/pos/caixa';
import { fetchTableOverview } from '@/lib/pos/tables';
import { PosIcon } from './pos-icons';
import { TouchKeyboard } from './touch-keyboard';

/** O caixa não muda a cada segundo; o que conta é estar certo quando se fecha. */
const POLL_MS = 30_000;

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];

type Acao = 'movimento' | 'fecho';
type Feedback = { tone: 'ok' | 'danger'; text: string };

/**
 * O que se está a escrever pertence a um ecrã só (`key`): mudar de ecrã, ou o
 * turno fechar noutro sítio, deixa o rascunho para trás em vez de levar a
 * contagem da gaveta para o campo do fundo do turno seguinte.
 */
type Draft = {
  key: string;
  amount: number;
  typed: boolean;
  reason: string;
  movementType: CashMovementType;
};

const emptyDraft = (key: string): Draft => ({
  key,
  amount: 0,
  typed: false,
  reason: '',
  movementType: 'sangria',
});

const mt = (value: number) => {
  const absolute = formatMT(Math.abs(value) as Cents);
  return value < 0 ? `−${absolute}` : absolute;
};

const hora = (iso: string) =>
  new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Africa/Maputo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));

function differenceLabel(cents: number): string {
  if (cents === 0) return 'Certo';
  return cents > 0 ? `Sobra ${mt(cents)}` : `Falta ${mt(-cents)}`;
}

/**
 * A aba Caixa: abrir o turno com o fundo, lançar sangrias e despesas e fechar
 * com a contagem da gaveta, sem sair do balcão.
 *
 * Tudo passa pelas RPCs do caixa (1007) com a sessão de quem está no POS —
 * é essa pessoa que fica no `event_log` e no talão de fecho. O esperado vem
 * do servidor; o POS só o mostra. Sem internet, o caixa pausa e a venda não.
 */
export function CaixaTab({
  storeId,
  storeName,
  deviceId,
  online,
  pendingSales,
  keyboardActive,
}: {
  storeId: string;
  storeName: string;
  deviceId: string;
  online: boolean;
  /** Vendas offline ainda por subir: entram no servidor à hora da sincronização. */
  pendingSales: number;
  /** Falso com um pagamento ou outro painel aberto: aí os algarismos são deles. */
  keyboardActive: boolean;
}) {
  const [supabase] = useState(() => createClient());
  const [store, setStore] = useState<CashStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acao, setAcao] = useState<{ kind: Acao; sessionId: string } | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft('abrir'));
  const [reasonKeyboard, setReasonKeyboard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [reasonMissing, setReasonMissing] = useState(false);
  const [lastClose, setLastClose] = useState<CashCloseReport | null>(null);
  const [tablesNotice, setTablesNotice] = useState<ReturnType<typeof openTablesNotice>>(null);

  const session = store?.open_session ?? null;
  const modo: 'abrir' | Acao | null = !session
    ? 'abrir'
    : acao && acao.sessionId === session.id
      ? acao.kind
      : null;
  const draftKey = session ? `${modo ?? 'resumo'}:${session.id}` : 'abrir';
  const current = draft.key === draftKey ? draft : emptyDraft(draftKey);
  const difference = store ? current.amount - store.expected_cash_cents : 0;

  const editDraft = useCallback(
    (change: (draft: Draft) => Partial<Draft>) => {
      setDraft((previous) => {
        const base = previous.key === draftKey ? previous : emptyDraft(draftKey);
        return { ...base, ...change(base) };
      });
    },
    [draftKey],
  );

  const press = useCallback(
    (key: string) => editDraft((d) => ({ amount: pressCashKey(d.amount, key), typed: true })),
    [editDraft],
  );

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_cash_dashboard', { p_store: storeId });
    setLoading(false);
    if (error) {
      setLoadError(`${cashErrorMessage(error.message)} Os valores são da última consulta.`);
      return;
    }
    const parsed = parseCashStore(data, storeId);
    if (!parsed) {
      setLoadError('Não foi possível ler o caixa desta loja.');
      return;
    }
    setLoadError(null);
    setStore(parsed);
  }, [storeId, supabase]);

  useEffect(() => {
    if (!online) return;
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, online]);

  function start(kind: Acao) {
    if (!session) return;
    setFeedback(null);
    setReasonMissing(false);
    setAcao({ kind, sessionId: session.id });
    if (kind === 'fecho') {
      // Best-effort: sem a lista de mesas (ou sem a 1081 aplicada) o fecho
      // faz-se na mesma, só sem o aviso.
      setTablesNotice(null);
      fetchTableOverview(supabase, deviceId)
        .then((overview) => setTablesNotice(openTablesNotice(overview)))
        .catch(() => undefined);
    }
  }

  const cancel = useCallback(() => {
    setAcao(null);
    setReasonMissing(false);
    setDraft(emptyDraft('abrir'));
  }, []);

  const openSession = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.rpc('open_cash_session', {
      p_store: storeId,
      p_float: current.amount,
    });
    setBusy(false);
    if (error) {
      setFeedback({ tone: 'danger', text: cashErrorMessage(error.message) });
      void load();
      return;
    }
    setLastClose(null);
    setDraft(emptyDraft('abrir'));
    setFeedback({ tone: 'ok', text: `Caixa aberto · fundo ${mt(current.amount)}` });
    void load();
  }, [busy, current.amount, load, storeId, supabase]);

  const addMovement = useCallback(async () => {
    if (busy || !movementReady(current.amount, current.reason)) return;
    setBusy(true);
    const { error } = await supabase.rpc('add_cash_movement', {
      p_store: storeId,
      p_type: current.movementType,
      p_amount_cents: current.amount,
      p_reason: current.reason.trim(),
    });
    setBusy(false);
    if (error) {
      setFeedback({ tone: 'danger', text: cashErrorMessage(error.message) });
      void load();
      return;
    }
    setFeedback({
      tone: 'ok',
      text: `Registado · ${CASH_MOVEMENT_LABELS[current.movementType]} de ${mt(current.amount)}`,
    });
    cancel();
    void load();
  }, [busy, cancel, current.amount, current.movementType, current.reason, load, storeId, supabase]);

  const closeSession = useCallback(async () => {
    if (busy || !current.typed) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('close_cash_session', {
      p_store: storeId,
      p_counted: current.amount,
      p_reason: current.reason.trim() || null,
    });
    setBusy(false);
    if (error) {
      const semMotivo = error.message.includes('difference_reason_required');
      setReasonMissing(semMotivo);
      setFeedback({ tone: 'danger', text: cashErrorMessage(error.message) });
      if (!semMotivo) void load();
      return;
    }
    const report = data as CashCloseReport;
    // O talão de fecho já está na fila (trigger da F5); o email é best-effort.
    void fetch('/api/emails/send-cash-close-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: report.session_id }),
    }).catch(() => undefined);
    setLastClose(report);
    setFeedback(null);
    cancel();
    void load();
  }, [busy, cancel, current.amount, current.reason, current.typed, load, storeId, supabase]);

  const submit = useCallback(() => {
    if (!online) return;
    if (modo === 'abrir') void openSession();
    else if (modo === 'movimento') void addMovement();
    else if (modo === 'fecho') void closeSession();
  }, [addMovement, closeSession, modo, online, openSession]);

  // Num PC com teclado, os algarismos e o Enter também servem.
  useEffect(() => {
    if (!keyboardActive || reasonKeyboard || modo === null) return;
    function onKey(event: KeyboardEvent) {
      const alvo = event.target as HTMLElement | null;
      if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable)) return;
      if (/^\d$/.test(event.key)) press(event.key);
      else if (event.key === 'Backspace') press('⌫');
      else if (event.key === 'Escape') press('C');
      else if (event.key === 'Enter') submit();
      else return;
      event.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboardActive, modo, press, reasonKeyboard, submit]);

  const keypad = (
    <div className="grid grid-cols-3 gap-2">
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => press(key)}
          className={`pos-key ${key === 'C' || key === '⌫' ? 'pos-key--muted' : ''}`}
        >
          {key}
        </button>
      ))}
    </div>
  );

  const reasonField = (label: string, warn: boolean) => (
    <button
      type="button"
      onClick={() => setReasonKeyboard(true)}
      data-warn={warn && !current.reason.trim()}
      className="pos-field"
    >
      <span className="min-w-0 flex-1">
        <span className="pos-eyebrow !block truncate">{label}</span>
        <span
          className={`mt-0.5 block truncate text-[0.9375rem] ${
            current.reason ? 'font-semibold text-ink' : 'font-medium text-ink-mute'
          }`}
        >
          {current.reason || 'Tocar para escrever'}
        </span>
      </span>
      <PosIcon name="pencil" size={18} className="shrink-0 text-ink-mute" />
    </button>
  );

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-3 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-xl font-bold">Caixa · {storeName}</h2>
          <p className="text-sm text-ink-mute">
            {session ? `${session.shift_label} · aberto às ${hora(session.opened_at)}` : 'Sem turno aberto'}
          </p>
        </div>

        {!online && (
          <p role="alert" className="pos-note pos-note--warn">
            Sem ligação. Abrir, lançar e fechar o caixa precisam de internet — as vendas continuam.
          </p>
        )}

        {modo === 'abrir' && (
          <>
            <div className="pos-well !flex !min-h-20 !items-center !justify-between !px-5">
              <span className="text-sm font-semibold text-ink-mute">Fundo inicial</span>
              <strong className="pos-num text-4xl font-extrabold">{mt(current.amount)}</strong>
            </div>
            {keypad}
            <button
              type="button"
              disabled={busy || !online || !store}
              onClick={() => void openSession()}
              className="pos-btn pos-btn--primary pos-btn--lg w-full"
            >
              <PosIcon name="cash" size={22} />
              {busy ? 'A abrir…' : `Abrir caixa · ${mt(current.amount)}`}
            </button>
            <p className="text-sm text-ink-mute">Conta o troco que está na gaveta antes de abrir.</p>
          </>
        )}

        {modo === null && (
          <>
            <button
              type="button"
              disabled={!online}
              onClick={() => start('fecho')}
              className="pos-btn pos-btn--primary pos-btn--lg w-full"
            >
              <PosIcon name="check" size={22} />
              Fechar caixa
            </button>
            <button
              type="button"
              disabled={!online}
              onClick={() => start('movimento')}
              className="pos-btn pos-btn--lg w-full"
            >
              <PosIcon name="cash" size={22} />
              Sangria · reforço · despesa
            </button>
          </>
        )}

        {modo === 'movimento' && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {CASH_MOVEMENT_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={current.movementType === type}
                  onClick={() => editDraft(() => ({ movementType: type }))}
                  className="pos-choice !min-h-14"
                >
                  {CASH_MOVEMENT_LABELS[type]}
                </button>
              ))}
            </div>
            <p className="text-sm text-ink-mute">{CASH_MOVEMENT_HINTS[current.movementType]}</p>
            <div className="pos-well !flex !min-h-20 !items-center !justify-between !px-5">
              <span className="text-sm font-semibold text-ink-mute">Valor</span>
              <strong className="pos-num text-4xl font-extrabold">{mt(current.amount)}</strong>
            </div>
            {keypad}
            {reasonField('Motivo (obrigatório)', true)}
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={cancel} className="pos-btn pos-btn--quiet pos-btn--lg flex-1">
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy || !online || !movementReady(current.amount, current.reason)}
                onClick={() => void addMovement()}
                className="pos-btn pos-btn--primary pos-btn--lg flex-[2]"
              >
                {busy ? 'A registar…' : 'Registar'}
              </button>
            </div>
          </>
        )}

        {modo === 'fecho' && store && (
          <>
            <div className="pos-well !flex !min-h-20 !items-center !justify-between !px-5">
              <span className="text-sm font-semibold text-ink-mute">Contado na gaveta</span>
              <strong className={`pos-num text-4xl font-extrabold ${current.typed ? '' : 'text-ink-mute'}`}>
                {mt(current.amount)}
              </strong>
            </div>
            {keypad}
            {current.typed && (
              <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/[0.07] bg-bg2 p-3 text-center">
                <span>
                  <span className="pos-eyebrow !block">Esperado</span>
                  <span className="pos-num font-bold">{mt(store.expected_cash_cents)}</span>
                </span>
                <span>
                  <span className="pos-eyebrow !block">Contado</span>
                  <span className="pos-num font-bold">{mt(current.amount)}</span>
                </span>
                <span>
                  <span className="pos-eyebrow !block">Diferença</span>
                  <span className={`pos-num font-bold ${difference === 0 ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {differenceLabel(difference)}
                  </span>
                </span>
              </div>
            )}
            {pendingSales > 0 && (
              <p role="alert" className="pos-note pos-note--warn">
                {pendingSales === 1 ? 'Há 1 venda offline' : `Há ${pendingSales} vendas offline`} por
                sincronizar. O dinheiro está na gaveta mas a venda ainda não chegou ao servidor —
                espera pela confirmação verde antes de fechar.
              </p>
            )}
            {tablesNotice && (
              <p role="alert" className="pos-note pos-note--warn">
                {tablesNotice.numbers.length === 1
                  ? `A mesa ${tablesNotice.numbers[0]} tem`
                  : `As mesas ${tablesNotice.numbers.join(', ')} têm`}{' '}
                conta por fechar ({mt(tablesNotice.totalCents)}). O que não for pago agora não entra neste fecho.
              </p>
            )}
            {reasonField('Motivo da diferença (se passar a tolerância)', reasonMissing)}
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={cancel} className="pos-btn pos-btn--quiet pos-btn--lg flex-1">
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy || !online || !current.typed}
                onClick={() => void closeSession()}
                className="pos-btn pos-btn--primary pos-btn--lg flex-[2]"
              >
                {busy ? 'A fechar…' : 'Confirmar fecho'}
              </button>
            </div>
          </>
        )}

        {feedback && (
          <p
            role="status"
            className={`pos-note ${feedback.tone === 'ok' ? 'pos-note--ok' : 'pos-note--danger'} !text-base !font-bold`}
          >
            {feedback.text}
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {loadError && <p role="alert" className="pos-note pos-note--warn">{loadError}</p>}
        {loading && !store && online && <p className="py-10 text-center text-ink-mute">A carregar o caixa…</p>}

        {lastClose && !session && (
          <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.07] p-4">
            <p className="pos-eyebrow !text-emerald-200">Caixa fechado · {lastClose.shift_label}</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Metric label="Esperado" value={mt(lastClose.expected_cash_cents)} />
              <Metric label="Contado" value={mt(lastClose.counted_cash_cents)} />
              <Metric
                label="Diferença"
                value={differenceLabel(lastClose.difference_cents)}
                tone={lastClose.difference_cents === 0 ? 'ok' : 'warn'}
              />
            </div>
            <p className="mt-3 text-sm text-ink-mute">
              {lastClose.total_pedidos} pedidos · {mt(lastClose.total_faturado_cents)} facturados. O talão de
              fecho sai na impressora do balcão e o resumo vai por email ao dono.
            </p>
          </section>
        )}

        {store && !session && !lastClose && (
          <p className="rounded-2xl border border-white/[0.07] bg-bg2 p-4 text-sm text-ink-mute">
            Sem caixa aberto. Se venderes assim, a primeira venda abre o turno sem fundo — abre aqui primeiro,
            com o troco contado.
          </p>
        )}

        {store && session && (
          <>
            <section className="rounded-2xl border border-white/[0.07] bg-bg2 p-4">
              <p className="pos-eyebrow">Esperado na gaveta</p>
              <p className="pos-num mt-1 text-4xl font-extrabold text-gold">{mt(store.expected_cash_cents)}</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Metric label="Fundo" value={mt(session.opening_float_cents)} />
                <Metric label="Dinheiro vendido" value={mt(store.cash_sales_cents)} />
                <Metric label="Sangrias" value={mt(store.sangria_cents)} />
                <Metric label="Reforços" value={mt(store.reforco_cents)} />
                <Metric label="Despesas" value={mt(store.despesa_cents)} />
                {store.troco_inicial_cents > 0 && (
                  <Metric label="Troco inicial" value={mt(store.troco_inicial_cents)} />
                )}
              </div>
              {session.opening_float_cents === 0 && store.troco_inicial_cents === 0 && (
                <p className="pos-note pos-note--warn mt-3">
                  Este turno abriu sem fundo. Se há troco na gaveta, regista-o em Sangria · reforço · despesa →
                  Troco inicial.
                </p>
              )}
            </section>

            <section>
              <h3 className="pos-eyebrow mb-2">
                Fora da gaveta · {store.total_pedidos} pedidos · {mt(store.total_faturado_cents)} facturados
              </h3>
              <div className="grid grid-cols-3 gap-2">
                <Metric label="M-Pesa" value={mt(store.mpesa_cents)} />
                <Metric label="e-Mola" value={mt(store.emola_cents)} />
                <Metric label="Cartão" value={mt(store.credit_card_cents)} />
              </div>
            </section>

            <section>
              <h3 className="pos-eyebrow mb-2">Movimentos do turno ({store.movements.length})</h3>
              {store.movements.length === 0 ? (
                <p className="rounded-2xl border border-white/[0.07] bg-bg2 p-4 text-center text-sm text-ink-mute">
                  Sem movimentos neste turno.
                </p>
              ) : (
                <ul className="divide-y divide-white/[0.07] rounded-2xl border border-white/[0.07] bg-bg2">
                  {store.movements.map((movement) => (
                    <li key={movement.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{CASH_MOVEMENT_LABELS[movement.type]}</span>
                        <span className="block truncate text-sm text-ink-mute">
                          {movement.reason} · {hora(movement.created_at)}
                        </span>
                      </span>
                      <strong className="pos-num text-gold">{mt(movement.amount_cents)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      {reasonKeyboard && (
        <TouchKeyboard
          label={modo === 'fecho' ? 'Motivo da diferença' : 'Motivo do movimento'}
          value={current.reason}
          maxLength={300}
          onCancel={() => setReasonKeyboard(false)}
          onConfirm={(value) => {
            editDraft(() => ({ reason: value }));
            setReasonMissing(false);
            setReasonKeyboard(false);
          }}
        />
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  const color = tone === 'ok' ? 'text-emerald-300' : tone === 'warn' ? 'text-amber-300' : 'text-ink';
  return (
    <div className="rounded-xl bg-black/20 px-3 py-2">
      <p className="text-xs text-ink-mute">{label}</p>
      <p className={`pos-num mt-0.5 font-bold ${color}`}>{value}</p>
    </div>
  );
}
