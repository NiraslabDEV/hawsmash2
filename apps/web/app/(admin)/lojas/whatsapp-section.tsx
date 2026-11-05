'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { createClient } from '@/utils/supabase/client';
import {
  eventLabel,
  FREE_SERVICE_MESSAGES,
  isMissingMigration,
  maskPhone,
  normalizePhone,
  parsePhoneList,
  saveErrorText,
  statusLabel,
  usageView,
  type StoreWhatsApp,
} from '@/lib/whatsapp/painel';

/**
 * WhatsApp da loja (ADR 0011/0012) — só o dono. Ligar e desligar sem deploy, ver o que saiu e entrou, e contar
 * o mês: é a base do que se cobra ao cliente (B-123). O token da Meta não passa por aqui: vive no servidor.
 */

type Rascunho = { sender_id: string; phone: string; handoff_phone: string; alert_phones: string };
type Enviada = { id: string; created_at: string; event: string; status: string; recipient: string; last_error: string | null };
type Recebida = { id: string; received_at: string; from_phone: string; content_type: string; body: string | null };

const hora = (iso: string) =>
  new Date(iso).toLocaleString('pt-PT', { timeZone: 'Africa/Maputo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const paraRascunho = (w: StoreWhatsApp): Rascunho => ({
  sender_id: w.sender_id ?? '',
  phone: w.phone ?? '',
  handoff_phone: w.handoff_phone ?? '',
  alert_phones: w.alert_phones.join(', '),
});

