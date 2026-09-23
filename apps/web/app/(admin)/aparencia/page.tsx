'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createClient } from '@/utils/supabase/client';

/**
 * Aparência — a marca deixa de ser um ficheiro de código e passa a ser um ecrã.
 *
 * É este ecrã que torna verdade o "instalar noutro restaurante sem tocar em
 * código" (CLAUDE.md §18.2). O que se grava aqui vai para `brand_settings` por
 * `update_brand()` — só o dono, sempre logado em `event_log`.
 *
 * O que **não** se edita aqui: horário, zonas, números de pagamento e estado da
 * loja. Isso é operação da unidade e vive na aba **Lojas** (§5.6). Um campo
 * duplicado nos dois sítios é um campo que vai ficar diferente nos dois sítios.
 */

type Json = Record<string, unknown>;

type BrandRow = {
  name: string;
  tagline: string;
  legal_name: string | null;
  nuit: string | null;
  logo_path: string | null;
  favicon_path: string | null;
  og_image_path: string | null;
  receipt_footer_default: string | null;
  social: Json;
  contact: Json;
  theme: Json;
  storefront: Json;
};

const EMPTY: BrandRow = {
  name: '',
  tagline: '',
  legal_name: null,
  nuit: null,
  logo_path: null,
  favicon_path: null,
  og_image_path: null,
  receipt_footer_default: null,
  social: {},
  contact: {},
  theme: {},
  storefront: {},
};

const str = (source: Json, key: string): string => {
  const value = source?.[key];
  return typeof value === 'string' ? value : '';
};

/** Lê `a.b.c` de um jsonb aninhado sem rebentar quando o caminho não existe. */
function deepGet(source: Json, path: string): string {
  let node: unknown = source;
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null) return '';
    node = (node as Json)[key];
  }
  return typeof node === 'string' ? node : '';
}

/** Escreve `a.b.c` num jsonb aninhado, criando os níveis que faltarem. */
function deepSet(source: Json, path: string, value: string): Json {
  const keys = path.split('.');
  const out: Json = { ...source };
  let node = out;
  for (const key of keys.slice(0, -1)) {
    const current = node[key];
    const next: Json = typeof current === 'object' && current !== null ? { ...(current as Json) } : {};
    node[key] = next;
    node = next;
  }
  node[keys[keys.length - 1]] = value;
  return out;
}

