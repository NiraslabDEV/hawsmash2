'use client';

import Image from 'next/image';
import { brand } from '@brand';

import { maputoDow, todaysHours, type PublicStoreOption } from '@/lib/public-stores';

import { ArrowIcon, CartIcon } from './icons';

const L = brand.storefront.landing;

/* ─────────────────────────── HERO ─────────────────────────── */

export function Hero({
  store,
  onCartOpen,
  cartCount,
}: {
  store: PublicStoreOption;
  onCartOpen: () => void;
  cartCount: number;
}) {
  const open = store.accepting_orders && store.open_now;
  const hours = todaysHours(store, maputoDow());

  // A última linha do título é a loja escolhida: quem chega sabe logo onde
  // está a encomendar (o 1.0 não precisava disto — era loja única).
  const tail = L.hero.titleTail.replace('{loja}', store.short_name);

  const channels = [store.delivery_enabled && 'Entrega', store.pickup_enabled && 'Levantamento']
    .filter(Boolean)
    .join(' · ');

  return (
    <section className="hs-hero" id="topo">
      <div className="hs-container hs-hero-inner">
        <Image
          className="hs-hero-logo"
          src={L.logoCircle}
          alt={brand.name}
          width={220}
          height={220}
          priority
        />

        <span className="hs-now-strip">
          <span className={`hs-live-dot${open ? '' : ' is-off'}`} />
          {open ? 'A aceitar pedidos agora' : 'Fora do horário · aceita agendamento'}
        </span>

        <h1 className="hs-display hs-hero-title">
          {L.hero.titleLead}
          <br />
          <span className="hs-gold">{L.hero.titleAccent}</span> {tail}
        </h1>

        <p className="hs-hero-sub">{L.hero.subtitle}</p>

        <div className="hs-hero-ctas">
          <a href="#cardapio" className="hs-btn hs-btn-gold">
            {L.hero.ctaMenu} <ArrowIcon />
          </a>
          <button type="button" className="hs-btn hs-btn-ghost" onClick={onCartOpen}>
            <CartIcon size={16} />
            {cartCount > 0 ? `${L.hero.ctaCart} (${cartCount})` : L.hero.ctaCart}
          </button>
        </div>

        <div className="hs-hero-meta">
          <div>
            <div className="k">Loja</div>
            <div className="v">{store.short_name}</div>
          </div>
          <div>
            <div className="k">Hoje</div>
            <div className="v is-gold">{hours}</div>
          </div>
          {channels && (
            <div>
              <div className="k">Como recebes</div>
              <div className="v">{channels}</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────── MARQUEE ───────────────────────── */

export function Marquee() {
  // Duplicado de propósito: a animação anda -50% e o segundo bloco entra
  // exactamente onde o primeiro saiu, sem salto.
  const items = [...L.marquee, ...L.marquee];
  return (
    <div className="hs-marquee" aria-hidden>
      <div className="hs-marquee-track">
        {items.map((text, i) => (
          <span key={`${text}-${i}`} className="hs-marquee-item">
            {text}
            <span className="hs-dot" />
          </span>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── HISTÓRIA ─────────────────────── */

export function Story() {
  return (
    <section className="hs-section" id="historia">
      <div className="hs-container hs-story-grid">
        <div>
          <span className="hs-eyebrow">{L.story.eyebrow}</span>
          <h2>
            {L.story.titleLead} <span className="hs-gold">{L.story.titleAccent}</span>.
            <br />
            {L.story.titleTail}
          </h2>
          {L.story.paragraphs.map((text) => (
            <p key={text.slice(0, 24)}>{text}</p>
          ))}
          <div className="hs-stats">
            {L.story.stats.map((stat) => (
              <div key={stat.l} className="hs-stat">
                <div className="n">{stat.n}</div>
                <div className="l">{stat.l}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="hs-story-img">
          <Image src={L.storyImage} alt={brand.name} width={720} height={900} />
          <div className="hs-story-tag">
            <div className="k">{L.story.tagKey}</div>
            <div className="v">{L.story.tagValue}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────── RODAPÉ ───────────────────────── */

export function Footer({
  store,
  onCartOpen,
  cartCount,
}: {
  store: PublicStoreOption;
  onCartOpen: () => void;
  cartCount: number;
}) {
  const contact = brand.storefront.contact;

  return (
    <footer className="hs-footer">
      <div className="hs-container">
        <div className="hs-footer-cta">
          <h3>
            {L.footer.ctaLead} <span className="hs-stroke">{L.footer.ctaAccent}</span>
          </h3>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap' }}>
            <button type="button" className="hs-btn hs-btn-gold" onClick={onCartOpen}>
              <CartIcon size={18} />
              {cartCount > 0 ? `Ver Carrinho (${cartCount})` : 'Montar Pedido'}
            </button>
            <a href="#cardapio" className="hs-btn hs-btn-ghost">
              Ver Cardápio
            </a>
          </div>
        </div>

        <div className="hs-footer-grid">
          <div>
            <div className="hs-brand" style={{ marginBottom: 18 }}>
              <span className="hs-brand-mark">
                <Image src={L.logoCircle} alt="" width={40} height={40} />
              </span>
              <span>
                <span className="hs-brand-name">{L.wordmark}</span>
                <span className="hs-brand-tag">{L.wordmarkTag}</span>
              </span>
            </div>
            <p style={{ color: 'var(--hs-ink-dim)', fontSize: 14, maxWidth: 340 }}>{L.footer.blurb}</p>
          </div>

          <div>
            <h4>{store.short_name}</h4>
            <ul>
              {store.address && <li>{store.address}</li>}
              {store.phone && <li>Encomendas · {store.phone}</li>}
              {store.maps_url && (
                <li>
                  <a href={store.maps_url} target="_blank" rel="noopener noreferrer">
                    Ver no mapa
                  </a>
                </li>
              )}
              <li>{store.accepting_orders ? 'A aceitar pedidos' : 'Fechada de momento'}</li>
            </ul>
          </div>

          <div>
            <h4>Segue-nos</h4>
            <ul>
              <li>
                <a href={brand.social.instagram} target="_blank" rel="noopener noreferrer">
                  Instagram · {contact.instagram}
                </a>
              </li>
              <li>
                <a href={brand.social.whatsapp} target="_blank" rel="noopener noreferrer">
                  WhatsApp · {contact.phone}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="hs-footer-bottom">
          <span>{L.footer.rights}</span>
          <span>
            {L.footer.madeIn.replace('Maputo', '')}
            <span className="hs-gold">Maputo</span>
          </span>
        </div>
      </div>
    </footer>
  );
}
