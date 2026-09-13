'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { createClient } from '@/utils/supabase/client';
import { getPaymentMode } from '@delivery/core';

/**
 * Pagamento da loja — como o dinheiro entra nesta unidade.
 *
 * O que este ecrã **não** faz, de propósito: mostrar credenciais. Um segredo
 * que entra nunca mais sai — nem para o dono. O que se vê é se cada campo está
 * preenchido; para trocar uma chave, escreve-se a nova por cima. Se se perder,
 * pede-se outra ao fornecedor. É mais seguro do que ter um ecrã capaz de a
 * revelar (CLAUDE.md §5.6 · §17).
 */

type Provider = 'manual' | 'mock' | 'paysuite' | 'mpesa' | 'mpesa_sim';

interface PaymentStatus {
  payment_provider: Provider;
  emola_provider: 'manual' | 'mock' | 'paysuite' | null;
  paysuite: { api_key: boolean; webhook_secret: boolean };
  mpesa: {
    api_key: boolean;
    public_key: boolean;
    service_provider_code: boolean;
    session_base_url: boolean;
    charge_base_url: boolean;
    query_base_url: boolean;
  };
  mpesa_number: string | null;
  emola_number: string | null;
}

const PROVIDERS: { value: Provider; label: string; hint: string }[] = [
  { value: 'manual', label: 'Comprovativo', hint: 'O cliente paga e envia o comprovativo. Alguém confere.' },
  { value: 'mpesa', label: 'M-Pesa directo', hint: 'Pedido de PIN no telemóvel do cliente. Sem gateway pelo meio.' },
  { value: 'mpesa_sim', label: 'M-Pesa simulado', hint: 'Para ensaiar sem dinheiro a sério. Nunca em produção.' },
  { value: 'paysuite', label: 'Paysuite', hint: 'M-Pesa, e-Mola e cartão através do gateway.' },
];

/** Campos do M-Pesa que têm de estar todos preenchidos para a cobrança funcionar. */
const MPESA_FIELDS: { key: keyof PaymentStatus['mpesa']; payload: string; label: string; hint?: string }[] = [
  { key: 'api_key', payload: 'mpesa_api_key', label: 'Chave da API' },
  { key: 'public_key', payload: 'mpesa_public_key', label: 'Chave pública' },
  { key: 'service_provider_code', payload: 'mpesa_service_provider_code', label: 'Código do comerciante' },
  {
    key: 'session_base_url',
    payload: 'mpesa_session_base_url',
    label: 'Endereço — sessão',
    hint: 'Inclui a porta. Confirma no portal da Vodacom: muda por operação e por ambiente.',
  },
  { key: 'charge_base_url', payload: 'mpesa_charge_base_url', label: 'Endereço — cobrança' },
  { key: 'query_base_url', payload: 'mpesa_query_base_url', label: 'Endereço — consulta de estado' },
];

