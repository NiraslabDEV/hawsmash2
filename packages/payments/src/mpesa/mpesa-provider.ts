import { constants, publicEncrypt } from 'node:crypto';

import type {
  DirectChargeRequest,
  DirectChargeResult,
  DirectPaymentProvider,
  ProviderPaymentStatus,
} from '../provider';
import { mpesaMessagePt, readMpesaCode } from './codes';

/**
 * M-Pesa da Vodacom, **directo** — sem gateway pelo meio.
 *
 * O fluxo: mandamos o pedido, o cliente recebe um pedido de PIN no telemóvel,
 * e a chamada HTTP fica à espera dele. Pode demorar minutos. Pode não voltar.
 *
 * ────────────────────────────────────────────────────────────────────────
 * AS TRÊS REGRAS DESTE FICHEIRO (a razão de ele existir assim)
 *
 * 1. **"Não sei" nunca vira "não pagou".** Tempo esgotado, erro do M-Pesa,
 *    rede em baixo → `pending`. O cliente pode ter digitado o PIN e o dinheiro
 *    ter saído; quem decide é o M-Pesa, quando lhe perguntarmos.
 *
 * 2. **A mesma referência nunca cobra duas vezes.** `input_ThirdPartyReference`
 *    é a referência da tentativa. Repetir a chamada com a mesma referência dá
 *    `INS-10` (duplicado) — que tratamos como "vai perguntar o estado", não
 *    como cobrança nova.
 *
 * 3. **Tudo tem tecto de tempo.** Sem `AbortSignal.timeout`, uma chamada presa
 *    prende o pedido do cliente, prende o servidor, e o cliente carrega outra
 *    vez no botão. É assim que se cobra duas vezes a alguém.
 * ────────────────────────────────────────────────────────────────────────
 *
 * Os endereços e portas ficam em configuração e **não** têm valor por omissão:
 * o M-Pesa usa portas diferentes por operação e por ambiente, e um número
 * inventado aqui seria plausível o suficiente para chegar a produção
 * (`AGENTS.md` §1.5).
 */

export interface MpesaConfig {
  /** Chave da API, do portal da Vodacom. Segredo. */
  apiKey: string;
  /** Chave pública (base64 DER) do portal. Cifra a chave da API e a sessão. */
  publicKey: string;
  /** Código do comerciante (short code). */
  serviceProviderCode: string;
  /** Base do endpoint de sessão, ex.: `https://api.vm.co.mz:PORTA`. */
  sessionBaseUrl: string;
  /** Base do endpoint de cobrança C2B. */
  chargeBaseUrl: string;
  /** Base do endpoint de consulta de estado. */
  queryBaseUrl: string;
  /** Origem exigida pelo M-Pesa no cabeçalho `Origin`. */
  origin?: string;
  /** Tecto de tempo da cobrança. O M-Pesa espera pelo PIN do cliente. */
  chargeTimeoutMs?: number;
  /** Tecto de tempo da sessão e da consulta — são rápidas. */
  shortTimeoutMs?: number;
}

const DEFAULT_CHARGE_TIMEOUT_MS = 125_000;
const DEFAULT_SHORT_TIMEOUT_MS = 20_000;
const DEFAULT_ORIGIN = 'developer.mpesa.vm.co.mz';

/** A sessão do M-Pesa vive cerca de uma hora; renovamos bem antes disso. */
const SESSION_TTL_MS = 50 * 60 * 1000;

interface MpesaResponseBody {
  output_ResponseCode?: string;
  output_ResponseDesc?: string;
  output_TransactionID?: string;
  output_ConversationID?: string;
  output_ThirdPartyReference?: string;
  output_SessionID?: string;
}

export class MpesaConfigError extends Error {
  constructor(campo: string) {
    super(`mpesa_config_missing:${campo}`);
    this.name = 'MpesaConfigError';
  }
}

export class MpesaProvider implements DirectPaymentProvider {
  readonly flow = 'direct' as const;

