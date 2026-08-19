import Image from 'next/image';
import Link from 'next/link';
import { brand } from '@brand';

// Casa do Bom Pasteleiro: ao contrário do template (Home = redirect direto para
// /menu), este cliente pediu uma página institucional na raiz — quem está
// numa mesa física chega ao cardápio (sem pagamento) só via QR (/m/[token]),
// nunca por aqui. Esta home só liga ao cardápio de DELIVERY.
//
// Estrutura, medidas e textos portados 1:1 do protótipo aprovado pelo cliente
// (o bundle `exemplo/Casa do Bom Pasteleiro.html` — a revisão final).
const ST = brand.storefront;
const C = ST.contact;
const ASSETS = '/assets/casa-do-bom-pasteleiro';

// Fotos recortadas do protótipo (sem o texto impresso do cartaz).
const GALLERY = [
  { name: 'Picanha', photo: `${ASSETS}/d/picanha.png` },
  { name: 'Rib Eye', photo: `${ASSETS}/d/rib-eye.png` },
  { name: 'Camarão', photo: `${ASSETS}/d/camarao.png` },
  { name: 'Bacalhau', photo: `${ASSETS}/d/bacalhau.png` },
  { name: 'Smash duplo', photo: `${ASSETS}/d/smash-duplo.png` },
  { name: 'Breakfast', photo: `${ASSETS}/d/breakfast.png` },
];

const PILLARS = [
  { n: '01', t: 'Grelha em brasa, cortes pesados ao grama' },
  { n: '02', t: 'Pastelaria e pão feitos na casa, todos os dias' },
  { n: '03', t: 'Entrega em Maputo · levantamento no balcão' },
];

