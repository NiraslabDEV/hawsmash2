'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';

// Configuração de pagamento automático (Paysuite) — mesmo padrão masked do Marketing.
// As chaves são segredos (B): guardadas em settings, lidas só no servidor.

interface PaymentSettings {
  payment_provider: string; // 'manual' | 'mock' | 'paysuite'
  paysuite_api_key: string | null;
  paysuite_webhook_secret: string | null;
}

const EMPTY: PaymentSettings = {
  payment_provider: 'manual',
  paysuite_api_key: null,
  paysuite_webhook_secret: null,
};

const SECRET_FIELDS: { key: keyof PaymentSettings; label: string; help: string }[] = [
  {
    key: 'paysuite_api_key',
    label: 'Paysuite — API Token',
    help: 'Paysuite › Dashboard › API Keys',
  },
  {
    key: 'paysuite_webhook_secret',
    label: 'Paysuite — Webhook Secret',
    help: 'Paysuite › Dashboard › Webhooks (whsec_…)',
  },
];

function maskToken(v: string | null): string {
  if (!v) return '';
  return `••••${v.slice(-4)}`;
}

export function PaysuiteSection() {
  const supabase = createClient();
  const [form, setForm] = useState<PaymentSettings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [editingSecret, setEditingSecret] = useState<Record<string, boolean>>({});
  const [webhookUrl, setWebhookUrl] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setWebhookUrl(`${window.location.origin}/api/webhooks/paysuite`);
    }
  }, []);

  const refetch = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('settings')
      .select('payment_provider, paysuite_api_key, paysuite_webhook_secret')
      .eq('id', 1)
      .single();
    if (err) setError(`Erro a carregar: ${err.message}`);
    else if (data) setForm({ ...EMPTY, ...data });
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function save() {
    setSaving(true);
    setError('');
    setOk('');

    const payload: Partial<PaymentSettings> = { payment_provider: form.payment_provider };
    for (const { key } of SECRET_FIELDS) {
      if (editingSecret[key]) payload[key] = form[key] as never;
    }

    const { error: err } = await supabase.from('settings').update(payload).eq('id', 1);
    if (err) setError(`Erro ao guardar: ${err.message}`);
    else {
      setOk('Configuração de pagamento guardada.');
      setEditingSecret({});
      await refetch();
    }
    setSaving(false);
  }

  if (loading) return <p className="text-sm text-[#C9BCAC]">A carregar configuração…</p>;

  const isPaysuite = form.payment_provider === 'paysuite';

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h3 className="text-lg font-bold text-[#F5A623]">Pagamento Automático (Paysuite)</h3>
        <p className="text-sm text-[#C9BCAC]">
          Cole o token e o webhook secret do Paysuite — sem mexer em ficheiros. As chaves ficam
          guardadas no servidor (nunca vão para o site).
        </p>
      </div>

      {error && <p className="text-sm text-red-400 bg-red-950/40 rounded-lg px-4 py-3">{error}</p>}
      {ok && <p className="text-sm text-green-400 bg-green-950/40 rounded-lg px-4 py-3">{ok}</p>}

      {/* Provider */}
      <div className="space-y-1">
        <label className="block text-sm font-medium text-[#F3E4CE]">Método de pagamento</label>
        <select
          value={form.payment_provider}
          onChange={(e) => {
            setForm((f) => ({ ...f, payment_provider: e.target.value }));
            setOk('');
          }}
          className="w-full rounded-lg bg-black/30 border border-white/[0.08] px-3 py-2 text-sm text-[#F3E4CE] focus:border-[#F5A623] focus:outline-none"
        >
          <option value="manual">Manual (comprovativo M-Pesa/e-Mola)</option>
          <option value="mock">Mock (simulador — para testes)</option>
          <option value="paysuite">Paysuite (automático)</option>
        </select>
        <p className="text-xs text-[#C9BCAC]">
          Com <strong>Paysuite</strong>, o checkout mostra o botão Pagar Agora e redireciona para o
          pagamento seguro.
        </p>
      </div>

      {/* Chaves (só relevantes com Paysuite) */}
      <section className={`space-y-4 ${isPaysuite ? '' : 'opacity-60'}`}>
        {SECRET_FIELDS.map(({ key, label, help }) => {
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
                  onChange={(e) => {
                    setForm((f) => ({ ...f, [key]: e.target.value === '' ? null : e.target.value }));
                    setOk('');
                  }}
                  placeholder="colar nova chave"
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
              <span className="block text-xs text-[#C9BCAC]">onde encontrar: {help}</span>
            </div>
          );
        })}
      </section>

      {/* Webhook URL para colar no painel Paysuite */}
      <div className="space-y-1">
        <label className="block text-sm font-medium text-[#F3E4CE]">
          Webhook URL (colar no painel Paysuite)
        </label>
        <code className="block rounded-lg bg-black/30 border border-white/[0.08] px-3 py-2 text-xs text-[#F5A623] break-all">
          {webhookUrl || '…'}
        </code>
        <p className="text-xs text-[#C9BCAC]">
          No Paysuite, aponta o webhook para este endereço (deste site), não para outro projeto.
        </p>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="rounded-lg bg-[#F5A623] px-6 py-2.5 text-sm font-semibold text-[#2A1710] hover:bg-[#D6860F] disabled:opacity-60"
      >
        {saving ? 'A guardar…' : 'Guardar configuração'}
      </button>
    </div>
  );
}