export function WhatsAppSection({ storeId, storeName }: { storeId: string; storeName: string }) {
  const supabase = useMemo(() => createClient(), []);

  const [whats, setWhats] = useState<StoreWhatsApp | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [enviadas, setEnviadas] = useState<Enviada[]>([]);
  const [recebidas, setRecebidas] = useState<Recebida[]>([]);
  const [semAcesso, setSemAcesso] = useState(false);
  const [semMigration, setSemMigration] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'erro'; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_store_whatsapp', { p_store_id: storeId });
    if (error) {
      if (error.message.includes('forbidden')) setSemAcesso(true);
      else if (isMissingMigration(error.message)) setSemMigration(true);
      else setMessage({ tone: 'erro', text: `Não foi possível ler o WhatsApp: ${error.message}` });
      return;
    }
    const estado = data as StoreWhatsApp;
    setWhats(estado);
    setRascunho(paraRascunho(estado));
    // A RLS (1117) já limita ao dono e a esta loja. Falhar aqui não esconde a configuração.
    const [saidas, entradas] = await Promise.all([
      supabase.from('whatsapp_outbox').select('id,created_at,event,status,recipient,last_error').eq('store_id', storeId).order('created_at', { ascending: false }).limit(15),
      supabase.from('whatsapp_inbound').select('id,received_at,from_phone,content_type,body').eq('store_id', storeId).order('received_at', { ascending: false }).limit(15),
    ]);
    setEnviadas((saidas.data ?? []) as Enviada[]);
    setRecebidas((entradas.data ?? []) as Recebida[]);
  }, [supabase, storeId]);

  useEffect(() => {
    setWhats(null);
    setSemAcesso(false);
    setSemMigration(false);
    setMessage(null);
    void load();
  }, [load]);

  async function guardar(patch: Record<string, unknown>, ok: string) {
    setSaving(true);
    setMessage(null);
    const { data, error } = await supabase.rpc('save_store_whatsapp', { p_store_id: storeId, p_payload: patch });
    setSaving(false);
    if (error) {
      setMessage({ tone: 'erro', text: saveErrorText(error.message) });
      return;
    }
    const estado = data as StoreWhatsApp;
    setWhats(estado);
    setRascunho(paraRascunho(estado));
    setMessage({ tone: 'ok', text: ok });
  }

  function guardarNumeros() {
    if (!rascunho) return;
    const phone = rascunho.phone.trim() ? normalizePhone(rascunho.phone) : '';
    const handoff = rascunho.handoff_phone.trim() ? normalizePhone(rascunho.handoff_phone) : '';
    const alertas = parsePhoneList(rascunho.alert_phones);
    if (phone === null) return setMessage({ tone: 'erro', text: 'O número desta loja não parece um telefone válido.' });
    if (handoff === null) return setMessage({ tone: 'erro', text: 'O número de atendimento não parece um telefone válido.' });
    if (alertas.invalid.length) return setMessage({ tone: 'erro', text: `Não percebi: ${alertas.invalid.join(', ')}.` });
    void guardar(
      { sender_id: rascunho.sender_id, phone, handoff_phone: handoff, alert_phones: alertas.phones },
      'Números guardados.',
    );
  }

  // O gerente não vê esta secção: é configuração e custos da loja.
  if (semAcesso) return null;
  if (semMigration) {
    return (
      <section className="rounded-2xl border border-white/[0.08] p-5">
        <h2 className="font-black text-white">WhatsApp — {storeName}</h2>
        <p className="mt-1 text-sm text-[#8b8378]">Esta secção fica disponível depois de aplicada a actualização 1126 da base de dados.</p>
      </section>
    );
  }
  if (!whats || !rascunho) return <p className="text-sm text-[#8b8378]">A carregar o WhatsApp…</p>;

  const uso = usageView(whats.month);
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
    <section className="rounded-2xl border border-white/[0.08] p-5 space-y-5">
      <div>
        <h2 className="font-black text-white">WhatsApp — {storeName}</h2>
        <p className="mt-1 text-sm text-[#8b8378]">
          Cada loja responde pelo seu número. Sem número ligado, os pedidos desta loja seguem só por email.
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

      {/* ── Uso do mês: é isto que se cobra ─────────────────────────────── */}
      <div className="space-y-3 border-t border-white/[0.06] pt-5">
        <div>
          <h3 className="font-bold text-white">Este mês</h3>
          <p className="mt-1 text-xs text-[#8b8378]">
            A Meta cobra o que foi entregue: os avisos sempre, e as respostas da conversa acima das {FREE_SERVICE_MESSAGES.toLocaleString('pt-PT')} grátis por número.
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { rotulo: 'Mensagens a pagar', valor: uso.chargedTotal, nota: `${uso.chargedTemplates} avisos + ${uso.chargedService} respostas` },
            { rotulo: 'Respostas grátis por usar', valor: uso.freeLeft, nota: `${whats.month.service_delivered} entregues` },
            { rotulo: 'Pedidos pela conversa', valor: whats.month.orders, nota: `${whats.month.inbound} mensagens recebidas` },
            { rotulo: 'Falhadas', valor: whats.month.failed, nota: `${whats.month.waiting} por confirmar entrega` },
          ].map((tile) => (
            <div key={tile.rotulo} className="rounded-xl border border-white/10 p-3">
              <dt className="text-[11px] text-[#8b8378]">{tile.rotulo}</dt>
              <dd className="mt-1 text-xl font-black tabular-nums text-white">{tile.valor.toLocaleString('pt-PT')}</dd>
              <dd className="mt-0.5 text-[11px] text-[#6b6357]">{tile.nota}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* ── O que passou por aqui ───────────────────────────────────────── */}
      <div className="grid gap-5 border-t border-white/[0.06] pt-5 lg:grid-cols-2">
        <div>
          <h3 className="font-bold text-white">Últimas enviadas</h3>
          {enviadas.length === 0 && <p className="mt-2 text-xs text-[#8b8378]">Ainda nada saiu desta loja.</p>}
          <ul className="mt-2 space-y-2">
            {enviadas.map((m) => (
              <li key={m.id} className="rounded-xl border border-white/[0.06] px-3 py-2 text-xs">
                <span className="flex justify-between gap-2 text-white">
                  <span>{eventLabel(m.event)}</span>
                  <span className={m.status === 'failed' ? 'text-red-300' : 'text-[#C9BCAC]'}>{statusLabel(m.status)}</span>
                </span>
                <span className="mt-0.5 block text-[#6b6357]">{hora(m.created_at)} · {maskPhone(m.recipient)}</span>
                {m.status === 'failed' && m.last_error && <span className="mt-1 block text-red-300/80">{m.last_error}</span>}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-bold text-white">Últimas recebidas</h3>
          {recebidas.length === 0 && <p className="mt-2 text-xs text-[#8b8378]">Ainda ninguém escreveu para esta loja.</p>}
          <ul className="mt-2 space-y-2">
            {recebidas.map((m) => (
              <li key={m.id} className="rounded-xl border border-white/[0.06] px-3 py-2 text-xs">
                <span className="block break-words text-white">{m.body?.trim() || `(${m.content_type})`}</span>
                <span className="mt-0.5 block text-[#6b6357]">{hora(m.received_at)} · {maskPhone(m.from_phone)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
