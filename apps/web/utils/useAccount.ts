'use client';

/**
 * Conta do cliente da loja, do lado do browser.
 *
 * Não guarda token nenhum: o token é um cookie httpOnly que esta página nem
 * consegue ler. Aqui só se pergunta "quem sou eu" e se pedem alterações — é o
 * servidor que sabe de quem é a sessão.
 *
 * Nada disto bloqueia a venda (raiz §1, regra 1). Se a conta falhar, o
 * checkout volta a ser o formulário de sempre e o cliente compra na mesma.
 */

import { useCallback, useEffect, useState } from 'react';

export type SavedAddress = {
  id: string;
  label: string;
  address: string;
  delivery_zone_id: string | null;
  notes: string;
  is_default: boolean;
};

export type AccountProfile = {
  phone: string;
  name: string | null;
  orders_count: number;
  addresses: SavedAddress[];
};

type SaveInput = {
  id?: string;
  label: string;
  address: string;
  zoneId?: string | null;
  notes?: string;
  makeDefault?: boolean;
};

export function useAccount() {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  // `hydrated` distingue "ainda não sei" de "não estás logado". Sem isto o
  // checkout pisca o formulário anónimo antes de reconhecer o cliente.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/account')
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setProfile(d?.profile ?? null); })
      .catch(() => { if (!cancelled) setProfile(null); })
      .finally(() => { if (!cancelled) setHydrated(true); });
    return () => { cancelled = true; };
  }, []);

  /** Prende este dispositivo a partir de um pedido acabado de fazer. */
  const bind = useCallback(async (orderId: string) => {
    try {
      const res = await fetch('/api/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bind', orderId }),
      });
      const d = await res.json();
      if (d?.profile) setProfile(d.profile);
      return d?.profile ?? null;
    } catch {
      return null;
    }
  }, []);

  const saveAddress = useCallback(async (input: SaveInput) => {
    const res = await fetch('/api/account/address', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d?.error ?? 'Não foi possível guardar a morada.');
    setProfile(d.profile);
    return d.profile as AccountProfile;
  }, []);

  const deleteAddress = useCallback(async (id: string) => {
    const res = await fetch('/api/account/address', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d?.error ?? 'Não foi possível apagar a morada.');
    setProfile(d.profile);
    return d.profile as AccountProfile;
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    }).catch(() => {});
    setProfile(null);
  }, []);

  /** Telemóvel novo: pede o código. Devolve o canal por onde ele saiu. */
  const requestCode = useCallback(async (phone: string) => {
    const res = await fetch('/api/account/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    return res.json() as Promise<{ channel: 'email' | 'none'; hint?: string }>;
  }, []);

  const verifyCode = useCallback(async (phone: string, code: string) => {
    const res = await fetch('/api/account/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d?.error ?? 'Código errado.');
    setProfile(d.profile);
    return d.profile as AccountProfile;
  }, []);

  return { profile, hydrated, bind, saveAddress, deleteAddress, logout, requestCode, verifyCode };
}
