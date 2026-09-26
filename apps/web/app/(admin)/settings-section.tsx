'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';

// ─── Tipos ────────────────────────────────────────────────────────────────────

// Só o que é da EMPRESA (CLAUDE §5.1). Números de pagamento, morada, horário e
// abrir/fechar são de cada loja e editam-se na aba Lojas — os campos antigos do
// singleton ficaram na BD, mas já não se mostram nem se gravam aqui: o checkout
// multi-loja ignora-os, e um "Aceitando pedidos" que não fecha nada mente.
interface Settings {
  id: number;
  owner_email: string | null;
  upsell_enabled: boolean;
  upsell_title: string;
  upsell_subtitle: string;
}

// ─── Secção ───────────────────────────────────────────────────────────────────

export function SettingsSection() {
  const supabase = createClient();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [editing, setEditing] = useState<Settings | null>(null);
  const [error, setError] = useState('');

  const refetch = useCallback(async () => {
    const { data } = await supabase.from('settings')
      .select('id,owner_email,upsell_enabled,upsell_title,upsell_subtitle').eq('id', 1).single();
    setSettings(data as Settings);
  }, [supabase]);

  useEffect(() => { refetch(); }, [refetch]);

  async function save(s: Settings) {
    setError('');
    const { error: err } = await supabase
      .from('settings')
      .update({
        owner_email: s.owner_email,
        upsell_enabled: s.upsell_enabled,
        upsell_title: s.upsell_title,
        upsell_subtitle: s.upsell_subtitle,
      })
      .eq('id', 1);
    if (err) { setError(`Erro ao guardar definições: ${err.message}`); return; }
    refetch();
  }

  if (!settings) {
    return <p className="text-[#C9BCAC] text-sm">A carregar definições…</p>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-4 py-3">{error}</p>
      )}

      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-[#F5A623]">Definições do Restaurante</h3>
        <button
          onClick={() => setEditing(settings)}
          className="bg-[#F5A623] text-[#2A1710] text-sm font-semibold px-4 py-2 rounded-lg hover:bg-[#D6860F] transition-colors"
        >
          Editar
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] rounded-lg p-4">
          <h4 className="text-sm font-semibold text-[#F5A623] mb-3">Cada loja</h4>
          <p className="text-sm text-[#C9BCAC]">
            Números M-Pesa e e-Mola, morada, horário e abrir/fechar são de cada loja — estão na
            aba <strong className="text-white">Lojas</strong>.
          </p>
        </div>

        <div className="border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] rounded-lg p-4">
          <h4 className="text-sm font-semibold text-[#F5A623] mb-3">Oferta no fim do pedido (loja online)</h4>
          <p className="text-sm text-[#C9BCAC]">{settings.upsell_enabled ? 'Ligada' : 'Desligada'}</p>
        </div>

        <div className="border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] rounded-lg p-4">
          <h4 className="text-sm font-semibold text-[#F5A623] mb-3">Email</h4>
          <p className="text-sm text-[#C9BCAC]">{settings.owner_email || 'Não definido'}</p>
        </div>
      </div>

      {editing && (
        <SettingsModal
          settings={editing}
          onClose={() => setEditing(null)}
          onSaved={(s) => { save(s); setEditing(null); }}
        />
      )}
    </div>
  );
}

// ─── Modal de definições ───────────────────────────────────────────────────────

function SettingsModal({
  settings, onClose, onSaved,
}: {
  settings: Settings;
  onClose: () => void;
  onSaved: (s: Settings) => void;
}) {
  const [ownerEmail, setOwnerEmail] = useState(settings.owner_email ?? '');
  const [upsellEnabled, setUpsellEnabled] = useState(settings.upsell_enabled ?? true);
  const [upsellTitle, setUpsellTitle] = useState(settings.upsell_title ?? '');
  const [upsellSubtitle, setUpsellSubtitle] = useState(settings.upsell_subtitle ?? '');

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-[4px] z-50 flex items-center justify-center p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSaved({
            ...settings,
            owner_email: ownerEmail || null,
            upsell_enabled: upsellEnabled,
            upsell_title: upsellTitle.trim() || 'Falta alguma coisa?',
            upsell_subtitle: upsellSubtitle.trim() || 'Uma bebida gelada cai sempre bem com o smash.',
          });
        }}
        className="border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] rounded-2xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="font-bold text-lg text-[#F5A623]">Editar Definições</h2>

        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-[#F5A623] mb-2">Pagamentos, morada, horário e estado</h3>
            {/* Cada loja abre e fecha na sua ficha: aqui seria um interruptor
                da empresa, que o checkout multi-loja ignora (CLAUDE §5.6). */}
            <p className="text-xs text-[#C9BCAC]">
              São de cada loja: editam-se na aba <strong className="text-white">Lojas</strong> (abrir ou
              fechar com motivo registado). Estas definições são da empresa, não de uma unidade.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[#F5A623] mb-2">Oferta no fim do pedido</h3>
            {/* Que itens são oferecidos escolhe-se no Cardápio ("Oferecer no fim
                do pedido"); aqui decide-se se o ecrã aparece e o que diz. */}
            <label className="flex items-center gap-2 text-xs font-semibold text-[#C9BCAC] mb-2">
              <input
                type="checkbox"
                checked={upsellEnabled}
                onChange={(e) => setUpsellEnabled(e.target.checked)}
                className="rounded bg-black/20 border-white/[0.08] text-[#F5A623] focus:ring-[#F5A623]"
              />
              Mostrar o ecrã de oferta antes do pagamento
            </label>
            <input
              type="text"
              value={upsellTitle}
              onChange={(e) => setUpsellTitle(e.target.value)}
              placeholder="Falta alguma coisa?"
              className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623] mb-2"
            />
            <input
              type="text"
              value={upsellSubtitle}
              onChange={(e) => setUpsellSubtitle(e.target.value)}
              placeholder="Uma bebida gelada cai sempre bem com o smash."
              className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
            />
            <p className="text-[11px] text-[#C9BCAC]/70 mt-1">
              Os itens oferecidos marcam-se no <strong className="text-white">Cardápio</strong>.
              Sem nada marcado, o ecrã salta sozinho — nunca trava o pedido.
            </p>
            {/* Até à 1067 este interruptor também desligava o funil do balcão.
                Agora o balcão tem o seu, por loja — dizê-lo evita o "desliguei e
                o POS continua a oferecer". */}
            <p className="text-[11px] text-[#C9BCAC]/70 mt-1">
              Isto é a loja online. O upsell do balcão (passos e frases) configura-se por loja na
              aba <strong className="text-white">POS</strong>.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[#F5A623] mb-2">Email</h3>
            <input
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="Email para notificações"
              className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-white/[0.08] text-[#C9BCAC] font-semibold py-3 rounded-xl text-sm hover:bg-white/[0.08] transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="flex-1 bg-[#F5A623] text-[#2A1710] font-bold py-3 rounded-xl text-sm hover:bg-[#D6860F] transition-colors"
          >
            Guardar
          </button>
        </div>
      </form>
    </div>
  );
}
