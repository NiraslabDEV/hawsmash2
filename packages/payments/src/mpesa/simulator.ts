import type {
  DirectChargeRequest,
  DirectChargeResult,
  DirectPaymentProvider,
  ProviderPaymentStatus,
} from '../provider';
import { mpesaMessagePt, readMpesaCode } from './codes';

/**
 * M-Pesa simulado — para desenvolver e ensaiar sem credenciais da Vodacom.
 *
 * Não é um brinquedo: é o que permite ensaiar os casos que ninguém consegue
 * provocar de propósito em produção — o cliente que cancela, o saldo que não
 * chega, e sobretudo **o tempo esgotado**, que é onde o sistema tem de se
 * portar bem (ficar pendente e ir perguntar, nunca dar por falhado).
 *
 * O caso é escolhido pelo **último dígito do número**, para se ensaiar tudo
 * sem mexer em configuração:
 *
 * | Termina em | O que acontece |
 * |---|---|
 * | 0–5 | paga |
 * | 6 | cliente cancela (`INS-5`) |
 * | 7 | saldo insuficiente (`INS-2006`) |
 * | 8 | tempo esgotado (`INS-9`) → fica pendente, e a consulta diz que pagou |
 * | 9 | duplicado (`INS-10`) → fica pendente, e a consulta diz que pagou |
 */
export class MpesaSimulator implements DirectPaymentProvider {
  readonly flow = 'direct' as const;

  /** Estado por referência, para a consulta responder de forma coerente. */
  private readonly estados = new Map<string, ProviderPaymentStatus>();

  constructor(private readonly options: { atrasoMs?: number } = {}) {}

  async charge(request: DirectChargeRequest): Promise<DirectChargeResult> {
    if (this.options.atrasoMs) await new Promise((r) => setTimeout(r, this.options.atrasoMs));

    const code = codigoPara(request.msisdn);
    const leitura = readMpesaCode(code);
    const status: ProviderPaymentStatus =
      leitura.outcome === 'unknown' ? 'pending' : leitura.outcome;

    // O ponto do simulador: o que ficou "pendente" foi mesmo pago no M-Pesa.
    // É assim que se prova que o sistema não perde uma venda por não ter
    // recebido a resposta a tempo.
    this.estados.set(request.reference, leitura.outcome === 'unknown' ? 'success' : status);

    return {
      status,
      providerRef: status === 'failed' ? null : `sim_${request.reference}`,
      code,
      message: mpesaMessagePt(code),
    };
  }

  async getPaymentStatus(reference: string): Promise<ProviderPaymentStatus> {
    return this.estados.get(reference) ?? 'pending';
  }
}

function codigoPara(msisdn: string): string {
  switch (msisdn.slice(-1)) {
    case '6':
      return 'INS-5';
    case '7':
      return 'INS-2006';
    case '8':
      return 'INS-9';
    case '9':
      return 'INS-10';
    default:
      return 'INS-0';
  }
}
