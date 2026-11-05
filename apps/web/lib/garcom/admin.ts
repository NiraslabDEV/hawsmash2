/** Frases do painel para os códigos das RPCs de garçons (1122). */
const MENSAGENS: Record<string, string> = {
  waiter_access_denied: 'Sem permissão para isto nesta loja.',
  waiter_phone_taken: 'Já há um garçom activo com este telefone.',
  invalid_waiter_phone: 'Telefone inválido — 9 dígitos, ex.: 84 123 4567.',
  invalid_waiter_name: 'Nome inválido (2 a 80 letras).',
  invalid_pin_format: 'O PIN tem 4 a 6 dígitos.',
  waiter_not_found: 'Garçom não encontrado.',
};

export function waiterAdminErrorMessage(message: string | null | undefined): string {
  if (message) {
    for (const [codigo, frase] of Object.entries(MENSAGENS)) {
      if (message.includes(codigo)) return frase;
    }
  }
  return 'Não foi possível. Tenta outra vez.';
}

export type WaiterRow = {
  id: string;
  full_name: string;
  phone: string;
  active: boolean;
  last_seen_at: string | null;
  has_pin: boolean;
  orders_today: number;
  total_today_cents: number;
};
