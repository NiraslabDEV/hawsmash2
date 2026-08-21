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

import './_hawsmash/landing.css';

// A escolha da loja é a primeira decisão do cliente: zonas, horários, preços e
// disponibilidade passam todos a ser dessa unidade (CLAUDE §5.5 e §13).
export const dynamic = 'force-dynamic';

const L = brand.storefront.landing;

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
    <div className="hs">
      <div className="hs-chooser">
        <Image
          className="hs-chooser-logo"
          src={L.logoCircle}
          alt={brand.name}
          width={148}
          height={148}
          priority
        />

        <h1>Escolhe a tua loja</h1>
        <p className="hs-chooser-sub">
          Cada casa tem o seu horário, as suas entregas e o seu stock. Escolhe onde queres comer
          e o cardápio abre já com os preços dessa loja.
        </p>

        {stores.length === 0 && (
          <div className="hs-notice" style={{ maxWidth: 460 }}>
            <h3>Lojas indisponíveis</h3>
            <p>Não foi possível carregar as lojas agora. Actualiza a página dentro de instantes.</p>
          </div>
        )}

        <div className="hs-chooser-grid">
          {stores.map((store) => {
            const open = store.accepting_orders && store.open_now;
            return (
              <Link key={store.slug} href={`/l/${store.slug}`} className="hs-store-card">
                <span className="hs-store-card-head">
                  <span className="hs-store-card-name">{store.short_name}</span>
                  <span className={`hs-badge ${open ? 'is-open' : 'is-closed'}`}>
                    {open ? 'Aberta' : 'Fechada'}
                  </span>
                </span>

                <span className="hs-store-card-meta" style={{ display: 'block' }}>
                  {store.address ?? 'Morada por confirmar'}
                </span>
                <span className="hs-store-card-hours" style={{ display: 'block' }}>
                  {todaysHours(store, dow)} · {storeStatusLabel(store)}
                </span>

                <span className="hs-chips">
                  {store.delivery_enabled && <span className="hs-chip-tag">Entrega</span>}
                  {store.pickup_enabled && <span className="hs-chip-tag">Levantamento</span>}
                </span>

                <span className="hs-store-card-cta">Ver cardápio de {store.short_name}</span>
              </Link>
            );
          })}
        </div>

        <p style={{ marginTop: 40, fontSize: 12, color: 'var(--hs-ink-mute)', textAlign: 'center' }}>
          {brand.storefront.contact.phone} · {brand.storefront.contact.instagram}
        </p>
      </div>
    </div>
  );
}