export default function AparenciaPage() {
  const supabase = useMemo(() => createClient(), []);

  const [row, setRow] = useState<BrandRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'erro'; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_brand');
    if (error) {
      setMessage({ kind: 'erro', text: `Não foi possível ler a marca: ${error.message}` });
      setRow({ ...EMPTY });
      return;
    }
    // Sem linha ainda (instalação nova): o formulário abre vazio e o primeiro
    // gravar cria a marca. A loja, entretanto, corre com o fallback de fábrica.
    setRow({ ...EMPTY, ...((data as Partial<BrandRow> | null) ?? {}) });
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!row) return;
    setSaving(true);
    setMessage(null);

    const { error } = await supabase.rpc('update_brand', {
      p_patch: {
        name: row.name,
        tagline: row.tagline,
        legal_name: row.legal_name ?? '',
        nuit: row.nuit ?? '',
        logo_path: row.logo_path ?? '',
        favicon_path: row.favicon_path ?? '',
        og_image_path: row.og_image_path ?? '',
        receipt_footer_default: row.receipt_footer_default ?? '',
        social: row.social,
        contact: row.contact,
        theme: row.theme,
        storefront: row.storefront,
      },
    });

    setSaving(false);
    if (error) {
      setMessage({ kind: 'erro', text: `Não guardou: ${error.message}` });
      return;
    }
    setMessage({
      kind: 'ok',
      text: 'Marca guardada. A loja pública actualiza dentro de um minuto.',
    });
    load();
  }

  if (!row) return <p className="text-[#C9BCAC] text-sm">A carregar a marca…</p>;

  const set = (patch: Partial<BrandRow>) => setRow({ ...row, ...patch });
  const setTheme = (key: string, value: string) => set({ theme: { ...row.theme, [key]: value } });
  const setStore = (path: string, value: string) => set({ storefront: deepSet(row.storefront, path, value) });

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Aparência</h1>
          <p className="text-sm text-[#C9BCAC] mt-1 max-w-2xl">
            O nome, as cores e os textos da loja pública. O que está em branco cai na marca de
            fábrica — a loja nunca abre sem identidade.
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="bg-[#F5A623] text-[#2A1710] text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-[#D6860F] transition-colors disabled:opacity-50"
        >
          {saving ? 'A guardar…' : 'Guardar'}
        </button>
      </header>

      {message && (
        <p
          className={`text-sm rounded-lg px-4 py-3 border ${
            message.kind === 'ok'
              ? 'text-emerald-300 bg-emerald-900/20 border-emerald-800'
              : 'text-red-400 bg-red-900/20 border-red-800'
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
        <div className="space-y-6">
          <Card title="Identidade">
            <Field label="Nome" value={row.name} onChange={(v) => set({ name: v })} placeholder="Nome do restaurante" />
            <Field label="Descrição curta" value={row.tagline} onChange={(v) => set({ tagline: v })} placeholder="Aparece no separador do browser e nas partilhas" />
            <Field label="Nome legal" value={row.legal_name ?? ''} onChange={(v) => set({ legal_name: v })} placeholder="Só para documentos — opcional" />
            <Field label="NUIT" value={row.nuit ?? ''} onChange={(v) => set({ nuit: v })} placeholder="Opcional" />
            <Field
              label="Rodapé do talão"
              value={row.receipt_footer_default ?? ''}
              onChange={(v) => set({ receipt_footer_default: v })}
              placeholder="Texto no fim do talão de todas as lojas"
            />
          </Card>

          <Card title="Imagens">
            <ImageField
              label="Logo"
              value={row.logo_path ?? ''}
              onChange={(v) => set({ logo_path: v })}
              supabase={supabase}
              onError={(text) => setMessage({ kind: 'erro', text })}
            />
            <ImageField
              label="Favicon"
              value={row.favicon_path ?? ''}
              onChange={(v) => set({ favicon_path: v })}
              supabase={supabase}
              onError={(text) => setMessage({ kind: 'erro', text })}
            />
            <ImageField
              label="Imagem de partilha"
              value={row.og_image_path ?? ''}
              onChange={(v) => set({ og_image_path: v })}
              supabase={supabase}
              onError={(text) => setMessage({ kind: 'erro', text })}
            />
          </Card>

          <Card title="Cores">
            <div className="grid grid-cols-2 gap-4">
              <ColorField label="Primária" value={str(row.theme, 'gold')} onChange={(v) => setTheme('gold', v)} />
              <ColorField label="Primária escura" value={str(row.theme, 'goldDeep')} onChange={(v) => setTheme('goldDeep', v)} />
              <ColorField label="Destaque" value={str(row.theme, 'ember')} onChange={(v) => setTheme('ember', v)} />
              <ColorField label="Fundo" value={str(row.theme, 'bg1')} onChange={(v) => setTheme('bg1', v)} />
              <ColorField label="Texto" value={str(row.theme, 'ink')} onChange={(v) => setTheme('ink', v)} />
              <ColorField label="Texto suave" value={str(row.theme, 'inkDim')} onChange={(v) => setTheme('inkDim', v)} />
            </div>
            <p className="text-xs text-[#8A7F70]">
              As cores entram na loja por variáveis CSS em runtime: guardar aqui muda a montra sem
              novo deploy.
            </p>
          </Card>

          <Card title="Montra">
            <Field label="Marca no cabeçalho" value={deepGet(row.storefront, 'logoText')} onChange={(v) => setStore('logoText', v)} placeholder="Texto curto, em maiúsculas" />
            <Field label="Assinatura da marca" value={deepGet(row.storefront, 'landing.wordmarkTag')} onChange={(v) => setStore('landing.wordmarkTag', v)} placeholder="Ex.: Cozinha local" />
            <div className="grid grid-cols-3 gap-3">
              <Field label="Título — início" value={deepGet(row.storefront, 'landing.hero.titleLead')} onChange={(v) => setStore('landing.hero.titleLead', v)} />
              <Field label="Título — destaque" value={deepGet(row.storefront, 'landing.hero.titleAccent')} onChange={(v) => setStore('landing.hero.titleAccent', v)} />
              <Field label="Título — fim" value={deepGet(row.storefront, 'landing.hero.titleTail')} onChange={(v) => setStore('landing.hero.titleTail', v)} placeholder="{loja} vira o nome da loja" />
            </div>
            <Field label="Subtítulo" value={deepGet(row.storefront, 'landing.hero.subtitle')} onChange={(v) => setStore('landing.hero.subtitle', v)} />
            <Field label="Cardápio — título" value={deepGet(row.storefront, 'landing.menu.title')} onChange={(v) => setStore('landing.menu.title', v)} />
            <Field label="Cardápio — texto" value={deepGet(row.storefront, 'landing.menu.lead')} onChange={(v) => setStore('landing.menu.lead', v)} />
            <Field label="Rodapé — direitos" value={deepGet(row.storefront, 'landing.footer.rights')} onChange={(v) => setStore('landing.footer.rights', v)} placeholder="© 2026 …" />
          </Card>

          <Card title="Redes e contactos">
            <Field label="Instagram (link)" value={str(row.social, 'instagram')} onChange={(v) => set({ social: { ...row.social, instagram: v } })} placeholder="https://instagram.com/…" />
            <Field label="Facebook (link)" value={str(row.social, 'facebook')} onChange={(v) => set({ social: { ...row.social, facebook: v } })} />
            <Field label="WhatsApp (link)" value={str(row.social, 'whatsapp')} onChange={(v) => set({ social: { ...row.social, whatsapp: v } })} placeholder="https://wa.me/258…" />
            {/* Vira o QR do rodapé do talão dos pedidos online. Sem ele, o QR é o do Instagram. */}
            <Field label="Avaliação no Google (link)" value={str(row.social, 'google_review')} onChange={(v) => set({ social: { ...row.social, google_review: v } })} placeholder="https://g.page/r/…/review" />
            <Field label="Telefone" value={str(row.contact, 'phone')} onChange={(v) => set({ contact: { ...row.contact, phone: v } })} />
            <Field label="Instagram (@)" value={str(row.contact, 'instagram')} onChange={(v) => set({ contact: { ...row.contact, instagram: v } })} />
            <Field label="Morada" value={str(row.contact, 'addressLine1')} onChange={(v) => set({ contact: { ...row.contact, addressLine1: v } })} />
            <p className="text-xs text-[#8A7F70]">
              Vazio esconde o ícone ou a linha. Nada aqui aparece meio preenchido na loja.
            </p>
          </Card>
        </div>

        <Preview row={row} />
      </div>
    </div>
  );
}

/* ─────────────────────────── peças do formulário ────────────────────────── */

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] rounded-lg p-5 space-y-4">
      <h3 className="text-sm font-semibold text-[#F5A623]">{title}</h3>
      {children}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-[#C9BCAC] mb-1.5">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-black/30 border border-white/[0.10] rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#6B6357] focus:outline-none focus:border-[#F5A623]"
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const valid = /^#[0-9a-f]{6}$/i.test(value);
  return (
    <label className="block">
      <span className="block text-xs text-[#C9BCAC] mb-1.5">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={valid ? value : '#000000'}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-9 rounded border border-white/[0.10] bg-transparent p-0.5"
          aria-label={`${label} — selector de cor`}
        />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="#000000"
          className="flex-1 bg-black/30 border border-white/[0.10] rounded-lg px-3 py-2 text-sm text-white font-mono placeholder:text-[#6B6357] focus:outline-none focus:border-[#F5A623]"
        />
      </div>
    </label>
  );
}

/**
 * Caminho de imagem com carregamento para o bucket `brand-assets`.
 *
 * Aceita também um endereço escrito à mão: quem já tem o logo algures não é
 * obrigado a carregá-lo outra vez.
 */
function ImageField({
  label,
  value,
  onChange,
  supabase,
  onError,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  supabase: ReturnType<typeof createClient>;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-');
    const path = `${Date.now()}-${safeName}`;
    const { error } = await supabase.storage.from('brand-assets').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    });
    setBusy(false);

    if (error) {
      onError(`Não carregou ${label.toLowerCase()}: ${error.message}`);
      return;
    }
    const { data } = supabase.storage.from('brand-assets').getPublicUrl(path);
    onChange(data.publicUrl);
  }

  return (
    <div className="space-y-2">
      <Field label={label} value={value} onChange={onChange} placeholder="/assets/… ou https://…" />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="text-xs text-[#F5A623] border border-[#F5A623]/40 rounded-md px-3 py-1.5 hover:bg-[#F5A623]/10 disabled:opacity-50"
        >
          {busy ? 'A carregar…' : 'Carregar ficheiro'}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="text-xs text-[#8A7F70] hover:text-[#C9BCAC]"
          >
            Remover
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload(file);
            event.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

/**
 * Pré-visualização ao vivo. Não é a loja: é o suficiente para o dono ver que a
 * cor que escolheu não deixa o texto ilegível antes de a pôr à frente de
 * clientes.
 */
function Preview({ row }: { row: BrandRow }) {
  const bg = str(row.theme, 'bg1') || '#111111';
  const ink = str(row.theme, 'ink') || '#f2f0ec';
  const dim = str(row.theme, 'inkDim') || '#c4c0b8';
  const primary = str(row.theme, 'gold') || '#c8a24a';

  return (
    <aside className="lg:sticky lg:top-6 space-y-3">
      <h3 className="text-sm font-semibold text-[#F5A623]">Como fica</h3>
      <div className="rounded-lg overflow-hidden border border-white/[0.08]" style={{ background: bg }}>
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            {row.logo_path ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.logo_path} alt="" className="h-8 w-8 rounded-full object-cover" />
            ) : (
              <span className="h-8 w-8 rounded-full" style={{ background: primary }} />
            )}
            <span className="text-sm font-bold tracking-wide" style={{ color: ink }}>
              {deepGet(row.storefront, 'logoText') || row.name || 'A tua marca'}
            </span>
          </div>

          <p className="text-lg font-bold leading-tight" style={{ color: ink }}>
            {deepGet(row.storefront, 'landing.hero.titleLead') || 'Encomenda agora.'}{' '}
            <span style={{ color: primary }}>
              {deepGet(row.storefront, 'landing.hero.titleAccent') || 'Recebes'}
            </span>
          </p>
          <p className="text-xs" style={{ color: dim }}>
            {deepGet(row.storefront, 'landing.hero.subtitle') || row.tagline || 'Pagamento móvel · Entrega'}
          </p>

          <span
            className="inline-block text-xs font-semibold rounded-md px-3 py-1.5"
            style={{ background: primary, color: bg }}
          >
            {deepGet(row.storefront, 'landing.hero.ctaMenu') || 'Ver Menu'}
          </span>
        </div>
      </div>
      <p className="text-xs text-[#8A7F70]">
        A loja pública lê a marca com cache de um minuto: depois de guardar, actualiza a página da
        loja passado esse tempo.
      </p>
    </aside>
  );
}