  private session: { token: string; expiresAt: number } | null = null;

  constructor(private readonly config: MpesaConfig) {
    for (const campo of [
      'apiKey',
      'publicKey',
      'serviceProviderCode',
      'sessionBaseUrl',
      'chargeBaseUrl',
      'queryBaseUrl',
    ] as const) {
      if (!config[campo]?.trim()) throw new MpesaConfigError(campo);
    }
  }

  /* ─────────────────────────── cobrança ──────────────────────────────── */

  async charge(request: DirectChargeRequest): Promise<DirectChargeResult> {
    // Boundary: centavos inteiros → decimal em texto. Nunca float (§17).
    const amount = (request.amountCents / 100).toFixed(2);

    let body: MpesaResponseBody;
    try {
      body = await this.post(
        `${trimBase(this.config.chargeBaseUrl)}/ipg/v2/vodacomMOZ/c2bPayment/singleStage/`,
        {
          input_TransactionReference: request.reference,
          input_CustomerMSISDN: request.msisdn,
          input_Amount: amount,
          input_ThirdPartyReference: request.reference,
          input_ServiceProviderCode: this.config.serviceProviderCode,
        },
        this.config.chargeTimeoutMs ?? DEFAULT_CHARGE_TIMEOUT_MS,
      );
    } catch (error) {
      // Rede em baixo, tempo esgotado, resposta ilegível: **não sabemos**.
      // Marcar como falha aqui seria dar a encomenda por perdida com o
      // dinheiro possivelmente já cobrado.
      return {
        status: 'pending',
        providerRef: null,
        code: errorCode(error),
        message: mpesaMessagePt('INS-9'),
      };
    }

    const code = body.output_ResponseCode ?? null;
    const leitura = readMpesaCode(code);

    return {
      status: leitura.outcome === 'unknown' ? 'pending' : leitura.outcome,
      providerRef: body.output_TransactionID ?? body.output_ConversationID ?? null,
      code,
      message: mpesaMessagePt(code),
    };
  }

  /* ─────────────────────── consulta de estado ────────────────────────── */

  /**
   * Pergunta o estado pela referência da tentativa.
   *
   * É esta chamada que fecha o ciclo: tudo o que ficou `pending` — por tempo
   * esgotado, por duplicado, por rede em baixo — resolve-se aqui, seja no
   * regresso do cliente ao ecrã, seja no cron de reconciliação.
   */
  async getPaymentStatus(reference: string, options?: { signal?: AbortSignal }): Promise<ProviderPaymentStatus> {
    const url = new URL(
      `${trimBase(this.config.queryBaseUrl)}/ipg/v2/vodacomMOZ/queryTransactionStatus/`,
    );
    url.searchParams.set('input_QueryReference', reference);
    url.searchParams.set('input_ServiceProviderCode', this.config.serviceProviderCode);
    url.searchParams.set('input_ThirdPartyReference', reference);

    let body: MpesaResponseBody;
    try {
      const timeout = AbortSignal.timeout(this.config.shortTimeoutMs ?? DEFAULT_SHORT_TIMEOUT_MS);
      const signal = options?.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
      signal.throwIfAborted();
      body = await this.get(url.toString(), this.config.shortTimeoutMs ?? DEFAULT_SHORT_TIMEOUT_MS, signal);
    } catch {
      // Não conseguir perguntar não é resposta: continua pendente e volta-se
      // a perguntar. O cron existe para isto.
      return 'pending';
    }

    const leitura = readMpesaCode(body.output_ResponseCode ?? null);
    return leitura.outcome === 'unknown' ? 'pending' : leitura.outcome;
  }

  /* ───────────────────────────── sessão ──────────────────────────────── */

