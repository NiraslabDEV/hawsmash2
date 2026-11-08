/**
 * A aba Caixa do POS: abrir o turno com o fundo, lançar sangrias e despesas e
 * fechar com a contagem da gaveta — sem sair do balcão para o painel.
 *
 * As contas são todas do servidor (1007): `open_cash_session`,
 * `add_cash_movement`, `close_cash_session` e `get_cash_dashboard`, com perfil,
 * loja e `event_log`. O esperado na gaveta conta desde o último fecho, nunca
 * desde a meia-noite (CLAUDE §9). Este módulo é só a parte que se testa sem
 * browser: o teclado, a leitura do painel e as frases.
 */

import { parseCashDayReport, type CashDayReport } from '@/lib/cash/day';

export type CashMovementType = 'sangria' | 'reforco' | 'despesa' | 'troco_inicial';

export const CASH_MOVEMENT_TYPES: CashMovementType[] = ['sangria', 'reforco', 'despesa', 'troco_inicial'];

export const CASH_MOVEMENT_LABELS: Record<CashMovementType, string> = {
  sangria: 'Sangria',
  reforco: 'Reforço',
  despesa: 'Despesa',
  troco_inicial: 'Troco inicial',
};

/** O que cada movimento faz à gaveta — é a pergunta que o caixa faz antes de tocar. */
export const CASH_MOVEMENT_HINTS: Record<CashMovementType, string> = {
  sangria: 'Dinheiro que sai da gaveta para o cofre.',
  reforco: 'Dinheiro que entra na gaveta a meio do turno.',
  despesa: 'Pagamento feito com dinheiro da gaveta.',
  troco_inicial: 'Troco posto na gaveta depois de o turno abrir.',
};

export type CashMovement = {
  id: string;
  type: CashMovementType;
  amount_cents: number;
  reason: string;
  created_at: string;
};

export type CashStore = {
  store_id: string;
  store_name: string;
  has_open_session: boolean;
  open_session: {
    id: string;
    shift_label: string;
    opened_at: string;
    opening_float_cents: number;
  } | null;
  total_pedidos: number;
  total_faturado_cents: number;
  cash_sales_cents: number;
  mpesa_cents: number;
  emola_cents: number;
  credit_card_cents: number;
  sangria_cents: number;
  reforco_cents: number;
  despesa_cents: number;
  troco_inicial_cents: number;
  expected_cash_cents: number;
  movements: CashMovement[];
};

/** O que o `close_cash_session` devolve — é o mesmo que sai no talão de fecho. */
export type CashCloseReport = {
  session_id: string;
  shift_label: string;
  expected_cash_cents: number;
  counted_cash_cents: number;
  difference_cents: number;
  total_pedidos: number;
  total_faturado_cents: number;
};

/** O mesmo tecto do teclado do pagamento: 999.999 MT. */
export const CASH_MAX_CENTS = 99_999_900;

/**
 * Meticais inteiros, como o teclado do pagamento: na gaveta não há centavos
 * que se contem à mão, e um teclado com vírgula era mais um sítio para errar.
 */
export function pressCashKey(cents: number, key: string): number {
  if (key === 'C') return 0;
  if (key === '⌫') return Math.floor(cents / 1000) * 100;
  if (!/^\d$/.test(key)) return cents;
  const meticais = Math.floor(cents / 100);
  const next = Number(`${meticais === 0 ? '' : meticais}${key}`) * 100;
  return next > CASH_MAX_CENTS ? cents : next;
}

export function movementReady(amountCents: number, reason: string): boolean {
  return amountCents > 0 && reason.trim().length >= 3;
}

const MONEY_FIELDS = [
  'total_faturado_cents',
  'cash_sales_cents',
  'mpesa_cents',
  'emola_cents',
  'credit_card_cents',
  'sangria_cents',
  'reforco_cents',
  'despesa_cents',
  'troco_inicial_cents',
  'expected_cash_cents',
] as const;

const isCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

/**
 * A loja do terminal, e só essa, no painel de caixa. Um gerente com as duas
 * lojas recebe as duas do servidor — o POS mostra a que o dispositivo serve.
 * Dinheiro que não venha em centavos inteiros invalida a leitura: melhor um
 * ecrã a dizer "não foi possível" do que um esperado errado com ar de certo.
 */
export function parseCashStore(data: unknown, storeId: string): CashStore | null {
  if (!data || typeof data !== 'object') return null;
  const stores = (data as { stores?: unknown }).stores;
  if (!Array.isArray(stores)) return null;
  const raw = stores.find(
    (store): store is Record<string, unknown> =>
      !!store && typeof store === 'object' && (store as { store_id?: unknown }).store_id === storeId,
  );
  if (!raw) return null;
  if (!MONEY_FIELDS.every((field) => isCents(raw[field]))) return null;
  if (!isCents(raw.total_pedidos)) return null;

  const session = raw.open_session as CashStore['open_session'] | undefined;
  if (session && !isCents(session.opening_float_cents)) return null;

  return {
    ...(raw as unknown as CashStore),
    has_open_session: raw.has_open_session === true && !!session,
    open_session: session ?? null,
    movements: Array.isArray(raw.movements) ? (raw.movements as CashMovement[]) : [],
  };
}

