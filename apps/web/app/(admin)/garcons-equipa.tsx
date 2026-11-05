'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatMT, type Cents } from '@delivery/core';

import { waiterAdminErrorMessage, type WaiterRow } from '@/lib/garcom/admin';
import { createClient } from '@/utils/supabase/client';

const INPUT =
  'bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#F5A623]';
const BTN_GOLD =
  'bg-[#F5A623] text-[#2A1710] font-semibold px-4 py-2 rounded-lg text-sm hover:bg-[#D6860F] transition-colors disabled:opacity-50';
const BTN_LINHA =
  'text-xs font-semibold px-3 py-1.5 rounded-lg border border-white/[0.08] text-[#C9BCAC] hover:text-white transition-colors';
const money = (c: number) => formatMT(c as Cents);

type StoreRow = { id: string; short_name: string };

/**
 * Os garçons de cada loja (1122). O garçom não é uma conta da equipa: entra
 * em /garcom no telemóvel com o telefone e o PIN que se define aqui, e só
 * trabalha nas mesas da sua loja. Trocar o PIN ou desactivá-lo fecha o
 * telemóvel antigo.
 */
export function GarconsSection() {
  const supabase = useMemo(() => createClient(), []);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [aEditar, setAEditar] = useState<WaiterRow | null>(null);
  const [pinDe, setPinDe] = useState<WaiterRow | null>(null);

  useEffect(() => {
    setBaseUrl(window.location.origin);
    void supabase
      .from('stores')
      .select('id, short_name')
      .eq('active', true)
      .order('sort')
      .then(({ data }) => {
        const lojas = (data ?? []) as StoreRow[];
        setStores(lojas);
        setStoreId((actual) => actual ?? lojas[0]?.id ?? null);
      });
  }, [supabase]);

  const definicoes = useQuery({
    queryKey: ['garcons-definicoes', storeId],
    enabled: Boolean(storeId),
    queryFn: async (): Promise<{ remove_minutes: number }> => {
      const { data, error } = await supabase.rpc('get_waiter_settings', { p_store_id: storeId });
      if (error) throw new Error(waiterAdminErrorMessage(error.message));
      return data as { remove_minutes: number };
    },
  });

  const mudarLimite = async (minutos: number) => {
    const { error } = await supabase.rpc('set_waiter_remove_minutes', { p_store_id: storeId, p_minutes: minutos });
    if (error) return falhou(waiterAdminErrorMessage(error.message));
    setMensagem({
      tipo: 'ok',
      texto: minutos === 0 ? 'Retirar artigos passa a ser só no balcão.' : `Os garçons podem retirar até ${minutos} min depois de lançar.`,
    });
    void definicoes.refetch();
  };

  const alternarCobrar = async (w: WaiterRow) => {
    const { error } = await supabase.rpc('set_waiter_can_charge', { p_waiter_id: w.id, p_can_charge: !w.can_charge });
    if (error) return falhou(waiterAdminErrorMessage(error.message));
    terminou(w.can_charge ? `${w.full_name} deixa de poder cobrar.` : `${w.full_name} pode cobrar por M-Pesa, e-Mola e cartão.`);
  };

  const lista = useQuery({
    queryKey: ['garcons', storeId],
    enabled: Boolean(storeId),
    refetchInterval: 30_000,
    queryFn: async (): Promise<WaiterRow[]> => {
      const { data, error } = await supabase.rpc('get_waiters', { p_store_id: storeId });
      if (error) throw new Error(waiterAdminErrorMessage(error.message));
      return (data ?? []) as WaiterRow[];
    },
  });

  const terminou = (texto: string) => {
    setMensagem({ tipo: 'ok', texto });
    setAEditar(null);
    setPinDe(null);
    void lista.refetch();
  };
  const falhou = (texto: string) => setMensagem({ tipo: 'erro', texto });

  const alternarActivo = async (w: WaiterRow) => {
    const { error } = await supabase.rpc('save_waiter', {
      p_waiter_id: w.id,
      p_store_id: storeId,
      p_full_name: w.full_name,
      p_phone: w.phone,
      p_active: !w.active,
    });
    if (error) falhou(waiterAdminErrorMessage(error.message));
    else terminou(w.active ? `${w.full_name} desactivado. O telemóvel dele deixa de entrar.` : `${w.full_name} activado.`);
  };

  const loja = stores.find((s) => s.id === storeId);
  const garcons = lista.data ?? [];

  return (
    <div className="space-y-5">
      <p className="text-sm text-[#C9BCAC]">
        O garçom tira o pedido na mesa, no telemóvel: abre{' '}
        <code className="text-[#F5A623]">{baseUrl || ''}/garcom</code> e entra com o telefone e o PIN. O pedido sai na
        cozinha e no balcão, como o lançado no POS, e fica na conta da mesa. A conta cobra-se no POS, na aba Mesas, ou no telemóvel de quem tiver
        &quot;Pode cobrar&quot; ligado, por M-Pesa, e-Mola ou cartão (em notas, só no balcão). No telemóvel, &quot;Adicionar ao ecrã inicial&quot; deixa-o como uma app.
      </p>

      {stores.length > 1 && (
        <div className="flex gap-2" role="tablist" aria-label="Loja dos garçons">
          {stores.map((store) => (
            <button
              key={store.id}
              type="button"
              role="tab"
              aria-selected={store.id === storeId}
              onClick={() => setStoreId(store.id)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                store.id === storeId
                  ? 'bg-[#F5A623] text-[#2A1710] border-[#F5A623]'
                  : 'border-white/[0.08] text-[#C9BCAC] hover:text-white'
              }`}
            >
              {store.short_name}
            </button>
          ))}
        </div>
      )}

      {storeId && <NovoGarcom storeId={storeId} loja={loja?.short_name} onDone={terminou} onErro={falhou} />}

      {storeId && definicoes.data && (
        <label className="flex flex-wrap items-center gap-3 text-sm text-[#C9BCAC]">
          O garçom pode retirar um artigo do pedido dele até
          <select
            className={INPUT}
            value={definicoes.data.remove_minutes}
            onChange={(e) => void mudarLimite(Number(e.target.value))}
          >
            {/* DECISÃO: de fábrica 3 min. Depois disso a comida pode estar feita. */}
            {[0, 1, 2, 3, 5, 10, 15, 30].map((m) => (
              <option key={m} value={m}>
                {m === 0 ? 'nunca (só no balcão)' : `${m} min depois de lançar`}
              </option>
            ))}
          </select>
        </label>
      )}

      {mensagem && (
        <p
          className={`rounded-lg px-4 py-2 text-sm ${
            mensagem.tipo === 'ok' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
          }`}
        >
          {mensagem.texto}
        </p>
      )}
      {lista.error && <p className="text-sm text-red-400">{(lista.error as Error).message}</p>}

      {lista.isLoading ? (
        <p className="text-[#C9BCAC]">A carregar…</p>
      ) : (
        <div className="border border-white/[0.08] bg-white/[0.04] rounded-xl overflow-hidden">
          {garcons.length === 0 ? (
            <p className="text-gray-400 text-center py-8">
              {loja ? `${loja.short_name} ainda não tem garçons.` : 'Sem garçons ainda.'} Adiciona o primeiro acima.
            </p>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {garcons.map((w) => (
                <li key={w.id} className={`px-4 py-3 space-y-2 ${w.active ? '' : 'opacity-60'}`}>
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-bold text-white">{w.full_name}</span>
                    <span className="text-xs text-[#C9BCAC]">{w.phone}</span>
                    {!w.has_pin && <span className="text-xs text-amber-300">Sem PIN — não consegue entrar</span>}
                    <span className="ml-auto text-xs text-[#C9BCAC]">
                      Hoje: {w.orders_today} {w.orders_today === 1 ? 'pedido' : 'pedidos'} · {money(w.total_today_cents)}
                    </span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <button className={BTN_LINHA} onClick={() => setPinDe(w)}>
                      {w.has_pin ? 'Trocar PIN' : 'Definir PIN'}
                    </button>
                    <button className={BTN_LINHA} onClick={() => setAEditar(w)}>
                      Editar
                    </button>
                    <button
                      onClick={() => void alternarActivo(w)}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-full ${
                        w.active ? 'bg-green-900/30 text-green-400 border border-green-700' : 'bg-white/[0.08] text-[#C9BCAC]'
                      }`}
                    >
                      {w.active ? 'Activo' : 'Desactivado'}
                    </button>
                    <button
                      onClick={() => void alternarCobrar(w)}
                      aria-pressed={w.can_charge}
                      title="Fechar a conta da mesa no telemóvel, sem dinheiro em notas"
                      className={`text-xs font-semibold px-3 py-1.5 rounded-full ${
                        w.can_charge ? 'bg-green-900/30 text-green-400 border border-green-700' : 'bg-white/[0.08] text-[#C9BCAC]'
                      }`}
                    >
                      {w.can_charge ? 'Pode cobrar' : 'Não cobra'}
                    </button>
                  </div>
                  {pinDe?.id === w.id && <FormPin waiter={w} onDone={terminou} onCancelar={() => setPinDe(null)} />}
                  {aEditar?.id === w.id && storeId && (
                    <FormEditar waiter={w} storeId={storeId} onDone={terminou} onCancelar={() => setAEditar(null)} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NovoGarcom({
  storeId,
  loja,
  onDone,
  onErro,
}: {
  storeId: string;
  loja?: string;
  onDone: (texto: string) => void;
  onErro: (texto: string) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [pin, setPin] = useState('');
  const [aGuardar, setAGuardar] = useState(false);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[0-9]{4,6}$/.test(pin)) {
      onErro('O PIN tem 4 a 6 dígitos.');
      return;
    }
    setAGuardar(true);
    const { data: id, error } = await supabase.rpc('save_waiter', {
      p_waiter_id: null,
      p_store_id: storeId,
      p_full_name: nome,
      p_phone: telefone,
      p_active: true,
    });
    if (error) {
      setAGuardar(false);
      onErro(waiterAdminErrorMessage(error.message));
      return;
    }
    const { error: pinError } = await supabase.rpc('set_waiter_pin', { p_waiter_id: id, p_pin: pin });
    setAGuardar(false);
    if (pinError) {
      onErro(`${nome} criado, mas o PIN falhou: ${waiterAdminErrorMessage(pinError.message)}`);
      return;
    }
    setNome('');
    setTelefone('');
    setPin('');
    onDone(`${nome} criado. Entra em /garcom com ${telefone} e o PIN.`);
  };

  return (
    <form onSubmit={guardar} className="flex gap-2 items-start flex-wrap">
      <input className={`${INPUT} w-48`} placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
      <input
        className={`${INPUT} w-44`}
        placeholder="Telefone (84 123 4567)"
        inputMode="tel"
        value={telefone}
        onChange={(e) => setTelefone(e.target.value)}
        required
      />
      <input
        className={`${INPUT} w-36`}
        placeholder="PIN (4 a 6)"
        inputMode="numeric"
        maxLength={6}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        required
      />
      <button type="submit" disabled={aGuardar} className={BTN_GOLD}>
        {aGuardar ? 'A guardar…' : `Adicionar garçom${loja ? ` em ${loja}` : ''}`}
      </button>
    </form>
  );
}

function FormPin({ waiter, onDone, onCancelar }: { waiter: WaiterRow; onDone: (t: string) => void; onCancelar: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [pin, setPin] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.rpc('set_waiter_pin', { p_waiter_id: waiter.id, p_pin: pin });
    if (error) setErro(waiterAdminErrorMessage(error.message));
    else onDone(`PIN de ${waiter.full_name} definido. O telemóvel antigo deixa de entrar.`);
  };

  return (
    <form onSubmit={guardar} className="flex gap-2 items-center flex-wrap">
      <input
        className={`${INPUT} w-40`}
        placeholder="Novo PIN (4 a 6)"
        inputMode="numeric"
        maxLength={6}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        autoFocus
      />
      <button type="submit" className={BTN_GOLD}>
        Definir PIN
      </button>
      <button type="button" className={BTN_LINHA} onClick={onCancelar}>
        Cancelar
      </button>
      {erro && <span className="text-sm text-red-400">{erro}</span>}
    </form>
  );
}

function FormEditar({
  waiter,
  storeId,
  onDone,
  onCancelar,
}: {
  waiter: WaiterRow;
  storeId: string;
  onDone: (t: string) => void;
  onCancelar: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [nome, setNome] = useState(waiter.full_name);
  const [telefone, setTelefone] = useState(waiter.phone);
  const [erro, setErro] = useState<string | null>(null);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.rpc('save_waiter', {
      p_waiter_id: waiter.id,
      p_store_id: storeId,
      p_full_name: nome,
      p_phone: telefone,
      p_active: waiter.active,
    });
    if (error) setErro(waiterAdminErrorMessage(error.message));
    else onDone(`${nome} actualizado.`);
  };

  return (
    <form onSubmit={guardar} className="flex gap-2 items-center flex-wrap">
      <input className={`${INPUT} w-48`} value={nome} onChange={(e) => setNome(e.target.value)} />
      <input className={`${INPUT} w-44`} inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
      <button type="submit" className={BTN_GOLD}>
        Guardar
      </button>
      <button type="button" className={BTN_LINHA} onClick={onCancelar}>
        Cancelar
      </button>
      {erro && <span className="text-sm text-red-400">{erro}</span>}
    </form>
  );
}