  /**
   * O M-Pesa não aceita a chave da API directamente: exige uma **sessão**,
   * pedida com a chave cifrada, e depois usa-se a sessão cifrada como bearer.
   *
   * A sessão é guardada em memória porque pedir uma nova a cada cobrança
   * duplica a latência de um fluxo em que o cliente já está à espera.
   */
  private async getSessionToken(force = false, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const agora = Date.now();
    if (!force && this.session && this.session.expiresAt > agora) return this.session.token;

    const url = `${trimBase(this.config.sessionBaseUrl)}/ipg/v2/vodacomMOZ/getSession/`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.encrypt(this.config.apiKey)}`,
        Origin: this.config.origin ?? DEFAULT_ORIGIN,
        'Content-Type': 'application/json',
      },
      signal: combineTimeout(this.config.shortTimeoutMs ?? DEFAULT_SHORT_TIMEOUT_MS, signal),
    });

    const body = (await res.json().catch(() => ({}))) as MpesaResponseBody;
    const sessionId = body.output_SessionID;
    if (!res.ok || !sessionId) {
      throw new Error(`mpesa_session_failed:${body.output_ResponseCode ?? res.status}`);
    }

    const token = this.encrypt(sessionId);
    this.session = { token, expiresAt: agora + SESSION_TTL_MS };
    return token;
  }

  /** RSA PKCS#1 v1.5 com a chave pública do portal, em base64. */
  private encrypt(valor: string): string {
    const pem = toPem(this.config.publicKey);
    return publicEncrypt(
      { key: pem, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(valor, 'utf8'),
    ).toString('base64');
  }

  /* ──────────────────────────── transporte ───────────────────────────── */

  private async post(
    url: string,
    payload: Record<string, string>,
    timeoutMs: number,
  ): Promise<MpesaResponseBody> {
    return this.comSessao((token) =>
      fetch(url, {
        method: 'POST',
        headers: this.headers(token),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      }),
    );
  }

  private async get(url: string, timeoutMs: number, signal?: AbortSignal): Promise<MpesaResponseBody> {
    return this.comSessao((token) =>
      fetch(url, {
        method: 'GET',
        headers: this.headers(token),
        signal: combineTimeout(timeoutMs, signal),
      }),
      signal,
    );
  }

  private headers(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Origin: this.config.origin ?? DEFAULT_ORIGIN,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Corre o pedido com a sessão em cache e, **uma só vez**, repete com sessão
   * nova se o M-Pesa disser que não está autorizado.
   *
   * Uma vez e não mais: a sessão expira sozinha e uma chave errada não melhora
   * com insistência. Repetir em ciclo é como se transformam credenciais más em
   * bloqueio de conta.
   */
  private async comSessao(
    pedido: (token: string) => Promise<Response>,
    signal?: AbortSignal,
  ): Promise<MpesaResponseBody> {
    let res = await pedido(await this.getSessionToken(false, signal));

    if (res.status === 401 || res.status === 403) {
      this.session = null;
      signal?.throwIfAborted();
      res = await pedido(await this.getSessionToken(true, signal));
    }

    const body = (await res.json().catch(() => ({}))) as MpesaResponseBody;

    // Um HTTP 5xx sem corpo legível não é uma resposta do M-Pesa sobre o
    // pagamento — é o M-Pesa em baixo. Lançar leva ao caminho do "não sei".
    if (!res.ok && !body.output_ResponseCode) {
      throw new Error(`mpesa_http_${res.status}`);
    }

    return body;
  }
}

/* ───────────────────────────── utilitários ─────────────────────────────── */

function trimBase(base: string): string {
  return base.replace(/\/+$/, '');
}

function combineTimeout(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

/** Aceita a chave com ou sem cabeçalho PEM — o portal dá-a das duas maneiras. */
function toPem(publicKey: string): string {
  const limpa = publicKey.trim();
  if (limpa.includes('BEGIN PUBLIC KEY')) return limpa;
  const corpo = limpa.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') ?? limpa;
  return `-----BEGIN PUBLIC KEY-----\n${corpo}\n-----END PUBLIC KEY-----`;
}

function errorCode(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'timeout';
    return error.message.slice(0, 60);
  }
  return 'unknown_error';
}