export function PaymentSection({ storeId, storeName }: { storeId: string; storeName: string }) {
  const supabase = useMemo(() => createClient(), []);

  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'erro'; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_store_payment_status', { p_store_id: storeId });
    if (error) {
      setMessage({ tone: 'erro', text: `Não foi possível ler o pagamento: ${error.message}` });
      return;
    }
    setStatus(data as PaymentStatus);
    setRascunho({});
  }, [supabase, storeId]);

  useEffect(() => {
    load();
  }, [load]);

  async function guardar(patch: Record<string, string>) {
    setSaving(true);
    setMessage(null);
    const { data, error } = await supabase.rpc('save_store_payment', {
      p_store_id: storeId,
      p_payload: patch,
    });
    setSaving(false);

    if (error) {
      setMessage({ tone: 'erro', text: error.message.includes('pending_payments_provider_change')
        ? 'Existem pagamentos pendentes nesta loja. Resolve-os antes de mudar o gateway; podes corrigir as credenciais.'
        : `Não guardou: ${error.message}` });
      return;
    }
    setStatus(data as PaymentStatus);
    setRascunho({});
    setMessage({ tone: 'ok', text: 'Pagamento actualizado.' });
  }

  if (!status) return <p className="text-sm text-[#8b8378]">A carregar o pagamento…</p>;

  const usaMpesa = status.payment_provider === 'mpesa';
  const emFalta = MPESA_FIELDS.filter((campo) => !status.mpesa[campo.key]);
  const emolaMode = getPaymentMode(status.payment_provider, status.emola_provider, 'emola');
  const usaPaysuite = status.payment_provider === 'paysuite' || emolaMode === 'paysuite';

  return (
    <section className="rounded-2xl border border-white/[0.08] p-5 space-y-5">
      <div>
        <h2 className="font-black text-white">Pagamento — {storeName}</h2>
        <p className="mt-1 text-sm text-[#8b8378]">
          As credenciais entram aqui e não voltam a sair. Para trocar uma chave, escreve a nova por
          cima; para a remover, guarda o campo vazio.
        </p>
      </div>

      {message && (
        <p
          className={`rounded-xl px-4 py-3 text-sm ${
            message.tone === 'ok'
              ? 'border border-emerald-800 bg-emerald-900/20 text-emerald-300'
              : 'border border-red-800 bg-red-900/20 text-red-300'
          }`}
        >
          {message.text}
        </p>
      )}

      {/* ── Como esta loja recebe ─────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2">
        {PROVIDERS.map((opcao) => {
          const activo = status.payment_provider === opcao.value;
          return (
            <button
              key={opcao.value}
              type="button"
              disabled={saving}
              onClick={() => guardar({ payment_provider: opcao.value })}
              className={`rounded-xl border p-4 text-left transition-colors disabled:opacity-50 ${
                activo
                  ? 'border-[#e5a93c] bg-[#e5a93c]/[0.08]'
                  : 'border-white/10 hover:bg-white/[0.04]'
              }`}
            >
              <span className={`block font-bold ${activo ? 'text-[#e5a93c]' : 'text-white'}`}>
                {opcao.label}
              </span>
              <span className="mt-1 block text-xs text-[#8b8378]">{opcao.hint}</span>
            </button>
          );
        })}
      </div>

      {status.payment_provider === 'mpesa_sim' && (
        <p className="rounded-xl border border-[#e5a93c]/40 bg-[#e5a93c]/[0.07] px-4 py-3 text-sm text-[#e5a93c]">
          Esta loja está a <strong>simular</strong> pagamentos: nada é cobrado a sério. Serve para
          ensaiar — não para vender.
        </p>
      )}

      {/* ── Credenciais do M-Pesa ─────────────────────────────────────── */}
      {(usaMpesa || status.payment_provider === 'mpesa_sim') && (
        <div className="space-y-4">
          {usaMpesa && emFalta.length > 0 && (
            <p className="rounded-xl border border-[#7a2b2b] bg-[#2a1616] px-4 py-3 text-sm text-[#ffb0b0]">
              Falta preencher {emFalta.length} campo(s): {emFalta.map((c) => c.label).join(', ')}.
              Enquanto faltarem, o checkout cai no comprovativo manual em vez de cobrar.
            </p>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {MPESA_FIELDS.map((campo) => (
              <label key={campo.payload} className="block">
                <span className="flex items-center gap-2 text-xs text-[#C9BCAC]">
                  {campo.label}
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      status.mpesa[campo.key]
                        ? 'bg-emerald-900/40 text-emerald-300'
                        : 'bg-white/[0.06] text-[#8b8378]'
                    }`}
                  >
                    {status.mpesa[campo.key] ? 'preenchido' : 'por preencher'}
                  </span>
                </span>
                <input
                  type={campo.payload.includes('url') || campo.payload.includes('code') ? 'text' : 'password'}
                  autoComplete="off"
                  value={rascunho[campo.payload] ?? ''}
                  onChange={(e) => setRascunho({ ...rascunho, [campo.payload]: e.target.value })}
                  placeholder={status.mpesa[campo.key] ? '••••••  (escreve para substituir)' : 'por preencher'}
                  className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-3 py-2 text-sm text-white placeholder:text-[#6b6357]"
                />
                {campo.hint && <span className="mt-1 block text-[11px] text-[#6b6357]">{campo.hint}</span>}
              </label>
            ))}
          </div>

          <button
            type="button"
            disabled={saving || Object.keys(rascunho).length === 0}
            onClick={() => guardar(rascunho)}
            className="rounded-xl bg-[#e5a93c] px-5 py-3 text-sm font-black text-black disabled:opacity-50"
          >
            {saving ? 'A guardar…' : 'Guardar credenciais'}
          </button>
        </div>
      )}

      <div className="space-y-3 border-t border-white/[0.06] pt-5">
        <label className="block">
          <span className="font-bold text-white">e-Mola online</span>
          <span className="mt-1 block text-xs text-[#8b8378]">
            Escolhe como receber e-Mola nesta loja. O caminho do M-Pesa mantém a configuração acima.
          </span>
          <select
            aria-label="e-Mola online"
            disabled={saving}
            value={status.emola_provider ?? ''}
            onChange={(event) => guardar({ emola_provider: event.target.value })}
            className="mt-2 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-3 py-3 text-sm text-white"
          >
            <option value="">Seguir configuração da loja</option>
            <option value="manual">Comprovativo manual</option>
            <option value="paysuite">Pagamento online por Paysuite</option>
            <option value="mock">Simulação — sem dinheiro real</option>
          </select>
        </label>
        <p className="text-xs text-[#C9BCAC]">
          {emolaMode === 'manual'
            ? 'e-Mola recebe por comprovativo. Para pagamento automático, configura o gateway e valida a integração antes de activar.'
            : emolaMode === 'mock'
              ? 'e-Mola está em simulação. Nenhum dinheiro é cobrado; usa apenas em testes.'
              : 'e-Mola encaminha o cliente para o checkout seguro do Paysuite.'}
        </p>
      </div>

      {usaPaysuite && (
        <div className="space-y-4 rounded-xl border border-white/10 p-4">
          <div>
            <h3 className="font-bold text-white">Paysuite — conta desta loja</h3>
            <p className="mt-1 text-xs text-[#8b8378]">
              O e-Mola activado separadamente exige a chave e o segredo desta loja. Guarda ambos antes de testar.
            </p>
          </div>
          {(!status.paysuite.api_key || !status.paysuite.webhook_secret) && (
            <p className="text-sm text-[#ffb0b0]">Faltam credenciais do Paysuite nesta loja. O caminho separado de e-Mola permanece indisponível até estarem preenchidas.</p>
          )}
          {([
            ['paysuite_api_key', 'Chave da API', status.paysuite.api_key],
            ['paysuite_webhook_secret', 'Segredo do webhook', status.paysuite.webhook_secret],
          ] as const).map(([field, label, present]) => (
            <label key={field} className="block text-xs text-[#C9BCAC]">
              {label} · {present ? 'preenchido' : 'por preencher'}
              <input type="password" autoComplete="off" value={rascunho[field] ?? ''}
                onChange={(event) => setRascunho({ ...rascunho, [field]: event.target.value })}
                placeholder={present ? 'Escreve para substituir' : 'Por preencher'}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-3 py-2 text-sm text-white" />
            </label>
          ))}
          <button type="button" disabled={saving || Object.keys(rascunho).length === 0}
            onClick={() => guardar(rascunho)}
            className="rounded-xl bg-[#e5a93c] px-5 py-3 text-sm font-black text-black disabled:opacity-50">
            {saving ? 'A guardar…' : 'Guardar credenciais Paysuite'}
          </button>
        </div>
      )}

      {/* ── Números mostrados no fluxo manual ─────────────────────────── */}
      <div className="grid gap-4 border-t border-white/[0.06] pt-5 lg:grid-cols-2">
        <label className="block">
          <span className="text-xs text-[#C9BCAC]">Número M-Pesa (comprovativo)</span>
          <input
            value={rascunho.mpesa_number ?? status.mpesa_number ?? ''}
            onChange={(e) => setRascunho({ ...rascunho, mpesa_number: e.target.value })}
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-3 py-2 text-sm text-white"
          />
        </label>
        <label className="block">
          <span className="text-xs text-[#C9BCAC]">Número e-Mola (comprovativo)</span>
          <input
            value={rascunho.emola_number ?? status.emola_number ?? ''}
            onChange={(e) => setRascunho({ ...rascunho, emola_number: e.target.value })}
            className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-3 py-2 text-sm text-white"
          />
        </label>
      </div>
    </section>
  );
}
