import { z } from 'zod';
import { agentOrderSchema, type AgentOrderInput } from './schemas';

export const agentHandoffSchema = z.object({ v: z.literal(1), selection: agentOrderSchema }).strict();
const MAX_HASH_LENGTH = 24000;

/** O fragmento não é enviado ao servidor no pedido HTTP da página de revisão. */
export function encodeAgentHandoff(input: AgentOrderInput): string {
  const payload = agentHandoffSchema.parse({ v: 1, selection: input });
  const hash = `#cart=${encodeURIComponent(JSON.stringify(payload))}`;
  if (hash.length > MAX_HASH_LENGTH) throw new Error('A selecção é demasiado extensa. Reduz as escolhas e tenta novamente.');
  return hash;
}

/** Conteúdo editável pelo cliente: sempre validado e recalculado antes de continuar. */
export function decodeAgentHandoff(hash: string): AgentOrderInput {
  if (typeof hash !== 'string' || !hash.startsWith('#cart=') || hash.length > MAX_HASH_LENGTH) throw new Error('Ligação de revisão inválida. Prepara novamente o pedido.');
  try {
    const value: unknown = JSON.parse(decodeURIComponent(hash.slice(6)));
    return agentHandoffSchema.parse(value).selection;
  } catch {
    throw new Error('Ligação de revisão inválida. Prepara novamente o pedido.');
  }
}