export default function InstitutionalHomePage() {
  return (
    <div
      className="mx-auto w-full max-w-[430px]"
      style={{ background: ST.bg, color: ST.text, minHeight: '100vh' }}
    >
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <header
        style={{
          padding: '66px 24px 30px',
          background: `linear-gradient(${ST.card} 0%, ${ST.surface2} 100%)`,
          textAlign: 'center',
        }}
      >
        <Image
          src={ST.logoImage}
          alt={brand.name}
          width={236}
          height={232}
          priority
          sizes="236px"
          style={{ display: 'block', width: 236, height: 'auto', margin: '0 auto' }}
        />

        <div style={{ color: ST.star, fontSize: 11, letterSpacing: '6px', margin: '14px 0 12px' }}>★★★</div>

        <p
          style={{
            fontSize: 14.5,
            lineHeight: 1.55,
            color: ST.muted,
            maxWidth: 290,
            margin: '0 auto',
          }}
        >
          {ST.hero.subtitle}
        </p>

        <Link
          href="/menu"
          className="items-center"
          style={{
            margin: '22px auto 4px',
            display: 'inline-flex',
            gap: 11,
            padding: '15px 24px',
            background: ST.grad,
            borderRadius: 999,
            boxShadow: '0 10px 22px rgba(232,135,26,.34)',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 15,
              letterSpacing: '1.6px',
              color: ST.text,
              textTransform: 'uppercase',
            }}
          >
            Ver cardápio de delivery
          </span>
          <svg width="26" height="14" viewBox="0 0 26 14" fill="none" aria-hidden>
            <path d="M2 8c6 5 15 5 21-3" stroke={ST.text} strokeWidth="2.4" strokeLinecap="round" />
            <path d="M18 1l6 4-7 4" stroke={ST.text} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>

        <div
          className="flex justify-center"
          style={{
            gap: 18,
            marginTop: 16,
            fontSize: 10.5,
            letterSpacing: '1.4px',
            textTransform: 'uppercase',
            color: ST.muted2,
            fontWeight: 600,
          }}
        >
          <span>Entrega 30–45 min</span>
          <span style={{ color: ST.primary2 }}>·</span>
          <span>Levantamento</span>
        </div>
      </header>

      {/* ── Prato em destaque ────────────────────────────────────────────── */}
      <section style={{ padding: '26px 20px 4px' }}>
        <Link
          href="/menu"
          className="relative block overflow-hidden"
          style={{ borderRadius: 20, background: ST.text, boxShadow: '0 16px 32px rgba(42,23,16,.22)' }}
        >
          <Image
            src={`${ASSETS}/d/tomahawk-500gr.png`}
            alt="Tomahawk 500 gr"
            width={430}
            height={230}
            sizes="430px"
            style={{ width: '100%', height: 230, objectFit: 'cover', display: 'block', opacity: 0.95 }}
          />
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(rgba(42,23,16,0) 30%, rgba(42,23,16,.9) 100%)' }}
          />
          <div
            className="absolute"
            style={{
              top: 14,
              left: 16,
              padding: '6px 11px',
              background: ST.primary,
              borderRadius: 999,
              fontFamily: 'var(--font-display)',
              fontSize: 11,
              letterSpacing: '1.6px',
              color: ST.text,
              textTransform: 'uppercase',
            }}
          >
            Especial fim de semana
          </div>
          <div className="absolute" style={{ left: 16, bottom: 16, right: 120 }}>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 34,
                lineHeight: 0.92,
                color: ST.onDark,
                textTransform: 'uppercase',
              }}
            >
              Tomahawk
            </div>
            <div style={{ color: ST.primary, fontSize: 10, letterSpacing: '4px', marginTop: 4 }}>★★★ 500 GR</div>
          </div>
          <div
            className="absolute flex flex-col items-center justify-center"
            style={{
              right: 14,
              bottom: 14,
              width: 96,
              height: 96,
              borderRadius: 999,
              background: ST.text,
              border: `2px solid ${ST.primary}`,
              boxShadow: '0 8px 18px rgba(0,0,0,.4)',
            }}
          >
            <span
              style={{
                fontSize: 8.5,
                letterSpacing: '2.2px',
                color: ST.primary,
                textTransform: 'uppercase',
                fontWeight: 700,
              }}
            >
              Apenas
            </span>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 31, lineHeight: 1, color: ST.onDark }}>
              1.200
            </span>
            <span style={{ fontSize: 9, letterSpacing: '2.6px', color: ST.primary, fontWeight: 700 }}>— MT —</span>
          </div>
        </Link>
      </section>

      {/* ── Galeria ──────────────────────────────────────────────────────── */}
      <section style={{ padding: '28px 20px 0' }}>
        <div className="flex items-center" style={{ gap: 12, marginBottom: 14 }}>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 19,
              letterSpacing: '1.2px',
              color: ST.text,
              textTransform: 'uppercase',
            }}
          >
            Da nossa cozinha
          </h2>
          <div style={{ flex: 1, height: 1, background: 'rgba(42,23,16,.12)' }} />
          <div style={{ color: ST.star, fontSize: 9, letterSpacing: '3px' }}>★★★</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {GALLERY.map((g) => (
            <div
              key={g.name}
              className="relative overflow-hidden"
              style={{ borderRadius: 14, aspectRatio: '1 / 1', background: ST.photoBg }}
            >
              <Image src={g.photo} alt={g.name} fill sizes="205px" style={{ objectFit: 'cover' }} />
              <div
                className="absolute"
                style={{
                  inset: 'auto 0 0 0',
                  padding: '22px 10px 9px',
                  background: 'linear-gradient(rgba(42,23,16,0), rgba(42,23,16,.88))',
                  fontFamily: 'var(--font-display)',
                  fontSize: 12.5,
                  letterSpacing: '.8px',
                  color: ST.onDark,
                  textTransform: 'uppercase',
                }}
              >
                {g.name}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── A casa ───────────────────────────────────────────────────────── */}
      <section
        style={{
          margin: '28px 20px 0',
          padding: '22px 20px',
          background: ST.card,
          border: `1px solid ${ST.line}`,
          borderRadius: 18,
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 19,
            letterSpacing: '1.2px',
            color: ST.text,
            textTransform: 'uppercase',
          }}
        >
          A casa
        </h2>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: ST.muted, marginTop: 8 }}>
          Começámos como confeitaria. Hoje somos também cozinha: cortes nobres na grelha, bacalhau de forno e o
          pequeno-almoço montado à sua maneira — servido todo o dia.
        </p>

        <div className="flex flex-col" style={{ gap: 11, marginTop: 16 }}>
          {PILLARS.map((p) => (
            <div key={p.n} className="flex items-center" style={{ gap: 11 }}>
              <div
                className="flex items-center justify-center"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  border: `1.5px solid ${ST.primary}`,
                  flex: 'none',
                }}
              >
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: ST.primary2 }}>{p.n}</span>
              </div>
              <div style={{ fontSize: 13, color: ST.textSoft, fontWeight: 500 }}>{p.t}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Rodapé ───────────────────────────────────────────────────────── */}
      <footer style={{ margin: '26px 0 0', padding: '24px 20px 46px', background: ST.text, textAlign: 'center' }}>
        <div style={{ color: ST.primary, fontSize: 10, letterSpacing: '4px' }}>★★★</div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 17,
            letterSpacing: '1px',
            color: ST.onDark,
            textTransform: 'uppercase',
            margin: '10px 0 4px',
          }}
        >
          {C.addressLine1}
        </div>
        <div style={{ fontSize: 12.5, color: ST.onDarkMuted }}>{C.addressLine2}</div>
        <div
          className="flex justify-center"
          style={{ gap: 14, marginTop: 14, fontSize: 12.5, color: ST.primary, fontWeight: 600 }}
        >
          <span>{C.phone}</span>
          <span style={{ color: 'rgba(255,253,248,.3)' }}>|</span>
          <span>{C.instagram}</span>
        </div>
      </footer>
    </div>
  );
}
