/**
 * Códigos de resposta do M-Pesa → o que fazer com eles.
 *
 * **A decisão mais importante deste ficheiro** não é a tradução das mensagens:
 * é a coluna do meio — se um código significa "não pagou" ou "não sei".
 *
 * Tratar "não sei" como "não pagou" é o erro caro: o cliente digitou o PIN, o
 * dinheiro saiu, e o sistema deu a encomenda como falhada. Por isso tudo o que
 * for tempo esgotado, erro interno do M-Pesa ou rede em baixo cai em
 * `unknown` — que fica pendente e é resolvido perguntando o estado, nunca
 * decidido por nós (CLAUDE.md §1, regra 1).
 */

export type MpesaOutcome = 'success' | 'failed' | 'unknown';

export interface MpesaCode {
  outcome: MpesaOutcome;
  /** Mensagem para o cliente ler. Vazia quando não há nada de útil a dizer-lhe. */
  pt: string;
  /** Vale a pena o cliente tentar outra vez? */
  retryable: boolean;
}

export const MPESA_CODES: Record<string, MpesaCode> = {
  // ── Pagou ────────────────────────────────────────────────────────────────
  'INS-0': { outcome: 'success', pt: 'Pagamento confirmado.', retryable: false },

  // ── Não pagou, e sabemos porquê ──────────────────────────────────────────
  'INS-5': {
    outcome: 'failed',
    pt: 'Cancelaste o pagamento no telemóvel. Podes tentar de novo.',
    retryable: true,
  },
  'INS-6': {
    outcome: 'failed',
    pt: 'O M-Pesa recusou o pagamento. Tenta de novo ou usa outro número.',
    retryable: true,
  },
  'INS-2006': {
    outcome: 'failed',
    pt: 'Saldo insuficiente no M-Pesa. Carrega a conta e tenta de novo.',
    retryable: true,
  },
  'INS-2051': {
    outcome: 'failed',
    pt: 'Número inválido. Confirma o número e tenta de novo.',
    retryable: true,
  },
  'INS-996': {
    outcome: 'failed',
    pt: 'A conta M-Pesa não está activa. Fala com a Vodacom e tenta depois.',
    retryable: false,
  },
  'INS-995': {
    outcome: 'failed',
    pt: 'Há um problema com a conta M-Pesa. Fala com a Vodacom e tenta depois.',
    retryable: false,
  },
  'INS-4': {
    outcome: 'failed',
    pt: 'A conta M-Pesa não está activa. Fala com a Vodacom e tenta depois.',
    retryable: false,
  },

  // ── Não pagou, e a culpa é da configuração (o cliente não resolve) ───────
  // Mensagem genérica de propósito: o cliente não tem nada a ver com a nossa
  // chave errada, e dizer-lho não o ajuda. Quem tem de saber é o painel.
  'INS-2': { outcome: 'failed', pt: '', retryable: false },
  'INS-13': { outcome: 'failed', pt: '', retryable: false },
  'INS-15': { outcome: 'failed', pt: '', retryable: false },
  'INS-17': { outcome: 'failed', pt: '', retryable: false },
  'INS-19': { outcome: 'failed', pt: '', retryable: false },
  'INS-20': { outcome: 'failed', pt: '', retryable: false },
  'INS-21': { outcome: 'failed', pt: '', retryable: false },
  'INS-26': { outcome: 'failed', pt: '', retryable: false },

  // ── NÃO SABEMOS. Fica pendente e pergunta-se o estado. ──────────────────
  // Tempo esgotado. Nunca dizer "falhou" aqui: o PIN pode ter sido digitado e
  // o dinheiro ter saído — só o M-Pesa sabe, e pergunta-se-lhe.
  'INS-9': {
    outcome: 'unknown',
    pt: 'Ainda não recebemos a confirmação. Se digitaste o PIN, aguarda — estamos a confirmar.',
    retryable: false,
  },
  'INS-1': {
    outcome: 'unknown',
    pt: 'O M-Pesa está com dificuldades. Estamos a confirmar o teu pagamento.',
    retryable: false,
  },
  'INS-16': {
    outcome: 'unknown',
    pt: 'O M-Pesa está congestionado. Estamos a confirmar o teu pagamento.',
    retryable: false,
  },
  'INS-10': {
    // Duplicado: já mandámos este pedido. Não é um pagamento novo, e não é
    // uma falha — é sinal de que temos de ir perguntar o estado do primeiro.
    outcome: 'unknown',
    pt: 'Já existe um pagamento em curso para esta encomenda. Estamos a confirmar.',
    retryable: false,
  },
  'INS-23': {
    outcome: 'unknown',
    pt: 'Estado desconhecido no M-Pesa. Estamos a confirmar o teu pagamento.',
    retryable: false,
  },
};

/** Nada de útil a mostrar ao cliente quando o problema é nosso. */
export const MPESA_FALLBACK_PT =
  'Não foi possível confirmar o pagamento agora. Estamos a verificar — não pagues duas vezes.';

/**
 * Um código que não conhecemos é **`unknown`**, nunca `failed`.
 *
 * A escolha é deliberada: o M-Pesa pode devolver amanhã um código que hoje não
 * existe. Se o tratássemos como falha, o primeiro código novo dava encomendas
 * por falhadas com o dinheiro cobrado. Assim, o pior caso é uma encomenda que
 * fica pendente até alguém (ou o cron) perguntar o estado.
 */
export function readMpesaCode(code: string | null | undefined): MpesaCode {
  if (!code) return { outcome: 'unknown', pt: MPESA_FALLBACK_PT, retryable: false };
  return (
    MPESA_CODES[code] ?? { outcome: 'unknown', pt: MPESA_FALLBACK_PT, retryable: false }
  );
}

/** Mensagem para o cliente; cai no genérico quando não há nada de útil a dizer. */
export function mpesaMessagePt(code: string | null | undefined): string {
  const entry = readMpesaCode(code);
  return entry.pt || MPESA_FALLBACK_PT;
}
