export * from './types';
export { toWhatsAppPhone, isE164 } from './phone';
export { verifyTimestampedSignature, signTimestamped, WEBHOOK_TOLERANCE_SECONDS } from './signature';
export { createTyxterTransport, parseTyxterEvent, tyxterDeliveries, type TyxterConfig } from './tyxter';
export { createMetaTransport, metaMessageBody, parseMetaWebhook, META_DEFAULT_GRAPH_VERSION, type MetaConfig } from './meta';
export { createMockTransport, type MockTransport } from './mock';
export { clip, compactSession, fitSession, LIMITS } from './limits';

/**
 * Respostas que retiram o número de todos os avisos que não sejam códigos de acesso.
 * DECISÃO (ADR 0012): "CANCELAR" saiu da lista — numa conversa de pedido quer dizer "cancela o carrinho",
 * não "nunca mais me escrevam".
 */
export const OPT_OUT_WORDS = ['SAIR', 'STOP', 'PARAR'] as const;

/** Sem acentos, maiúsculas e espaços a mais — para comparar o que a pessoa escreveu. */
export function normalizeWord(text: string | null): string {
  if (!text) return '';
  return text.trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}

export function isOptOut(text: string | null): boolean {
  return (OPT_OUT_WORDS as readonly string[]).includes(normalizeWord(text));
}
