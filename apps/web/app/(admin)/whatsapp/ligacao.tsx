'use client';

import { useEffect, useState } from 'react';

import { normalizePhone, parsePhoneList, type StoreWhatsApp } from '@/lib/whatsapp/painel';

/**
 * Ligar e desligar o WhatsApp da loja sem deploy (ADR 0011/0012). O token da
 * Meta não passa por aqui: vive no servidor.
 */

type Rascunho = { sender_id: string; phone: string; handoff_phone: string; alert_phones: string };
type Guardar = (patch: Record<string, unknown>) => Promise<{ ok: true } | { ok: false; text: string }>;

const paraRascunho = (w: StoreWhatsApp): Rascunho => ({
  sender_id: w.sender_id ?? '',
  phone: w.phone ?? '',
  handoff_phone: w.handoff_phone ?? '',
  alert_phones: w.alert_phones.join(', '),
});

export function WhatsAppLigacao({ whats, save }: { whats: StoreWhatsApp; save: Guardar }) {
  const [rascunho, setRascunho] = useState<Rascunho>(() => paraRascunho(whats));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'erro'; text: string } | null>(null);

  useEffect(() => setRascunho(paraRascunho(whats)), [whats]);

  async function guardar(patch: Record<string, unknown>, ok: string) {
    setSaving(true);
    setMessage(null);
    const r = await save(patch);
    setSaving(false);
    setMessage(r.ok ? { tone: 'ok', text: ok } : { tone: 'erro', text: r.text });
  }

  function guardarNumeros() {
    const phone = rascunho.phone.trim() ? normalizePhone(rascunho.phone) : '';
    const handoff = rascunho.handoff_phone.trim() ? normalizePhone(rascunho.handoff_phone) : '';
    const alertas = parsePhoneList(rascunho.alert_phones);
    if (phone === null) return setMessage({ tone: 'erro', text: 'O número desta loja não parece um telefone válido.' });
    if (handoff === null) return setMessage({ tone: 'erro', text: 'O número de atendimento não parece um telefone válido.' });
    if (alertas.invalid.length) return setMessage({ tone: 'erro', text: `Não percebi: ${alertas.invalid.join(', ')}.` });
    void guardar({ sender_id: rascunho.sender_id, phone, handoff_phone: handoff, alert_phones: alertas.phones }, 'Números guardados.');
  }

  const alterado = JSON.stringify(rascunho) !== JSON.stringify(paraRascunho(whats));

  const interruptores = [
    {
      chave: 'enabled',
      activo: whats.enabled,
      titulo: 'Avisos do pedido',
      texto: 'Pago, pronto, a caminho, entregue. O email continua a sair na mesma.',
      ok: whats.enabled ? 'Avisos desligados nesta loja.' : 'Avisos ligados nesta loja.',
    },
    {
      chave: 'chat_enabled',
      activo: whats.chat_enabled,
      titulo: 'Conversa de pedido',
      texto: 'O cliente pede, paga e manda o comprovativo dentro do WhatsApp. Precisa dos avisos ligados.',
      ok: whats.chat_enabled ? 'Conversa desligada nesta loja.' : 'Conversa ligada nesta loja.',
    },
  ] as const;

  const campos = [
    { chave: 'sender_id', rotulo: 'Id do número na Meta', dica: 'O "Phone number ID" da conta WhatsApp Business. Não é o telefone.', placeholder: '123456789012345' },
    { chave: 'phone', rotulo: 'Telefone desta loja na API', dica: 'Só para referência no painel.', placeholder: '+258 87 000 0000' },
    { chave: 'handoff_phone', rotulo: 'WhatsApp para falar com uma pessoa', dica: 'Um número que fica na app, para o botão "Falar com a loja".', placeholder: '+258 86 000 0000' },
    { chave: 'alert_phones', rotulo: 'Telemóveis que recebem os alertas', dica: 'Até 5, separados por vírgulas. Vazio = os alertas só seguem por email.', placeholder: '+258 84 000 0000, +258 85 000 0000' },
  ] as const;

  return (
    <section className="space-y-5 rounded-2xl border border-white/[0.08] p-5">
      <div>
        <h2 className="font-black text-white">Ligação</h2>
        <p className="mt-1 text-sm text-[#8b8378]">
          Cada loja responde pelo seu número. Sem número ligado, os pedidos desta loja seguem só por email.
        </p>
      </div>

      {message && (
        <p
          role="status"
          className={`rounded-xl px-4 py-3 text-sm ${
            message.tone === 'ok'
              ? 'border border-emerald-800 bg-emerald-900/20 text-emerald-300'
              : 'border border-red-800 bg-red-900/20 text-red-300'
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {interruptores.map((opcao) => (
          <button
            key={opcao.chave}
            type="button"
            role="switch"
            aria-checked={opcao.activo}
            disabled={saving}
            onClick={() => void guardar({ [opcao.chave]: !opcao.activo }, opcao.ok)}
            className={`rounded-xl border p-4 text-left transition-colors disabled:opacity-50 ${
              opcao.activo ? 'border-[#e5a93c] bg-[#e5a93c]/[0.08]' : 'border-white/10 hover:bg-white/[0.04]'
            }`}
          >
            <span className={`block font-bold ${opcao.activo ? 'text-[#e5a93c]' : 'text-white'}`}>
              {opcao.titulo} · {opcao.activo ? 'ligado' : 'desligado'}
            </span>
            <span className="mt-1 block text-xs text-[#8b8378]">{opcao.texto}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {campos.map((campo) => (
          <label key={campo.chave} className="block">
            <span className="text-xs text-[#C9BCAC]">{campo.rotulo}</span>
            <input
              autoComplete="off"
              value={rascunho[campo.chave]}
              placeholder={campo.placeholder}
              onChange={(e) => setRascunho({ ...rascunho, [campo.chave]: e.target.value })}
              className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-3 py-2 text-sm text-white placeholder:text-[#6b6357]"
            />
            <span className="mt-1 block text-[11px] text-[#6b6357]">{campo.dica}</span>
          </label>
        ))}
      </div>

      <button
        type="button"
        disabled={saving || !alterado}
        onClick={guardarNumeros}
        className="rounded-xl bg-[#e5a93c] px-5 py-3 text-sm font-black text-black disabled:opacity-50"
      >
        {saving ? 'A guardar…' : 'Guardar números'}
      </button>
    </section>
  );
}
