'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import { createClient } from '@/utils/supabase/client';

interface PromoSettings {
  promo_banner_url: string | null;
  promo_code: string | null;
}

export function PromoSection() {
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [settings, setSettings] = useState<PromoSettings>({ promo_banner_url: null, promo_code: null });
  const [promoCode, setPromoCode] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const refetch = useCallback(async () => {
    const { data } = await supabase
      .from('settings')
      .select('promo_banner_url, promo_code')
      .eq('id', 1)
      .single();
    if (data) {
      setSettings(data as PromoSettings);
      setPromoCode(data.promo_code ?? '');
    }
  }, [supabase]);

  useEffect(() => { refetch(); }, [refetch]);

  async function uploadBanner(file: File) {
    setUploading(true);
    setMessage(null);
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const path = `promo-${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('storefront-assets')
      .upload(path, file, { cacheControl: '3600', upsert: false });
    if (upErr) {
      setMessage({ type: 'err', text: `Erro no upload: ${upErr.message}` });
      setUploading(false);
      return;
    }
    const url = supabase.storage.from('storefront-assets').getPublicUrl(path).data.publicUrl;
    const { error: saveErr } = await supabase
      .from('settings')
      .update({ promo_banner_url: url })
      .eq('id', 1);
    if (saveErr) {
      setMessage({ type: 'err', text: `Erro ao guardar: ${saveErr.message}` });
    } else {
      setMessage({ type: 'ok', text: 'Imagem actualizada!' });
      refetch();
    }
    setUploading(false);
  }

  async function saveBannerCode() {
    setSaving(true);
    setMessage(null);
    const { error } = await supabase
      .from('settings')
      .update({ promo_code: promoCode.trim() || null })
      .eq('id', 1);
    if (error) {
      setMessage({ type: 'err', text: `Erro: ${error.message}` });
    } else {
      setMessage({ type: 'ok', text: 'Guardado!' });
      refetch();
    }
    setSaving(false);
  }

  async function removeBanner() {
    const { error } = await supabase
      .from('settings')
      .update({ promo_banner_url: null })
      .eq('id', 1);
    if (!error) refetch();
  }

  return (
    <div>
      <h2 className="text-lg font-bold text-white mb-1">Cupom promocional</h2>
      <p className="text-sm mb-5" style={{ color: '#8A7A69' }}>
        Aparece na loja abaixo do hero. O cliente vê a imagem + código para copiar.
      </p>

      {/* Preview da imagem + upload */}
      <div className="mb-4">
        <label className="block text-xs font-semibold mb-2" style={{ color: '#C9BCAC' }}>Imagem do cupom</label>
        <div className="flex items-start gap-4">
          {settings.promo_banner_url ? (
            <div className="relative w-28 h-20 rounded-xl overflow-hidden shrink-0">
              <Image src={settings.promo_banner_url} alt="Cupom" fill className="object-cover" sizes="112px" />
            </div>
          ) : (
            <div
              className="w-28 h-20 rounded-xl grid place-items-center shrink-0 text-xs text-center"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.12)', color: '#8A7A69' }}
            >
              Sem imagem
            </div>
          )}
          <div className="flex flex-col gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: '#F5A623' }}
            >
              {uploading ? 'A enviar…' : settings.promo_banner_url ? 'Substituir imagem' : 'Fazer upload'}
            </button>
            {settings.promo_banner_url && (
              <button
                onClick={removeBanner}
                className="px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ border: '1px solid rgba(255,255,255,0.08)', color: '#A3947F' }}
              >
                Remover imagem
              </button>
            )}
            <p className="text-[11px]" style={{ color: '#8A7A69' }}>JPG/PNG/WebP, máx 5 MB</p>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadBanner(f);
            e.target.value = '';
          }}
        />
      </div>

      {/* Código a exibir */}
      <div className="mb-5">
        <label className="block text-xs font-semibold mb-1.5" style={{ color: '#C9BCAC' }}>Código a mostrar (ex: PRIMEIRABOX)</label>
        <input
          value={promoCode}
          onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
          placeholder="Deixa vazio para não mostrar código"
          maxLength={50}
          className="w-full bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-[#F5A623]"
        />
        <p className="text-[11px] mt-1" style={{ color: '#8A7A69' }}>
          O cliente pode copiar este código. Deixa em branco para não exibir.
        </p>
      </div>

      <button
        onClick={saveBannerCode}
        disabled={saving}
        className="px-6 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
        style={{ background: '#F5A623' }}
      >
        {saving ? 'A guardar…' : 'Guardar código'}
      </button>

      {message && (
        <p className="mt-3 text-sm" style={{ color: message.type === 'ok' ? '#22c55e' : '#ef4444' }}>
          {message.text}
        </p>
      )}
    </div>
  );
}
