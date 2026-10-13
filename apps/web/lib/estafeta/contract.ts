import { z } from 'zod';

/**
 * Contrato entre o telemóvel do estafeta e `/api/estafeta` (1115).
 *
 * O telemóvel nunca fala com a BD: manda acções pequenas, a rota junta-lhes o
 * token do cookie e chama as RPCs `courier_*` com a service key. Nada aqui
 * decide dinheiro — a taxa do estafeta é calculada na BD.
 */

export const COURIER_COOKIE = 'estafeta_sessao';
/** Igual à validade da sessão na BD (`courier_sessions.expires_at`). */
export const COURIER_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export const loginSchema = z.object({
  phone: z.string().trim().min(9).max(20),
  pin: z.string().regex(/^[0-9]{4,6}$/),
});

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

export const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('shift'), on: z.boolean() }),
  z.object({
    action: z.literal('ping'),
    lat,
    lng,
    accuracy: z.number().nonnegative().max(100_000).optional(),
  }),
  z.object({ action: z.literal('pickup'), deliveryId: z.string().uuid() }),
  z.object({
    action: z.literal('deliver'),
    deliveryId: z.string().uuid(),
    lat: lat.optional(),
    lng: lng.optional(),
  }),
  z.object({ action: z.literal('logout') }),
]);

export type CourierAction = z.infer<typeof actionSchema>;

export type CourierJob = {
  delivery_id: string;
  status: 'assigned' | 'picked_up';
  assigned_at: string;
  picked_up_at: string | null;
  order_id: string;
  order_number: string;
  daily_number: number | null;
  order_status: string;
  customer_name: string;
  customer_phone: string | null;
  address: string | null;
  zone: string | null;
  notes: string | null;
  scheduled_for: string | null;
  fee_cents: number | null;
  items: Array<{ name: string; qty: number }>;
};

export type CourierState = {
  courier: { id: string; full_name: string; on_shift: boolean };
  store: { name: string; short_name: string; phone: string | null; address: string | null } | null;
  jobs: CourierJob[];
  today: { deliveries: number; earned_cents: number };
  balance_cents: number;
  ledger: Array<{
    kind: 'delivery_fee' | 'payout' | 'adjustment';
    amount_cents: number;
    method: string | null;
    created_at: string;
    order_number: string | null;
  }>;
};

const MENSAGENS: Record<string, string> = {
  invalid_credentials: 'Telefone ou PIN errado.',
  pin_not_configured: 'Ainda não tens PIN. Pede ao gerente para o definir.',
  pin_locked: 'Demasiadas tentativas. Espera um pouco e tenta outra vez.',
  courier_session_invalid: 'A sessão terminou. Entra outra vez.',
  delivery_not_found: 'Esta entrega já não é tua. Fala com a loja.',
  order_not_ready: 'O pedido ainda não está pronto na cozinha.',
  order_cancelled: 'Este pedido foi cancelado. Não o leves.',
  invalid_request: 'Pedido inválido.',
};

/** A frase que o estafeta lê, a partir do código que a BD devolve. */
export function courierErrorMessage(code: string | null | undefined): string {
  if (code) {
    for (const [chave, frase] of Object.entries(MENSAGENS)) {
      if (code.includes(chave)) return frase;
    }
  }
  return 'Não foi possível. Verifica a rede e tenta outra vez.';
}

/** O código conhecido dentro de uma mensagem de erro do Postgres, ou null. */
export function courierErrorCode(message: string | null | undefined): string | null {
  if (!message) return null;
  return Object.keys(MENSAGENS).find((k) => message.includes(k)) ?? null;
}

/** Link de navegação para a morada: abre o Google Maps (ou o Waze, se instalado o escolher). */
export function navigationUrl(address: string | null, zone: string | null): string | null {
  const destino = [address, zone].filter((p) => p && p.trim()).join(', ');
  if (!destino) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destino)}`;
}

/** wa.me / tel: com indicativo de Moçambique para um número de 9 dígitos. */
export function phoneHref(phone: string | null): string | null {
  if (!phone) return null;
  const digitos = phone.replace(/\D/g, '');
  if (digitos.length === 9) return `tel:+258${digitos}`;
  if (digitos.length === 12 && digitos.startsWith('258')) return `tel:+${digitos}`;
  return digitos ? `tel:${digitos}` : null;
}
