'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { createClient } from '@/utils/supabase/client';
import { isMissingMigration, saveErrorText, type StoreWhatsApp } from '@/lib/whatsapp/painel';

export type WhatsAppLoad =
  | { status: 'loading' }
  | { status: 'ok'; whats: StoreWhatsApp }
  /** A BD recusou: só o dono vê a configuração e os custos (1126). */
  | { status: 'forbidden' }
  /** A BD ainda sem a 1126. */
  | { status: 'migration' }
  | { status: 'error'; text: string };

/**
 * O WhatsApp de uma loja, lido e gravado pelos RPC da 1126. Partilhado pelas
 * abas Ligação e Dados: quem manda nas regras é `save_store_whatsapp`.
 */
export function useStoreWhatsApp(storeId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const [load, setLoad] = useState<WhatsAppLoad>({ status: 'loading' });

  const reload = useCallback(async () => {
    if (!storeId) return;
    const { data, error } = await supabase.rpc('get_store_whatsapp', { p_store_id: storeId });
    if (error) {
      if (error.message.includes('forbidden')) setLoad({ status: 'forbidden' });
      else if (isMissingMigration(error.message)) setLoad({ status: 'migration' });
      else setLoad({ status: 'error', text: `Não foi possível ler o WhatsApp: ${error.message}` });
      return;
    }
    setLoad({ status: 'ok', whats: data as StoreWhatsApp });
  }, [supabase, storeId]);

  useEffect(() => {
    setLoad({ status: 'loading' });
    void reload();
  }, [reload]);

  const save = useCallback(
    async (patch: Record<string, unknown>): Promise<{ ok: true } | { ok: false; text: string }> => {
      if (!storeId) return { ok: false, text: 'Escolhe uma loja.' };
      const { data, error } = await supabase.rpc('save_store_whatsapp', { p_store_id: storeId, p_payload: patch });
      if (error) return { ok: false, text: saveErrorText(error.message) };
      setLoad({ status: 'ok', whats: data as StoreWhatsApp });
      return { ok: true };
    },
    [supabase, storeId],
  );

  return { load, reload, save, supabase };
}
