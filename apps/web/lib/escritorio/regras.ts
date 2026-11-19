/**
 * Escritório (ADR 0014): o que o ecrã precisa, sem React nem rede. Quem manda nas regras é a BD (1140, 1141);
 * aqui está o que torna o ecrã legível e o que se valida antes de gravar, para o erro chegar em português.
 *
 * Sem `node:crypto`: este ficheiro entra no bundle do browser (POS, checkout, painel).
 */

// ── NUIT e adquirente ───────────────────────────────────────────────────────

export function cleanNuit(raw: string): string {
  return raw.replace(/\s/g, '');
}

export function isValidNuit(raw: string): boolean {
  return /^\d{9}$/.test(cleanNuit(raw));
}

export function formatNuit(raw: string | null | undefined): string {
  const nuit = cleanNuit(raw ?? '');
  return /^\d{9}$/.test(nuit) ? `${nuit.slice(0, 3)} ${nuit.slice(3, 6)} ${nuit.slice(6)}` : nuit;
}

export type FiscalBuyer = { nuit: string; name: string; address: string };

/** O que o POS e o site pedem antes de pagar. Devolve o erro em português, ou o adquirente limpo. */
export function checkFiscalBuyer(input: FiscalBuyer): { ok: true; buyer: FiscalBuyer } | { ok: false; error: string } {
  const nuit = cleanNuit(input.nuit);
  const name = input.name.replace(/\s+/g, ' ').trim();
  const address = input.address.replace(/\s+/g, ' ').trim();
  if (!/^\d{9}$/.test(nuit)) return { ok: false, error: 'O NUIT tem 9 dígitos.' };
  if (name.length < 2) return { ok: false, error: 'Escreve o nome ou a empresa que vai na factura.' };
  if (name.length > 120) return { ok: false, error: 'O nome é comprido demais (máximo 120 caracteres).' };
  if (address.length > 200) return { ok: false, error: 'A morada é comprida demais (máximo 200 caracteres).' };
  return { ok: true, buyer: { nuit, name, address } };
}

// ── Dinheiro ────────────────────────────────────────────────────────────────

