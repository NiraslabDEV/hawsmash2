/**
 * Esgotado no balcão (1061) — a parte que se testa sem browser.
 *
 * Um produto pode estar fora do cardápio por duas razões diferentes, e o ecrã
 * tem de as distinguir, porque só uma delas se resolve com um toque:
 *
 *   · **esgotado** — alguém disse "acabou". Um toque volta a pôr à venda.
 *   · **sem stock** — o stock está controlado e chegou a zero (§10). Marcar
 *     disponível não o traz de volta: o `get_menu` continua a escondê-lo até
 *     alguém repor quantidade no painel de Estoque. Mostrar um botão aqui
 *     seria prometer uma coisa que o servidor não vai cumprir.
 */

export type AvailabilityRow = {
  available: boolean;
  track_stock: boolean;
  stock_qty: number;
};

export type AvailabilityState = 'disponivel' | 'esgotado' | 'sem_stock';

export function availabilityState(row: AvailabilityRow): AvailabilityState {
  if (!row.available) return 'esgotado';
  if (row.track_stock && row.stock_qty <= 0) return 'sem_stock';
  return 'disponivel';
}

/**
 * O que o toque faz. `null` = não há toque que resolva — é caso para o painel
 * de Estoque, não para o balcão.
 */
export function toggleTarget(state: AvailabilityState): boolean | null {
  switch (state) {
    case 'disponivel':
      return false;
    case 'esgotado':
      return true;
    default:
      return null;
  }
}

/**
 * Quem pode marcar. Espelha a regra do servidor (dono, gerente, caixa — a
 * cozinha não, por decisão do dono) só para o ecrã não mostrar um botão que ia
 * ser recusado. Quem decide é sempre a `set_item_availability`.
 */
export function canMarkAvailability(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'manager' || role === 'cashier';
}
