'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Settings {
  id: number;
  mpesa_number: string | null;
  mpesa_name: string | null;
  emola_number: string | null;
  emola_name: string | null;
  pickup_address: string | null;
  pickup_maps_url: string | null;
  owner_email: string | null;
  open_hour: number;
  close_hour: number;
  slot_minutes: number;
  accepting_orders: boolean;
  payment_provider: string;
}

// ─── Secção ───────────────────────────────────────────────────────────────────

export function SettingsSection() {
  const supabase = createClient();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [editing, setEditing] = useState<Settings | null>(null);
  const [error, setError] = useState('');

  const refetch = useCallback(async () => {
    const { data } = await supabase.from('settings').select('*').eq('id', 1).single();
    setSettings(data as Settings);
  }, [supabase]);

  useEffect(() => { refetch(); }, [refetch]);

  async function save(s: Settings) {
    setError('');
    const { error: err } = await supabase
      .from('settings')
      .update({
        mpesa_number: s.mpesa_number,
        mpesa_name: s.mpesa_name,
        emola_number: s.emola_number,
        emola_name: s.emola_name,
        pickup_address: s.pickup_address,
        pickup_maps_url: s.pickup_maps_url,
        owner_email: s.owner_email,
        open_hour: s.open_hour,
        close_hour: s.close_hour,
        slot_minutes: s.slot_minutes,
        accepting_orders: s.accepting_orders,
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
          <h4 className="text-sm font-semibold text-[#F5A623] mb-3">M-Pesa</h4>
          <p className="text-sm text-[#C9BCAC]">Número: {settings.mpesa_number || 'Não definido'}</p>
          <p className="text-sm text-[#C9BCAC]">Nome: {settings.mpesa_name || 'Não definido'}</p>
        </div>

        <div className="border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] rounded-lg p-4">
          <h4 className="text-sm font-semibold text-[#F5A623] mb-3">e-Mola</h4>
          <p className="text-sm text-[#C9BCAC]">Número: {settings.emola_number || 'Não definido'}</p>
          <p className="text-sm text-[#C9BCAC]">Nome: {settings.emola_name || 'Não definido'}</p>
        </div>

        <div className="border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] rounded-lg p-4">
          <h4 className="text-sm font-semibold text-[#F5A623] mb-3">Morada de Levantamento</h4>
          <p className="text-sm text-[#C9BCAC]">{settings.pickup_address || 'Não definido'}</p>
          {settings.pickup_maps_url && (
            <a href={settings.pickup_maps_url} target="_blank" rel="noopener noreferrer" className="text-sm text-[#F5A623] hover:underline">
              Ver no mapa
            </a>
          )}
        </div>

        <div className="border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] rounded-lg p-4">
          <h4 className="text-sm font-semibold text-[#F5A623] mb-3">Horário de Funcionamento</h4>
          <p className="text-sm text-[#C9BCAC]">Abertura: {settings.open_hour}:00</p>
          <p className="text-sm text-[#C9BCAC]">Fecho: {settings.close_hour}:00</p>
          <p className="text-sm text-[#C9BCAC]">Slots de: {settings.slot_minutes} min</p>
        </div>

        <div className="border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] rounded-lg p-4">
          <h4 className="text-sm font-semibold text-[#F5A623] mb-3">Estado da Loja</h4>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${settings.accepting_orders ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className={`text-sm font-medium ${settings.accepting_orders ? 'text-green-400' : 'text-red-400'}`}>
              {settings.accepting_orders ? 'Aceitando pedidos' : 'Fechado'}
            </span>
          </div>
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
  const [mpesaNumber, setMpesaNumber] = useState(settings.mpesa_number ?? '');
  const [mpesaName, setMpesaName] = useState(settings.mpesa_name ?? '');
  const [emolaNumber, setEmolaNumber] = useState(settings.emola_number ?? '');
  const [emolaName, setEmolaName] = useState(settings.emola_name ?? '');
  const [pickupAddress, setPickupAddress] = useState(settings.pickup_address ?? '');
  const [pickupMapsUrl, setPickupMapsUrl] = useState(settings.pickup_maps_url ?? '');
  const [ownerEmail, setOwnerEmail] = useState(settings.owner_email ?? '');
  const [openHour, setOpenHour] = useState(settings.open_hour);
  const [closeHour, setCloseHour] = useState(settings.close_hour);
  const [slotMinutes, setSlotMinutes] = useState(settings.slot_minutes);
  const [acceptingOrders, setAcceptingOrders] = useState(settings.accepting_orders);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-[4px] z-50 flex items-center justify-center p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSaved({
            ...settings,
            mpesa_number: mpesaNumber || null,
            mpesa_name: mpesaName || null,
            emola_number: emolaNumber || null,
            emola_name: emolaName || null,
            pickup_address: pickupAddress || null,
            pickup_maps_url: pickupMapsUrl || null,
            owner_email: ownerEmail || null,
            open_hour: openHour,
            close_hour: closeHour,
            slot_minutes: slotMinutes,
            accepting_orders: acceptingOrders,
          });
        }}
        className="border border-white/[0.08] bg-white/[0.04] backdrop-blur-[12px] shadow-[0_4px_24px_rgba(0,0,0,0.4)] rounded-2xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="font-bold text-lg text-[#F5A623]">Editar Definições</h2>

        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-[#F5A623] mb-2">M-Pesa</h3>
            <div className="space-y-2">
              <input
                value={mpesaNumber}
                onChange={(e) => setMpesaNumber(e.target.value)}
                placeholder="Número M-Pesa"
                className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
              />
              <input
                value={mpesaName}
                onChange={(e) => setMpesaName(e.target.value)}
                placeholder="Nome do titular"
                className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
              />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[#F5A623] mb-2">e-Mola</h3>
            <div className="space-y-2">
              <input
                value={emolaNumber}
                onChange={(e) => setEmolaNumber(e.target.value)}
                placeholder="Número e-Mola"
                className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
              />
              <input
                value={emolaName}
                onChange={(e) => setEmolaName(e.target.value)}
                placeholder="Nome do titular"
                className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
              />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[#F5A623] mb-2">Morada de Levantamento</h3>
            <div className="space-y-2">
              <textarea
                value={pickupAddress}
                onChange={(e) => setPickupAddress(e.target.value)}
                rows={2}
                placeholder="Endereço para levantamento"
                className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
              />
              <input
                value={pickupMapsUrl}
                onChange={(e) => setPickupMapsUrl(e.target.value)}
                placeholder="Link do Google Maps"
                className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
              />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[#F5A623] mb-2">Horário</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-[#C9BCAC] mb-1">Abertura</label>
                <input
                  type="number"
                  min="0"
                  max="23"
                  value={openHour}
                  onChange={(e) => setOpenHour(parseInt(e.target.value) || 0)}
                  className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#C9BCAC] mb-1">Fecho</label>
                <input
                  type="number"
                  min="1"
                  max="24"
                  value={closeHour}
                  onChange={(e) => setCloseHour(parseInt(e.target.value) || 0)}
                  className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-[#C9BCAC] mb-1">Slots (minutos)</label>
                <input
                  type="number"
                  min="5"
                  max="120"
                  step="5"
                  value={slotMinutes}
                  onChange={(e) => setSlotMinutes(parseInt(e.target.value) || 30)}
                  className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]"
                />
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-[#F5A623] mb-2">Estado da Loja</h3>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="acceptingOrders"
                checked={acceptingOrders}
                onChange={(e) => setAcceptingOrders(e.target.checked)}
                className="rounded bg-black/20 border-white/[0.08] text-[#F5A623] focus:ring-[#F5A623]"
              />
              <label htmlFor="acceptingOrders" className="text-xs font-semibold text-[#C9BCAC]">
                Aceitar pedidos
              </label>
            </div>
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
