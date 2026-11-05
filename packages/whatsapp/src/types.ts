/**
 * Contrato do WhatsApp (ADR 0011, 0012). Nada aqui sabe o que é um pedido, um sócio ou uma loja:
 * este pacote copia-se sem edição para o Gym OS e para o motor.
 */

export type WhatsAppKind = 'utility' | 'authentication' | 'marketing' | 'service';

interface OutboundBase {
  /** Id do número no fornecedor (`stores.whatsapp_sender_id`). */
  senderId: string;
  /** Destinatário em E.164 com `+` (`+258841234567`). */
  to: string;
  /** Estável por mensagem: repetir o envio com a mesma chave não duplica onde o fornecedor deduplica. */
  idempotencyKey: string;
}

/** Template aprovado na Meta — a única coisa que a loja pode enviar fora das 24 h da conversa. */
export interface TemplateContent {
  type?: 'template';
  template: string;
  language: string;
  variables?: Record<string, string | number>;
  /** Componentes Meta (ex.: parâmetro do botão de URL). Passam tal e qual. */
  components?: Array<Record<string, unknown>>;
}

export interface ReplyButton { id: string; title: string }
export interface ListRow { id: string; title: string; description?: string }
export interface ListSection { title?: string; rows: ListRow[] }

/**
 * Mensagens de sessão: só dentro das 24 h depois de o cliente escrever. Grátis na Meta.
 * Os limites da Meta (3 botões, 10 linhas, títulos de 20/24) são aplicados por `fitSession`.
 */
export type SessionContent =
  | { type: 'text'; text: string; previewUrl?: boolean }
  | { type: 'buttons'; text: string; header?: string; footer?: string; buttons: ReplyButton[] }
  | { type: 'list'; text: string; header?: string; footer?: string; button: string; sections: ListSection[] }
  | { type: 'cta_url'; text: string; header?: string; footer?: string; displayText: string; url: string };

export type MessageContent = TemplateContent | SessionContent;

export type OutboundTemplate = OutboundBase & TemplateContent;
export type OutboundMessage = OutboundBase & MessageContent;

export type SendResult =
  | { ok: true; providerMessageId: string }
  | {
      ok: false;
      /** `true` = vale a pena tentar outra vez (rede, 5xx, 429, crédito). */
      retryable: boolean;
      code: string;
      error: string;
      retryAfterMs?: number;
    };

export type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface InboundMedia {
  /** Id da media no fornecedor — descarrega-se com `downloadMedia`. */
  id: string;
  mimeType: string | null;
  caption: string | null;
}

export type WebhookEvent =
  | { kind: 'status'; providerMessageId: string; status: DeliveryStatus; error?: string }
  | {
      kind: 'inbound';
      providerMessageId: string;
      /** Número da loja que recebeu (id do fornecedor). */
      senderId: string;
      /** Cliente, E.164 com `+`. */
      from: string;
      /** Texto escrito, título do botão tocado ou legenda da imagem; `null` sem texto. */
      text: string | null;
      /** Id do botão ou da linha de lista tocada — é por ele que a conversa decide, não pelo título. */
      replyId: string | null;
      /** Nome do perfil WhatsApp, quando o fornecedor o manda. Sugestão, nunca identidade. */
      profileName: string | null;
      media: InboundMedia | null;
      contentType: string;
    }
  | { kind: 'ignored'; type: string };

/** Um evento com o id que o deduplica. Uma entrega de webhook pode trazer vários (Meta). */
export interface WebhookDelivery {
  eventId: string;
  event: WebhookEvent;
}

/** Só o que o adaptador precisa dos cabeçalhos — serve `Headers` e objectos de teste. */
export interface HeaderReader {
  get(name: string): string | null;
}

export type MediaDownload =
  | { ok: true; bytes: Uint8Array; mimeType: string }
  | { ok: false; retryable: boolean; error: string };

export interface WhatsAppTransport {
  readonly name: string;
  send(message: OutboundMessage): Promise<SendResult>;
  /** Verifica a assinatura sobre o corpo **cru**, antes de qualquer `JSON.parse`. */
  verifyWebhook(rawBody: string, headers: HeaderReader, nowMs?: number): boolean;
  /** Eventos com o seu id. `null` = entrega malformada (sem id para deduplicar). */
  parseWebhook(payload: unknown, headers: HeaderReader): WebhookDelivery[] | null;
  /** Aperto de mão `GET ?hub.challenge` (Meta). `null` = recusar. */
  verifyChallenge?(query: URLSearchParams): string | null;
  /** Descarrega a media de uma mensagem recebida (comprovativos). */
  downloadMedia?(mediaId: string): Promise<MediaDownload>;
}
