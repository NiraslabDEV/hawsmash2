'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface MarketingSettings {
  // (A) IDs públicos — vão para o client (carregam scripts)
  gtm_container_id: string | null;
  meta_pixel_id: string | null;
  ga4_measurement_id: string | null;
  gads_conversion_id: string | null;
  gads_conversion_label: string | null;
  // (B) tokens secretos — só servidor
  meta_capi_token: string | null;
  gads_developer_token: string | null;
}

const PUBLIC_FIELDS: {
  key: keyof MarketingSettings;
  label: string;
  placeholder: string;
  help: string;
  helpUrl: string;
}[] = [
  {
    key: 'gtm_container_id',
    label: 'Google Tag Manager — Container ID',
    placeholder: 'GTM-XXXXXX',
    help: 'GTM › Admin › Container Settings',
    helpUrl: 'https://tagmanager.google.com/',
  },
  {
    key: 'meta_pixel_id',
    label: 'Meta Pixel ID',
    placeholder: '123456789012345',
    help: 'Meta Events Manager › Data Sources',
    helpUrl: 'https://business.facebook.com/events_manager2/',
  },
  {
    key: 'ga4_measurement_id',
    label: 'GA4 — Measurement ID',
    placeholder: 'G-XXXXXXXXXX',
    help: 'GA4 › Admin › Data Streams',
    helpUrl: 'https://analytics.google.com/',
  },
  {
    key: 'gads_conversion_id',
    label: 'Google Ads — Conversion ID',
    placeholder: 'AW-123456789',
    help: 'Google Ads › Goals › Conversions',
    helpUrl: 'https://ads.google.com/',
  },
  {
    key: 'gads_conversion_label',
    label: 'Google Ads — Conversion Label',
    placeholder: 'AbCdEfGhIjK',
    help: 'Google Ads › detalhe da conversão de compra',
    helpUrl: 'https://ads.google.com/',
  },
];

const SECRET_FIELDS: {
  key: keyof MarketingSettings;
  label: string;
  help: string;
  helpUrl: string;
}[] = [
  {
    key: 'meta_capi_token',
    label: 'Meta — Conversions API Token',
    help: 'Events Manager › Settings › Conversions API › Gerar token',
    helpUrl: 'https://business.facebook.com/events_manager2/',
  },
  {
    key: 'gads_developer_token',
    label: 'Google Ads — Developer Token',
    help: 'Google Ads › API Center',
    helpUrl: 'https://ads.google.com/aw/apicenter',
  },
];

const EMPTY: MarketingSettings = {
  gtm_container_id: null,
  meta_pixel_id: null,
  ga4_measurement_id: null,
  gads_conversion_id: null,
  gads_conversion_label: null,
  meta_capi_token: null,
  gads_developer_token: null,
};

// Mostra o token mascarado: ••••1234 (últimos 4). Nunca repete o valor inteiro.
function maskToken(v: string | null): string {
  if (!v) return '';
  const tail = v.slice(-4);
  return `••••${tail}`;
}