/** 1.224,00 — como no documento fiscal. */
export function money(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const int = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${int},${String(abs % 100).padStart(2, '0')}`;
}

/** "1.224,50" ou "1224.5" → centavos. Null se não for um valor positivo. */
export function parseMoney(raw: string): number | null {
  const text = raw.trim().replace(/\s/g, '');
  if (!text) return null;
  const normalized = /,\d{1,2}$/.test(text) ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [int, dec = ''] = normalized.split('.');
  return Number(int) * 100 + Number(dec.padEnd(2, '0'));
}

/** IVA contido num total com IVA (taxa em pontos-base), arredondado como o programa: IVA = total − base. */
export function vatInsideTotal(totalCents: number, rateBp: number): number {
  if (rateBp <= 0) return 0;
  return totalCents - Math.round((totalCents * 10000) / (10000 + rateBp));
}

// ── Datas (Maputo) ──────────────────────────────────────────────────────────

export function maputoToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Maputo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dow = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

export function shortDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export function monthName(month: number): string {
  return MONTHS[month - 1] ?? String(month);
}
export function periodLabel(period: string): string {
  if (period === 'once') return 'única';
  const [y, m] = period.split('-');
  return m ? `${monthName(Number(m))} de ${y}` : y;
}

// ── Obrigações ──────────────────────────────────────────────────────────────

export type Obligation = {
  id: string;
  store_id: string | null;
  title: string;
  description: string | null;
  recurrence: 'monthly' | 'yearly' | 'once';
  due_rule: 'day' | 'last_business_day';
  due_day: number | null;
  due_month: number | null;
  due_date: string | null;
  refers_to_previous: boolean;
  remind_days: number;
  responsible: string | null;
  active: boolean;
};

/** Igual a `private.office_due_in_month`: dia fixo (cortado ao fim do mês) ou último dia útil (seg–sex). */
export function dueInMonth(year: number, month: number, rule: Obligation['due_rule'], day: number | null): string {
  const last = daysIn(year, month);
  if (rule === 'last_business_day') {
    let d = last;
    while (dow(year, month, d) === 0 || dow(year, month, d) === 6) d -= 1;
    return iso(year, month, d);
  }
  return iso(year, month, Math.min(day ?? 1, last));
}

export type ObligationState = 'feito' | 'atrasado' | 'a_aproximar' | 'em_dia';

export type ObligationOccurrence = {
  obligation: Obligation;
  period: string;
  due: string;
  daysLeft: number;
  state: ObligationState;
};

/**
 * A ocorrência que importa hoje: a deste mês se está por fazer (mesmo atrasada), senão a próxima.
 * O mesmo horizonte dos avisos da BD (este mês e o seguinte); a anual procura o seu mês nos próximos doze.
 * Uma obrigação criada hoje não aparece logo com meses de atraso.
 */
export function currentOccurrence(ob: Obligation, done: ReadonlySet<string>, todayIso: string): ObligationOccurrence | null {
  const [ty, tm] = todayIso.split('-').map(Number);
  const candidates: Array<{ period: string; due: string }> = [];
  if (ob.recurrence === 'once') {
    if (ob.due_date) candidates.push({ period: 'once', due: ob.due_date });
  } else {
    const deltas = ob.recurrence === 'yearly' ? Array.from({ length: 13 }, (_, i) => i) : [0, 1];
    for (const delta of deltas) {
      const { year, month } = addMonths(ty, tm, delta);
      if (ob.recurrence === 'yearly') {
        if (month !== ob.due_month) continue;
        candidates.push({
          period: String(ob.refers_to_previous ? year - 1 : year),
          due: dueInMonth(year, month, ob.due_rule, ob.due_day),
        });
      } else {
        const ref = ob.refers_to_previous ? addMonths(year, month, -1) : { year, month };
        candidates.push({
          period: `${ref.year}-${String(ref.month).padStart(2, '0')}`,
          due: dueInMonth(year, month, ob.due_rule, ob.due_day),
        });
      }
    }
  }
  const unique = [...new Map(candidates.map((c) => [c.period, c])).values()].sort((a, b) => a.due.localeCompare(b.due));
  const overdue = unique.find((c) => c.due < todayIso && !done.has(c.period));
  const next = unique.find((c) => c.due >= todayIso);
  const pick = overdue ?? next ?? unique[unique.length - 1];
  if (!pick) return null;
  const daysLeft = daysBetween(todayIso, pick.due);
  const state: ObligationState = done.has(pick.period)
    ? 'feito'
    : daysLeft < 0 ? 'atrasado' : daysLeft <= ob.remind_days ? 'a_aproximar' : 'em_dia';
  return { obligation: ob, period: pick.period, due: pick.due, daysLeft, state };
}

export function ruleText(ob: Pick<Obligation, 'recurrence' | 'due_rule' | 'due_day' | 'due_month' | 'due_date'>): string {
  const dia = ob.due_rule === 'last_business_day' ? 'último dia útil' : `dia ${ob.due_day ?? '?'}`;
  if (ob.recurrence === 'once') return `até ${shortDate(ob.due_date)}`;
  if (ob.recurrence === 'yearly') return `todos os anos, ${dia} de ${monthName(ob.due_month ?? 1).toLowerCase()}`;
  return `todos os meses, ${dia}`;
}

/**
 * Modelos para começar. Só o da e-Declaração tem prazo escrito, porque tem fonte (Aviso da DGI de 27/03/2025:
 * até ao último dia útil do mês seguinte). Os outros vêm sem dia: o dono preenche-o com o contabilista.
 */
export const OBLIGATION_TEMPLATES: Array<Pick<Obligation, 'title' | 'description' | 'recurrence' | 'due_rule' | 'due_day' | 'due_month' | 'refers_to_previous' | 'remind_days'>> = [
  {
    title: 'Ficheiro das facturas no e-Declaração',
    description: 'Exportar o ficheiro do mês no Escritório e entregar ao contabilista, que o submete no e-Declaração.',
    recurrence: 'monthly', due_rule: 'last_business_day', due_day: null, due_month: null, refers_to_previous: true, remind_days: 10,
  },
  {
    title: 'Declaração e pagamento do IVA',
    description: 'Confirmar o prazo com o contabilista. O resumo do mês mostra o IVA liquidado e o das compras.',
    recurrence: 'monthly', due_rule: 'day', due_day: null, due_month: null, refers_to_previous: true, remind_days: 7,
  },
  {
    title: 'Contribuições ao INSS',
    description: 'Confirmar o prazo com o contabilista.',
    recurrence: 'monthly', due_rule: 'day', due_day: null, due_month: null, refers_to_previous: true, remind_days: 5,
  },
  {
    title: 'Retenções na fonte (IRPS dos salários)',
    description: 'Confirmar o prazo com o contabilista.',
    recurrence: 'monthly', due_rule: 'day', due_day: null, due_month: null, refers_to_previous: true, remind_days: 5,
  },
];

// ── Arquivo ─────────────────────────────────────────────────────────────────

export const DOCUMENT_CATEGORIES: Record<string, string> = {
  licenca: 'Licença', alvara: 'Alvará', certidao: 'Certidão', contrato: 'Contrato', seguro: 'Seguro',
  seguranca: 'Segurança (extintores…)', fiscal: 'Fiscal', outros: 'Outros',
};

export function expiryState(expiresOn: string | null, remindDays: number, todayIso: string): 'sem_validade' | 'caducado' | 'a_caducar' | 'valido' {
  if (!expiresOn) return 'sem_validade';
  const left = daysBetween(todayIso, expiresOn);
  if (left < 0) return 'caducado';
  return left <= remindDays ? 'a_caducar' : 'valido';
}

// ── Compras ─────────────────────────────────────────────────────────────────

export const PURCHASE_CATEGORIES: Record<string, string> = {
  mercadoria: 'Mercadoria', servicos: 'Serviços', equipamento: 'Equipamento', renda: 'Renda', utilidades: 'Água, luz, internet', outros: 'Outros',
};

/** Nome seguro para o ficheiro no bucket privado: `<pasta>/<uuid>/<nome>`, como a BD exige. */
export function storagePath(folder: 'purchases' | 'documents', id: string, fileName: string): string {
  const ext = (fileName.match(/\.([A-Za-z0-9]{1,5})$/)?.[1] ?? 'pdf').toLowerCase();
  const base = fileName.replace(/\.[^.]*$/, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'ficheiro';
  return `${folder}/${id}/${base}.${ext}`;
}

// ── Erros da BD em português ────────────────────────────────────────────────

const ERRORS: Array<[RegExp, string]> = [
  [/forbidden/, 'O teu perfil não pode fazer isto.'],
  [/fiscal_invalid_nuit|office_invalid_nuit/, 'O NUIT tem 9 dígitos.'],
  [/fiscal_buyer_name_required/, 'Escreve o nome que vai na factura.'],
  [/fiscal_already_issued/, 'Esta venda já tem factura. Para mudar o NUIT, reemite-a no Escritório.'],
  [/fiscal_already_credited/, 'Este documento já foi anulado.'],
  [/fiscal_too_late/, 'Já não dá para pedir factura com NUIT por aqui. Pede-a na loja.'],
  [/fiscal_legal_name_required/, 'Falta o nome legal da empresa.'],
  [/fiscal_address_required/, 'Falta a morada da sede.'],
  [/fiscal_invalid_vat/, 'A taxa de IVA não é válida.'],
  [/fiscal_exemption_reason_required/, 'No regime isento, escreve o motivo da isenção (o artigo da lei).'],
  [/fiscal_document_not_found|not_found/, 'Não encontrei esse registo.'],
  [/office_duplicate_invoice/, 'Essa factura deste fornecedor já está registada.'],
  [/office_future_date/, 'A data da factura não pode ser no futuro.'],
  [/office_reason_required/, 'Escreve o motivo.'],
  [/office_invoice_voided/, 'Essa compra está anulada.'],
  [/office_label_required/, 'Dá um nome ao acesso (por exemplo, o nome do contabilista).'],
  [/supplier_invoices_vat_le_total/, 'O IVA tem de ser menor do que o total.'],
  [/office_obligations_rule/, 'Falta o dia do prazo (ou o mês, se for anual, ou a data, se for única).'],
  [/accountant_invalid/, 'Este acesso já não é válido. Pede outro à empresa.'],
  [/function .* does not exist|Could not find the function|schema cache/, 'A base de dados ainda não tem o Escritório (migrations 1140 e 1141 por aplicar).'],
];

export function officeError(message: string | null | undefined): string {
  const text = message ?? '';
  return ERRORS.find(([re]) => re.test(text))?.[1] ?? `Não foi possível concluir: ${text || 'erro desconhecido'}.`;
}
