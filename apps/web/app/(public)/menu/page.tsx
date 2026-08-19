import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { DEFAULT_STORE_SLUG, STORE_COOKIE, resolveStoreSlug } from '@/lib/store-context';

export const dynamic = 'force-dynamic';

/**
 * `/menu` continua a existir (links antigos, QR, emails) mas passa a ser um
 * atalho para o cardápio da loja escolhida. Sem escolha, cai na loja padrão.
 */
export default async function MenuRedirectPage() {
  const cookieStore = await cookies();
  const saved = cookieStore.get(STORE_COOKIE)?.value;

  let slug = DEFAULT_STORE_SLUG;
  try {
    if (saved) slug = resolveStoreSlug(saved);
  } catch {
    slug = DEFAULT_STORE_SLUG;
  }

  redirect(`/l/${slug}`);
}