export function MarketingSection() {
  const supabase = createClient();
  const [form, setForm] = useState<MarketingSettings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  // Quais segredos estão a ser editados (senão mostra mascarado e não toca)
  const [editingSecret, setEditingSecret] = useState<Record<string, boolean>>({});

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('settings')
      .select(
        'gtm_container_id, meta_pixel_id, ga4_measurement_id, gads_conversion_id, gads_conversion_label, meta_capi_token, gads_developer_token',
      )
      .eq('id', 1)
      .single();
    if (err) {
      setError(`Erro a carregar: ${err.message}`);
    } else if (data) {
      setForm({ ...EMPTY, ...data });
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  function setField(key: keyof MarketingSettings, value: string) {
    setForm((f) => ({ ...f, [key]: value === '' ? null : value }));
    setOk('');
  }

  async function save() {
    setSaving(true);
    setError('');
    setOk('');

    // Só envia os segredos que o utilizador escolheu substituir.
    const payload: Partial<MarketingSettings> = {
      gtm_container_id: form.gtm_container_id,
      meta_pixel_id: form.meta_pixel_id,
      ga4_measurement_id: form.ga4_measurement_id,
      gads_conversion_id: form.gads_conversion_id,
      gads_conversion_label: form.gads_conversion_label,
    };
    for (const { key } of SECRET_FIELDS) {
      if (editingSecret[key]) payload[key] = form[key];
    }

    const { error: err } = await supabase.from('settings').update(payload).eq('id', 1);
    if (err) {
      setError(`Erro ao guardar: ${err.message}`);
    } else {
      setOk('Configuração de marketing guardada.');
      setEditingSecret({});
      await refetch();
    }
    setSaving(false);
  }

  // Preview do dataLayer que o storefront vai empurrar (com os IDs actuais).
  const dataLayerPreview = JSON.stringify(
    {
      gtm: form.gtm_container_id || '(vazio)',
      ga4: form.ga4_measurement_id || '(vazio)',
      meta_pixel: form.meta_pixel_id || '(vazio)',
      google_ads_send_to:
        form.gads_conversion_id && form.gads_conversion_label
          ? `${form.gads_conversion_id}/${form.gads_conversion_label}`
          : '(incompleto)',
    },
    null,
    2,
  );

  if (loading) {
    return <p className="text-sm text-[#C9BCAC]">A carregar configuração...</p>;
  }

  return (
    <div className="space-y-8 max-w-3xl">
      {error && <p className="text-sm text-red-400 bg-red-950/40 rounded-lg px-4 py-3">{error}</p>}
      {ok && <p className="text-sm text-green-400 bg-green-950/40 rounded-lg px-4 py-3">{ok}</p>}

      {/* (A) IDs públicos */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-[#F5A623]">IDs de rastreio (públicos)</h2>
          <p className="text-sm text-[#C9BCAC]">
            Carregam os scripts no site. Cole e guarde — sem mexer em ficheiros.
          </p>
        </div>
        {PUBLIC_FIELDS.map(({ key, label, placeholder, help, helpUrl }) => (
          <div key={key} className="space-y-1">
            <label className="block text-sm font-medium text-[#F3E4CE]">{label}</label>
            <input
              type="text"
              value={(form[key] as string | null) ?? ''}
              onChange={(e) => setField(key, e.target.value)}
              placeholder={placeholder}
              className="w-full rounded-lg bg-black/30 border border-white/[0.08] px-3 py-2 text-sm text-[#F3E4CE] focus:border-[#F5A623] focus:outline-none"
            />
            <a
              href={helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-[#C9BCAC] hover:text-[#F5A623]"
            >
              onde encontrar: {help} ↗
            </a>
          </div>
        ))}
      </section>

      {/* (B) tokens secretos */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-[#F5A623]">Tokens secretos (servidor)</h2>
          <p className="text-sm text-[#C9BCAC]">
            Usados só no servidor (Meta CAPI / Google Ads). Nunca vão para o site.
          </p>
        </div>
        {SECRET_FIELDS.map(({ key, label, help, helpUrl }) => {
          const isEditing = editingSecret[key];
          const stored = form[key] as string | null;
          return (
            <div key={key} className="space-y-1">
              <label className="block text-sm font-medium text-[#F3E4CE]">{label}</label>
              {isEditing ? (
                <input
                  type="password"
                  autoComplete="new-password"
                  value={stored ?? ''}
                  onChange={(e) => setField(key, e.target.value)}
                  placeholder="colar novo token"
                  className="w-full rounded-lg bg-black/30 border border-white/[0.08] px-3 py-2 text-sm text-[#F3E4CE] focus:border-[#F5A623] focus:outline-none"
                />
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[#C9BCAC] font-mono">
                    {stored ? maskToken(stored) : 'não definido'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingSecret((s) => ({ ...s, [key]: true }))}
                    className="text-xs text-[#F5A623] hover:underline"
                  >
                    {stored ? 'Substituir' : 'Definir'}
                  </button>
                </div>
              )}
              <a
                href={helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#C9BCAC] hover:text-[#F5A623]"
              >
                onde encontrar: {help} ↗
              </a>
            </div>
          );
        })}
      </section>

      {/* Preview do dataLayer */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-[#F5A623]">Preview do dataLayer</h2>
        <pre className="rounded-lg bg-black/30 border border-white/[0.08] px-4 py-3 text-xs text-[#C9BCAC] overflow-x-auto">
          {dataLayerPreview}
        </pre>
      </section>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded-lg bg-[#F5A623] px-6 py-2.5 text-sm font-semibold text-[#2A1710] hover:bg-[#D6860F] disabled:opacity-60"
      >
        {saving ? 'A guardar...' : 'Guardar configuração'}
      </button>
    </div>
  );
}
