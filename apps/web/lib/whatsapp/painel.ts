// Só o ficheiro do telefone: o índice do pacote traz node:crypto, que não entra no bundle do browser.
import { isE164, toWhatsAppPhone } from "@delivery/whatsapp/src/phone";

/**
 * O que o ecrã do WhatsApp no painel precisa, sem React (ADR 0011/0012).
 * Quem manda nas regras é a BD (`save_store_whatsapp`, 1126); aqui é só o que torna o ecrã legível.
 */

/** Respostas de sessão grátis por número e por mês, desde 1/10/2026. Depois cobra a Meta, ao preço de utility. */
export const FREE_SERVICE_MESSAGES = 1000;

export interface WhatsAppMonth {
  since: string;
  service_delivered: number;
  utility_delivered: number;
  marketing_delivered: number;
  authentication_delivered: number;
  failed: number;
  waiting: number;
  inbound: number;
  orders: number;
}

export interface StoreWhatsApp {
  enabled: boolean;
  chat_enabled: boolean;
  sender_id: string | null;
  phone: string | null;
  handoff_phone: string | null;
  alert_phones: string[];
  month: WhatsAppMonth;
}

/** Telemóvel moçambicano como se escreve de verdade, ou internacional já em E.164. */
export function normalizePhone(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const compact = text.replace(/[\s().-]/g, "");
  return toWhatsAppPhone(text) ?? (isE164(compact) ? compact : null);
}

/** Lista separada por vírgulas, ponto e vírgula ou linhas. Sem repetidos. */
export function parsePhoneList(raw: string): { phones: string[]; invalid: string[] } {
  const phones = new Set<string>();
  const invalid: string[] = [];
  for (const part of raw.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean)) {
    const phone = normalizePhone(part);
    if (phone) phones.add(phone);
    else invalid.push(part);
  }
  return { phones: [...phones], invalid };
}

/** O que a Meta cobra este mês: avisos entregues sempre; respostas só acima das grátis. */
export function usageView(month: WhatsAppMonth) {
  return {
    freeLeft: Math.max(FREE_SERVICE_MESSAGES - month.service_delivered, 0),
    chargedService: Math.max(month.service_delivered - FREE_SERVICE_MESSAGES, 0),
    chargedTemplates: month.utility_delivered + month.marketing_delivered + month.authentication_delivered,
    get chargedTotal() {
      return this.chargedService + this.chargedTemplates;
    },
  };
}

const SAVE_ERRORS: Record<string, string> = {
  whatsapp_sender_required: "Para ligar, preenche primeiro o id do número na Meta.",
  whatsapp_chat_requires_enabled: "Liga primeiro os avisos: é por esse número que a conversa responde.",
  whatsapp_sender_taken: "Esse número já está ligado a outra loja.",
  invalid_sender_id: "O id do número só leva letras, números, ponto, traço e sublinhado.",
  invalid_phone: "O número desta loja não parece um telefone válido.",
  invalid_handoff_phone: "O número de atendimento não parece um telefone válido.",
  invalid_alert_phones: "Há um telemóvel inválido nos alertas (máximo 5).",
  forbidden: "Só o dono pode mudar o WhatsApp.",
};

export function saveErrorText(message: string): string {
  const known = Object.keys(SAVE_ERRORS).find((code) => message.includes(code));
  return known ? SAVE_ERRORS[known] : `Não guardou: ${message}`;
}

/** A BD ainda sem a 1126: o ecrã explica em vez de mostrar um erro técnico. */
export function isMissingMigration(message: string): boolean {
  return /get_store_whatsapp|schema cache|does not exist|could not find/i.test(message);
}

/** `+258841234567` → `+258 84 ••• 4567`. O nº inteiro não faz falta para perceber o histórico. */
export function maskPhone(phone: string): string {
  const mz = /^\+258(\d{2})\d{3}(\d{4})$/.exec(phone);
  if (mz) return `+258 ${mz[1]} ••• ${mz[2]}`;
  return phone.length > 7 ? `${phone.slice(0, 4)} ••• ${phone.slice(-4)}` : phone;
}

const EVENT_LABELS: Record<string, string> = {
  "chat.reply": "Resposta da conversa",
  "order.paid": "Pedido pago",
  "order.payment_failed": "Pagamento recusado",
  "order.scheduled_reminder": "Lembrete do agendado",
  "order.ready": "Pedido pronto",
  "order.on_the_way": "Pedido a caminho",
  "order.delivered": "Pedido entregue",
  "order.cancelled": "Pedido cancelado",
  "alert.system": "Alerta ao dono",
  "digest.daily": "Resumo do dia",
};

export const eventLabel = (event: string) => EVENT_LABELS[event] ?? event;

const STATUS_LABELS: Record<string, string> = {
  queued: "na fila",
  sending: "a enviar",
  accepted: "aceite",
  sent: "enviada",
  delivered: "entregue",
  read: "lida",
  failed: "falhou",
  cancelled: "cancelada",
};

export const statusLabel = (status: string) => STATUS_LABELS[status] ?? status;
