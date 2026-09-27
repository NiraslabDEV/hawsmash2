'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { createClient } from '@/utils/supabase/client';

/**
 * O perfil desta loja no Google (1096). Ligado, o resumo do dia 1 traz a nota
 * e as avaliações da loja. O Place ID é público: não é segredo, mostra-se.
 */
export function GoogleSection({ storeId, storeName }: { storeId: string; storeName: string }) {
  const supabase = useMemo(() => createClient(), []);

  // undefined = ainda a ler. Sem isto, guardar antes de ler apagava o que lá estava.
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'erro'; text: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('stores')
      .select('google_place_id')
      .eq('id', storeId)
      .single();
    if (error) {
      setMessage({ tone: 'erro', text: `Não foi possível ler o perfil: ${error.message}` });
      return;
    }
    const value = (data as { google_place_id: string | null }).google_place_id ?? null;
    setSaved(value);
    setDraft(value ?? '');
  }, [supabase, storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setMessage(null);
    const { data, error } = await supabase.rpc('set_store_google_place', {
      p_store_id: storeId,
      p_place_id: draft,
    });
    setSaving(false);
    if (error) {
      setMessage({
        tone: 'erro',
        text: error.message.includes('invalid_google_place_id')
          ? 'Isso não é um Place ID. É um código como ChIJ… — não o link de avaliação.'
          : `Não guardou: ${error.message}`,
      });
      return;
    }
    const value = (data as { google_place_id: string | null }).google_place_id;
    setSaved(value);
    setDraft(value ?? '');
    setMessage({
      tone: 'ok',
      text: value ? 'Perfil ligado. Entra no resumo do dia 1.' : 'Perfil desligado do resumo.',
    });
  }

  const unchanged = draft.trim() === (saved ?? '');

  return (
    <section className="rounded-2xl border border-white/[0.08] p-5 space-y-4">
      <div>
        <h2 className="font-black text-white">Google — {storeName}</h2>
        <p className="mt-1 text-sm text-[#8b8378]">
          O resumo do dia 1 traz a nota e as avaliações desta loja no Google. Procura a loja no{' '}
          <a
            href="https://developers.google.com/maps/documentation/places/web-service/place-id#find-id"
            target="_blank"
            rel="noreferrer"
            className="text-[#e5a93c] underline"
          >
            localizador de Place ID
          </a>{' '}
          e cola aqui o código (começa quase sempre por ChIJ).
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

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 text-xs font-bold uppercase tracking-wide text-[#8b8378]">
          Place ID
          <input
            value={draft}
            disabled={saved === undefined}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="ChIJ…"
            className="mt-1 w-full rounded-xl border border-white/10 bg-[#0f0e0c] px-4 py-3 text-sm text-white placeholder:text-[#6f6a62] disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          disabled={saving || saved === undefined || unchanged}
          onClick={() => void save()}
          className="rounded-xl bg-[#e5a93c] px-4 py-3 text-sm font-black text-black disabled:opacity-50"
        >
          Guardar perfil
        </button>
      </div>
    </section>
  );
}
