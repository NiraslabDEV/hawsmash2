'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { createClient } from '@/utils/supabase/client';

type StaffRole = 'owner' | 'manager' | 'cashier' | 'kitchen';

type StaffStore = { store_id: string; slug: string; short_name: string };

type StaffMember = {
  user_id: string;
  full_name: string;
  email: string | null;
  role: StaffRole;
  active: boolean;
  has_pin: boolean;
  created_at: string;
  stores: StaffStore[];
};

type Store = { id: string; slug: string; short_name: string };

const ROLE_LABELS: Record<StaffRole, string> = {
  owner: 'Dono',
  manager: 'Gerente',
  cashier: 'Caixa',
  kitchen: 'Cozinha',
};

const ROLE_HINTS: Record<StaffRole, string> = {
  owner: 'Vê as duas lojas e muda tudo, incluindo preços e equipa.',
  manager: 'Opera a sua loja: aprova, anula, abre e fecha caixa, mexe no estoque.',
  cashier: 'Vende no POS da sua loja e fecha a sua caixa.',
  kitchen: 'Vê pedidos e avança o preparo. Não vê dinheiro.',
};

export default function EquipaPage() {
  const supabase = useMemo(() => createClient(), []);

  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'cashier' as StaffRole,
    storeIds: [] as string[],
    pin: '',
  });
  const [revoking, setRevoking] = useState<StaffMember | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [pinTarget, setPinTarget] = useState<StaffMember | null>(null);
  const [pinValue, setPinValue] = useState('');
  const [passwordTarget, setPasswordTarget] = useState<StaffMember | null>(null);
  const [passwordValue, setPasswordValue] = useState('');

  const refresh = useCallback(async () => {
    const [staffResult, storesResult] = await Promise.all([
      supabase.rpc('list_staff'),
      supabase.from('stores').select('id,slug,short_name').eq('active', true).order('sort'),
    ]);

    if (staffResult.error) {
      if (staffResult.error.message.includes('staff_admin_denied')) setDenied(true);
      else setMessage({ tone: 'error', text: `Não foi possível carregar a equipa: ${staffResult.error.message}` });
    } else {
      setStaff((staffResult.data ?? []) as StaffMember[]);
      setDenied(false);
    }
    if (storesResult.data) setStores(storesResult.data as Store[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function toggleStore(storeId: string) {
    setForm((current) => ({
      ...current,
      storeIds: current.storeIds.includes(storeId)
        ? current.storeIds.filter((id) => id !== storeId)
        : [...current.storeIds, storeId],
    }));
  }

  async function createStaff() {
    if (form.fullName.trim().length < 3 || form.password.length < 8) {
      setMessage({ tone: 'error', text: 'Indica o nome completo e uma palavra-passe com 8+ caracteres.' });
      return;
    }
    if (form.role !== 'owner' && form.storeIds.length === 0) {
      setMessage({ tone: 'error', text: 'Escolhe pelo menos uma loja para esta pessoa.' });
      return;
    }

    setBusy(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const response = await fetch('/api/staff', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionData.session?.access_token ?? ''}`,
      },
      body: JSON.stringify({
        email: form.email.trim(),
        password: form.password,
        fullName: form.fullName.trim(),
        role: form.role,
        storeIds: form.storeIds,
        ...(form.pin ? { pin: form.pin } : {}),
      }),
    });
    setBusy(false);

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Falha desconhecida.' }));
      setMessage({ tone: 'error', text: `Conta não criada: ${body.error}` });
      return;
    }

    setCreating(false);
    setForm({ fullName: '', email: '', password: '', role: 'cashier', storeIds: [], pin: '' });
    setMessage({ tone: 'ok', text: 'Conta criada e já com acesso atribuído.' });
    await refresh();
  }

  async function changeAccess(member: StaffMember, role: StaffRole, storeIds: string[]) {
    setBusy(true);
    const { error } = await supabase.rpc('set_staff_access', {
      p_user_id: member.user_id,
      p_role: role,
      p_store_ids: storeIds,
      p_active: member.active,
    });
    setBusy(false);
    if (error) {
      setMessage({
        tone: 'error',
        text: error.message.includes('cannot_demote_self')
          ? 'Não podes retirar-te a ti próprio o acesso de dono.'
          : `Alteração recusada: ${error.message}`,
      });
      return;
    }
    setMessage({ tone: 'ok', text: `Acesso de ${member.full_name} actualizado.` });
    await refresh();
  }

  async function revokeAccess() {
    if (!revoking) return;
    if (revokeReason.trim().length < 3) {
      setMessage({ tone: 'error', text: 'Escreve o motivo da remoção (fica no registo).' });
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('deactivate_staff', {
      p_user_id: revoking.user_id,
      p_reason: revokeReason.trim(),
    });
    setBusy(false);
    if (error) {
      setMessage({ tone: 'error', text: `Remoção recusada: ${error.message}` });
      return;
    }
    setMessage({ tone: 'ok', text: `${revoking.full_name} perdeu o acesso imediatamente.` });
    setRevoking(null);
    setRevokeReason('');
    await refresh();
  }

  async function savePin() {
    if (!pinTarget) return;
    setBusy(true);
    const { error } = await supabase.rpc('set_staff_pin', {
      p_user_id: pinTarget.user_id,
      p_pin: pinValue,
    });
    setBusy(false);
    if (error) {
      setMessage({
        tone: 'error',
        text: error.message.includes('invalid_pin_format')
          ? 'O PIN tem de ter 4 a 6 dígitos.'
          : `PIN recusado: ${error.message}`,
      });
      return;
    }
    setMessage({ tone: 'ok', text: `PIN de ${pinTarget.full_name} definido.` });
    setPinTarget(null);
    setPinValue('');
    await refresh();
  }

  async function resetPassword() {
    if (!passwordTarget) return;
    if (passwordValue.length < 8) {
      setMessage({ tone: 'error', text: 'A senha tem de ter 8+ caracteres.' });
      return;
    }
    setBusy(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const response = await fetch(`/api/staff/${passwordTarget.user_id}/password`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionData.session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ password: passwordValue }),
    });
    setBusy(false);

    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: 'Falha desconhecida.' }));
      setMessage({ tone: 'error', text: `Senha não redefinida: ${body.error}` });
      return;
    }

    setMessage({ tone: 'ok', text: `Senha de ${passwordTarget.full_name} redefinida.` });
    setPasswordTarget(null);
    setPasswordValue('');
  }

  if (denied) {
    return (
      <div className="rounded-2xl border border-white/[0.08] p-6 text-center text-[#C9BCAC]">
        <h1 className="text-xl font-black text-white">Equipa</h1>
        <p className="mt-2 text-sm">Só o dono gere contas, perfis e PIN.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">Equipa</h1>
          <p className="text-sm text-[#8b8378]">
            {staff.length} {staff.length === 1 ? 'conta' : 'contas'} · a remoção de acesso é imediata e fica registada
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-xl bg-[#e5a93c] px-4 py-2 text-sm font-black text-black"
        >
          Nova conta
        </button>
      </header>

      {message && (
        <p
          className={`rounded-xl border px-4 py-3 text-sm ${
            message.tone === 'ok'
              ? 'border-[#2f6b3f] bg-[#16281c] text-[#a8e0b6]'
              : 'border-[#7a2b2b] bg-[#2a1616] text-[#ffb0b0]'
          }`}
        >
          {message.text}
        </p>
      )}

      <section className="overflow-x-auto rounded-2xl border border-white/[0.08]">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-white/[0.03] text-xs uppercase tracking-wide text-[#8b8378]">
            <tr>
              <th className="px-4 py-3">Pessoa</th>
              <th className="px-4 py-3">Perfil</th>
              <th className="px-4 py-3">Lojas</th>
              <th className="px-4 py-3">PIN</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Acções</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[#8b8378]">
                  A carregar a equipa…
                </td>
              </tr>
            )}
            {staff.map((member) => (
              <tr key={member.user_id} className="border-t border-white/[0.06]">
                <td className="px-4 py-3">
                  <span className="block font-bold text-white">{member.full_name}</span>
                  <span className="text-xs text-[#8b8378]">{member.email ?? '—'}</span>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={member.role}
                    disabled={busy}
                    aria-label={`Perfil de ${member.full_name}`}
                    onChange={(event) =>
                      void changeAccess(
                        member,
                        event.target.value as StaffRole,
                        member.stores.map((store) => store.store_id),
                      )
                    }
                    className="rounded-lg border border-white/10 bg-[#141210] px-2 py-1 text-xs text-white"
                  >
                    {(Object.keys(ROLE_LABELS) as StaffRole[]).map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {stores.map((store) => {
                      const selected = member.stores.some((entry) => entry.store_id === store.id);
                      return (
                        <button
                          key={store.id}
                          type="button"
                          disabled={busy || member.role === 'owner'}
                          onClick={() =>
                            void changeAccess(
                              member,
                              member.role,
                              selected
                                ? member.stores
                                    .filter((entry) => entry.store_id !== store.id)
                                    .map((entry) => entry.store_id)
                                : [...member.stores.map((entry) => entry.store_id), store.id],
                            )
                          }
                          className={`rounded-full px-3 py-1 text-xs font-bold ${
                            selected
                              ? 'bg-[#e5a93c]/20 text-[#e5a93c]'
                              : 'border border-white/10 text-[#8b8378]'
                          }`}
                        >
                          {store.short_name}
                        </button>
                      );
                    })}
                    {member.role === 'owner' && (
                      <span className="text-xs text-[#8b8378]">Todas as lojas</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-[#C9BCAC]">
                  {member.has_pin ? 'Definido' : 'Por definir'}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-bold ${
                      member.active ? 'bg-[#16281c] text-[#a8e0b6]' : 'bg-[#2a1616] text-[#ffb0b0]'
                    }`}
                  >
                    {member.active ? 'Activo' : 'Sem acesso'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPinTarget(member);
                        setPinValue('');
                      }}
                      className="rounded-lg border border-white/10 px-3 py-1 text-xs font-bold text-[#C9BCAC] hover:bg-white/[0.05]"
                    >
                      Definir PIN
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPasswordTarget(member);
                        setPasswordValue('');
                      }}
                      className="rounded-lg border border-white/10 px-3 py-1 text-xs font-bold text-[#C9BCAC] hover:bg-white/[0.05]"
                    >
                      Redefinir senha
                    </button>
                    {member.active ? (
                      <button
                        type="button"
                        onClick={() => {
                          setRevoking(member);
                          setRevokeReason('');
                        }}
                        className="rounded-lg border border-[#7a2b2b] px-3 py-1 text-xs font-bold text-[#ffb0b0] hover:bg-[#2a1616]"
                      >
                        Remover acesso
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void supabase
                            .rpc('set_staff_access', {
                              p_user_id: member.user_id,
                              p_role: member.role,
                              p_store_ids: member.stores.map((entry) => entry.store_id),
                              p_active: true,
                            })
                            .then(() => refresh())
                        }
                        className="rounded-lg border border-white/10 px-3 py-1 text-xs font-bold text-[#C9BCAC] hover:bg-white/[0.05]"
                      >
                        Reactivar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {creating && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#151311] p-5">
            <h2 className="text-lg font-black text-white">Nova conta de equipa</h2>

            <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-[#8b8378]">
              Nome completo
              <input
                value={form.fullName}
                onChange={(event) => setForm({ ...form, fullName: event.target.value })}
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white"
              />
            </label>

            <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[#8b8378]">
              Email
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white"
              />
            </label>

            <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[#8b8378]">
              Palavra-passe inicial
              <input
                type="text"
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white"
              />
            </label>

            <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[#8b8378]">
              Perfil
              <select
                value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value as StaffRole })}
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white"
              >
                {(Object.keys(ROLE_LABELS) as StaffRole[]).map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-1 text-xs text-[#8b8378]">{ROLE_HINTS[form.role]}</p>

            <div className="mt-3">
              <span className="block text-xs font-bold uppercase tracking-wide text-[#8b8378]">Lojas</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {stores.map((store) => (
                  <button
                    key={store.id}
                    type="button"
                    onClick={() => toggleStore(store.id)}
                    className={`rounded-full px-3 py-1 text-xs font-bold ${
                      form.storeIds.includes(store.id)
                        ? 'bg-[#e5a93c]/20 text-[#e5a93c]'
                        : 'border border-white/10 text-[#8b8378]'
                    }`}
                  >
                    {store.short_name}
                  </button>
                ))}
              </div>
            </div>

            <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[#8b8378]">
              PIN do POS (opcional)
              <input
                value={form.pin}
                onChange={(event) => setForm({ ...form, pin: event.target.value.replace(/[^0-9]/g, '').slice(0, 6) })}
                inputMode="numeric"
                className="mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white"
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-[#C9BCAC]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void createStaff()}
                className="rounded-xl bg-[#e5a93c] px-4 py-2 text-sm font-black text-black disabled:opacity-50"
              >
                Criar conta
              </button>
            </div>
          </div>
        </div>
      )}

      {revoking && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#151311] p-5">
            <h2 className="text-lg font-black text-white">Remover acesso</h2>
            <p className="mt-2 text-sm text-[#8b8378]">
              {revoking.full_name} perde o acesso no momento em que confirmares. O motivo fica no
              registo de auditoria.
            </p>
            <input
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              placeholder="Motivo (ex.: saiu da equipa)"
              className="mt-4 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRevoking(null)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-[#C9BCAC]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void revokeAccess()}
                className="rounded-xl bg-[#7a2b2b] px-4 py-2 text-sm font-black text-white disabled:opacity-50"
              >
                Remover agora
              </button>
            </div>
          </div>
        </div>
      )}

      {passwordTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#151311] p-5">
            <h2 className="text-lg font-black text-white">Redefinir senha de {passwordTarget.full_name}</h2>
            <p className="mt-2 text-sm text-[#8b8378]">
              A senha antiga deixa de funcionar de imediato. Avisa a pessoa da nova senha.
            </p>
            <input
              type="text"
              value={passwordValue}
              onChange={(event) => setPasswordValue(event.target.value)}
              placeholder="Nova senha (8+ caracteres)"
              className="mt-4 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPasswordTarget(null)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-[#C9BCAC]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void resetPassword()}
                className="rounded-xl bg-[#e5a93c] px-4 py-2 text-sm font-black text-black disabled:opacity-50"
              >
                Redefinir
              </button>
            </div>
          </div>
        </div>
      )}

      {pinTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#151311] p-5">
            <h2 className="text-lg font-black text-white">PIN de {pinTarget.full_name}</h2>
            <p className="mt-2 text-sm text-[#8b8378]">
              4 a 6 dígitos. Serve para desbloquear o POS e autorizar anulações.
            </p>
            <input
              value={pinValue}
              onChange={(event) => setPinValue(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              inputMode="numeric"
              aria-label="PIN"
              className="mt-4 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-lg font-black tracking-[0.4em] text-white"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPinTarget(null)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm font-bold text-[#C9BCAC]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void savePin()}
                className="rounded-xl bg-[#e5a93c] px-4 py-2 text-sm font-black text-black disabled:opacity-50"
              >
                Guardar PIN
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