/** Uma mesa por pagar, como o `get_cash_day` a diz (1128). */
export type OpenTable = { number: number; total_cents: number };

/**
 * A frase de quem está a tentar fechar: que mesas faltam e, com o total, quanto.
 * O servidor recusa o fecho na mesma (`tables_open`) — isto é só para a caixa
 * saber antes de contar a gaveta.
 */
export function openTablesLabel(numbers: number[]): string {
  return numbers.length === 1 ? `A mesa ${numbers[0]} tem` : `As mesas ${numbers.join(', ')} têm`;
}

export function openTablesNotice(tables: OpenTable[]): { numbers: number[]; totalCents: number } | null {
  if (tables.length === 0) return null;
  return {
    numbers: tables.map((table) => table.number).sort((a, b) => a - b),
    totalCents: tables.reduce((soma, table) => soma + table.total_cents, 0),
  };
}

/**
 * O que o `get_cash_day` (1091, 1128) diz ao POS: os turnos fechados à espera
 * do fecho do dia, se há um turno aberto (que o trava), o último fecho do dia,
 * o dia de trabalho e as mesas por pagar.
 */
export type CashDay = {
  hasOpenSession: boolean;
  pending: CashDayReport | null;
  lastDayClose: { id: string; business_date: string; closed_at: string } | null;
  /** O dia de trabalho: só muda com o fecho do dia. Null num servidor anterior à 1128. */
  businessDate: string | null;
  /** O dia de trabalho ficou para trás: o POS guia ao fecho antes de vender. */
  overdue: boolean;
  openTables: OpenTable[];
};

export function parseCashDay(data: unknown): CashDay | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as {
    open_session?: unknown;
    pending?: unknown;
    last_day_close?: unknown;
    business_date?: unknown;
    day_overdue?: unknown;
    open_tables?: unknown;
  };
  let pending: CashDayReport | null = null;
  if (raw.pending != null) {
    pending = parseCashDayReport(raw.pending);
    if (!pending) return null;
  }
  const last = raw.last_day_close as CashDay['lastDayClose'] | undefined;
  const mesas = Array.isArray(raw.open_tables) ? (raw.open_tables as Partial<OpenTable>[]) : [];
  return {
    hasOpenSession: raw.open_session != null,
    pending,
    lastDayClose:
      last && typeof last.id === 'string' && typeof last.business_date === 'string' ? last : null,
    businessDate: typeof raw.business_date === 'string' ? raw.business_date : null,
    // Na dúvida, não está atrasado: o POS só trava a venda com a certeza do servidor.
    overdue: raw.day_overdue === true,
    openTables: mesas.filter(
      (mesa): mesa is OpenTable => Number.isSafeInteger(mesa?.number) && isCents(mesa?.total_cents),
    ),
  };
}

export function cashErrorMessage(message?: string): string {
  if (!message) return 'Não foi possível concluir. Tenta outra vez.';
  if (message.includes('difference_reason_required')) {
    return 'A diferença passa a tolerância. Conta outra vez; se estiver certa, escreve o motivo.';
  }
  if (message.includes('tables_open')) {
    const numeros = message.split('tables_open:')[1]?.match(/\d+/g)?.map(Number) ?? [];
    const quem = numeros.length > 0 ? openTablesLabel(numeros) : 'Há mesas com';
    return `${quem} conta por fechar. Cobra primeiro em Mesas; o caixa só fecha com todas as mesas pagas.`;
  }
  if (message.includes('day_close_required')) {
    return 'O dia anterior ainda não foi fechado. Faz o fecho do dia (aba Caixa do POS) antes de abrir um turno novo.';
  }
  if (message.includes('session_already_open')) return 'O caixa desta loja já está aberto.';
  if (message.includes('session_open')) return 'Há um turno aberto: fecha primeiro o turno, depois o dia.';
  if (message.includes('no_shifts_to_close')) return 'Não há turnos fechados à espera do fecho do dia.';
  // A 1091 ainda não aplicada nesta base: o PostgREST não encontra a função.
  if (message.includes('Could not find the function') || message.includes('PGRST202')) {
    return 'O fecho do dia ainda não está disponível nesta loja. Chama o suporte.';
  }
  if (message.includes('no_open_session')) return 'Não há caixa aberto nesta loja.';
  if (message.includes('request_id_reused')) return 'Esse movimento já foi registado com outro valor. Fecha e volta a abrir o movimento.';
  if (message.includes('invalid_opening_float') || message.includes('invalid_counted_cents')) {
    return 'O valor não é válido.';
  }
  if (message.includes('invalid_cash_movement') || message.includes('cash_movement_reason_required')) {
    return 'Indica um valor e o motivo do movimento.';
  }
  if (message.includes('cash_access_denied')) return 'O teu perfil não pode mexer no caixa. Chama o gerente.';
  if (message.includes('store_access_denied')) return 'Não tens acesso ao caixa desta loja.';
  if (message.includes('not_authenticated')) return 'A sessão expirou. Bloqueia o POS e entra outra vez.';
  if (/fetch|network|timeout/i.test(message)) {
    return 'Sem ligação ao servidor. O caixa precisa de internet — as vendas continuam.';
  }
  return message;
}
