/**
 * Perfis e o que cada um vê — e onde pode entrar — no painel.
 *
 * A base de dados já recusa o que estes perfis não podem ler nem escrever:
 * isto não é a fechadura, é a porta. Mas a porta tem de estar fechada também
 * para quem escreve o endereço à mão. Até aqui o menu escondia a aba e a rota
 * abria na mesma: o Balcão entrava em /marketing pelo URL, via o ecrã com
 * "Erro a carregar" e podia carregar em Guardar — um update que a RLS recusa
 * sem erro (0 linhas), com ar de ter gravado. Mostrar treze separadores a quem
 * só usa dois ensina a equipa a clicar em coisas que não guardam, e a
 * desconfiar do sistema.
 *
 * `kitchen` não entra de todo: tem o ecrã dela.
 */

export type StaffRole = 'owner' | 'manager' | 'cashier' | 'kitchen';

export const ROLE_LABEL: Record<StaffRole, string> = {
  owner: 'Dono',
  manager: 'Gerente',
  cashier: 'Balcão',
  kitchen: 'Cozinha',
};

export type AdminNavItem = {
  href: string;
  label: string;
  icon: string;
  badge?: boolean;
  roles: StaffRole[];
};

export const ADMIN_NAV: AdminNavItem[] = [
  { href: '/pedidos', label: 'Pedidos', icon: 'pedidos', badge: true, roles: ['owner', 'manager', 'cashier'] },
  { href: '/cardapio', label: 'Cardápio', icon: 'cardapio', roles: ['owner', 'manager'] },
  { href: '/mesas', label: 'Mesas', icon: 'mesas', roles: ['owner', 'manager'] },
  { href: '/caixa', label: 'Caixa', icon: 'caixa', roles: ['owner', 'manager', 'cashier'] },
  { href: '/estoque', label: 'Estoque', icon: 'estoque', roles: ['owner', 'manager'] },
  { href: '/analise', label: 'Análise', icon: 'analise', roles: ['owner', 'manager'] },
  { href: '/feedback', label: 'Avaliações', icon: 'feedback', roles: ['owner', 'manager'] },
  { href: '/lista-espera', label: 'Clientes', icon: 'clientes', roles: ['owner', 'manager'] },
  { href: '/marketing', label: 'Marketing', icon: 'marketing', roles: ['owner', 'manager'] },
  { href: '/lojas', label: 'Lojas', icon: 'lojas', roles: ['owner', 'manager'] },
  { href: '/definicoes-pos', label: 'POS', icon: 'pos', roles: ['owner', 'manager'] },
  { href: '/equipa', label: 'Equipa', icon: 'equipa', roles: ['owner'] },
  { href: '/aparencia', label: 'Aparência', icon: 'aparencia', roles: ['owner'] },
  { href: '/sistema', label: 'Sistema', icon: 'sistema', roles: ['owner', 'manager'] },
  { href: '/definicoes', label: 'Definições', icon: 'definicoes', roles: ['owner'] },
];

function normalize(pathname: string): string {
  const semBarra = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return semBarra || '/';
}

/**
 * A aba a que um caminho pertence: `/pedidos` e `/pedidos/123` são Pedidos.
 * Compara por segmento, não por prefixo de texto — `/definicoes-pos` não é
 * `/definicoes` (o gerente tem uma e não tem a outra).
 */
export function navItemForPath(pathname: string): AdminNavItem | null {
  const caminho = normalize(pathname);
  return (
    ADMIN_NAV.find((item) => caminho === item.href || caminho.startsWith(`${item.href}/`)) ?? null
  );
}

/**
 * Pode este perfil abrir este caminho do painel?
 *
 * Um caminho que não pertence a nenhuma aba fica **fechado por omissão** para
 * quem não é dono: uma página nova esquecida fora do menu não abre sozinha ao
 * Balcão. (Um teste obriga cada página do painel a ter a sua entrada aqui.)
 */
export function canAccessAdminPath(role: StaffRole, pathname: string): boolean {
  if (role === 'kitchen') return false;
  const item = navItemForPath(pathname);
  if (!item) return role === 'owner';
  return item.roles.includes(role);
}

/** Para onde mandar quem abriu o que não pode: a primeira aba do seu perfil. */
export function firstAllowedHref(role: StaffRole): string {
  return ADMIN_NAV.find((item) => item.roles.includes(role))?.href ?? '/';
}
