import type { DirectChargeRequest, DirectChargeResult, DirectPaymentProvider, ProviderPaymentStatus } from '../provider';
import { normalizeEmolaMsisdn } from './msisdn';

const referencePattern = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * Ensaio local, sem API ou códigos da Movitel. Não cobra, não envia PIN e não
 * recebe callbacks. O último dígito escolhe um cenário exclusivamente sintético:
 * 0–5 pago; 6–7 falhado; 8 resposta pendente e consulta paga; 9 sempre pendente.
 * A referência SIM inclui o resultado de ensaio para a consulta sobreviver a
 * outro processo. Só é interpretada neste simulador, nunca num fornecedor real.
 */
export class EmolaSimulator implements DirectPaymentProvider {
  readonly flow = 'direct' as const;

  async charge(request: DirectChargeRequest): Promise<DirectChargeResult> {
    if (!Number.isSafeInteger(request.amountCents) || request.amountCents <= 0) throw new Error('emola_sim_invalid_amount');
    if (!referencePattern.test(request.reference)) throw new Error('emola_sim_invalid_reference');
    const msisdn = normalizeEmolaMsisdn(request.msisdn);
    const last = msisdn.slice(-1);
    const status: ProviderPaymentStatus = last === '6' || last === '7' ? 'failed' : last === '8' || last === '9' ? 'pending' : 'success';
    const finalStatus = last === '8' ? 'success' : status;
    const providerRef = `SIM_EMOLA_${finalStatus.toUpperCase()}_${Buffer.from(request.reference).toString('base64url')}`;
    return {
      status,
      providerRef,
      code: last === '8' ? 'SIM_EMOLA_PENDING_THEN_SUCCESS' : `SIM_EMOLA_${status.toUpperCase()}`,
      message: status === 'success' ? 'Pagamento simulado confirmado. Nenhum dinheiro foi movimentado.'
        : status === 'failed' ? 'Falha de pagamento simulada. Nenhum dinheiro foi movimentado.'
          : 'Pagamento simulado pendente. Nenhum dinheiro foi movimentado.',
    };
  }

  async getPaymentStatus(reference: string, options?: { signal?: AbortSignal }): Promise<ProviderPaymentStatus> {
    if (options?.signal?.aborted) return 'pending';
    const match = /^SIM_EMOLA_(SUCCESS|FAILED|PENDING)_([A-Za-z0-9_-]{1,171})$/.exec(reference);
    if (!match) return 'pending';
    const original = Buffer.from(match[2], 'base64url').toString('utf8');
    if (!referencePattern.test(original) || Buffer.from(original).toString('base64url') !== match[2]) return 'pending';
    return match[1] === 'SUCCESS' ? 'success' : match[1] === 'FAILED' ? 'failed' : 'pending';
  }
}
