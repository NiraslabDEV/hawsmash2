/**
 * Forma do cardápio tal como `get_menu(p_store_slug)` o devolve.
 *
 * O servidor é a verdade: preço efectivo por loja, disponibilidade já cruzada
 * com o stock, números de pagamento e zonas da loja escolhida (CLAUDE §5.3).
 * O front nunca calcula preço — só mostra.
 */

export interface MenuVariant {
  id: string;
  name: string;
  price_cents: number;
  is_default?: boolean;
  available?: boolean;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  photo_url: string | null;
  available?: boolean;
  variants?: MenuVariant[];
}

export interface MenuCategory {
  id: string;
  name: string;
  items: MenuItem[];
}

export interface MenuStore {
  id: string;
  slug: string;
  name: string;
  short_name: string;
  address: string | null;
  maps_url: string | null;
  phone: string | null;
  delivery_enabled: boolean;
  pickup_enabled: boolean;
  counter_enabled: boolean;
}

export interface MenuHour {
  dow: number;
  opens: string;
  closes: string;
  active: boolean;
}

export interface MenuPayload {
  store: MenuStore;
  categories: MenuCategory[];
  accepting_orders: boolean;
  mpesa_number: string | null;
  mpesa_name: string | null;
  emola_number: string | null;
  emola_name: string | null;
  zones: { id: string; name: string; fee_cents: number; sort: number }[];
  hours: MenuHour[];
}

/** Linha do carrinho já cruzada com o cardápio (para o drawer mostrar nome e preço). */
export interface CartView {
  index: number;
  item: MenuItem;
  variant: MenuVariant | null;
  qty: number;
  unitCents: number;
}
