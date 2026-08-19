import Image from 'next/image';
import Link from 'next/link';
import { brand } from '@brand';

import { createClient } from '@/utils/supabase/server';
import {
  maputoDow,
  publicStoreListSchema,
  storeStatusLabel,
  todaysHours,
  type PublicStoreOption,
} from '@/lib/public-stores';

// A escolha da loja é a primeira decisão do cliente: zonas, horários, preços e
// disponibilidade passam todos a ser dessa unidade (CLAUDE §5.5 e §13).
export const dynamic = 'force-dynamic';

const ST = brand.storefront;

async function loadStores(): Promise<PublicStoreOption[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('list_public_stores');
    if (error) return [];
    return publicStoreListSchema.parse(data ?? []);
  } catch {
    return [];
  }
}

export default async function StoreChooserPage() {
  const stores = await loadStores();
  const dow = maputoDow();

  return (
    <div className="relative mx-auto w-full max-w-[480px] min-h-screen" style={{ background: ST.bg }}>
      <header className="px-6 pt-12 pb-8 text-center">
        <Image
          src={ST.logoImage}
          alt={brand.name}
          width={120}
          height={120}
          className="mx-auto"
          priority
        />
        <h1
          className="mt-6"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 30,
            letterSpacing: '2px',
            color: ST.text,
            textTransform: 'uppercase',
          }}
        >
          Escolhe a tua loja
        </h1>
        <p className="mt-3 text-sm" style={{ color: ST.muted }}>
          {ST.hero.subtitle}
        </p>
      </header>

      <main className="px-5 pb-16">
        {stores.length === 0 && (
          <p
            className="rounded-2xl p-5 text-center text-sm"
            style={{ background: ST.card, border: `1px solid ${ST.line}`, color: ST.muted }}
          >
            Não foi possível carregar as lojas agora. Actualiza a página dentro de instantes.
          </p>
        )}

        <ul className="flex flex-col gap-4">
          {stores.map((store) => (
            <li key={store.slug}>
              <Link
                href={`/l/${store.slug}`}
                className="block rounded-2xl p-5 transition-transform active:scale-[0.99]"
                style={{ background: ST.card, border: `1px solid ${ST.line}` }}
              >
                <span className="flex items-center justify-between gap-3">
                  <span
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 22,
                      letterSpacing: '1.4px',
                      color: ST.text,
                      textTransform: 'uppercase',
                    }}
                  >
                    {store.short_name}
                  </span>
                  <span
                    className="rounded-full px-3 py-1 text-[11px] font-bold uppercase"
                    style={{
                      background: store.accepting_orders && store.open_now
                        ? 'rgba(34,197,94,.15)'
                        : 'rgba(255,255,255,.06)',
                      color: store.accepting_orders && store.open_now ? '#7ee2a0' : ST.muted2,
                    }}
                  >
                    {store.accepting_orders && store.open_now ? 'Aberta' : 'Fechada'}
                  </span>
                </span>

                <span className="mt-2 block text-sm" style={{ color: ST.muted }}>
                  {store.address ?? 'Morada por confirmar'}
                </span>
                <span className="mt-1 block text-xs" style={{ color: ST.muted2 }}>
                  {todaysHours(store, dow)} · {storeStatusLabel(store)}
                </span>

                <span className="mt-4 flex flex-wrap gap-2 text-[11px] uppercase" style={{ color: ST.muted2 }}>
                  {store.delivery_enabled && (
                    <span
                      className="rounded-full px-3 py-1"
                      style={{ border: `1px solid ${ST.line}` }}
                    >
                      Entrega
                    </span>
                  )}
                  {store.pickup_enabled && (
                    <span
                      className="rounded-full px-3 py-1"
                      style={{ border: `1px solid ${ST.line}` }}
                    >
                      Levantamento
                    </span>
                  )}
                </span>

                <span
                  className="mt-5 block w-full rounded-xl py-3 text-center"
                  style={{
                    background: ST.grad,
                    fontFamily: 'var(--font-display)',
                    fontSize: 14,
                    letterSpacing: '1.2px',
                    color: ST.text,
                    textTransform: 'uppercase',
                  }}
                >
                  Ver cardápio de {store.short_name}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-center text-xs" style={{ color: ST.muted2 }}>
          {brand.storefront.contact.phone} · {brand.storefront.contact.instagram}
        </p>
      </main>
    </div>
  );
}
