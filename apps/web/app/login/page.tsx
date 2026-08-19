'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { createClient } from '@/utils/supabase/client';
import { brand } from '@brand';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError('Email ou palavra-passe incorretos.');
      setLoading(false);
      return;
    }

    router.push('/pedidos');
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#150D08] to-[#231610] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-[#231610] border border-white/[0.08] rounded-2xl p-8">
          {/* Chip creme: o lettering do logótipo é castanho escuro e some sobre o fundo do painel. */}
          <div className="mx-auto mb-5 grid place-items-center w-20 h-20 rounded-2xl bg-[#FBF6EC] p-2 shadow-[0_0_28px_rgba(245,166,35,0.25)]">
            <Image
              src={brand.storefront.logoImage}
              alt={brand.name}
              width={80}
              height={80}
              className="w-full h-full object-contain"
              priority
            />
          </div>
          <h1 className="text-2xl font-bold text-[#F5A623] mb-1 text-center">{brand.name}</h1>
          <p className="text-sm text-[#C9BCAC] mb-6 text-center">Painel interno — entra com a tua conta de staff.</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm text-[#C9BCAC] mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-[#150D08] border border-[#3A241A] rounded-lg px-4 py-3 text-white placeholder-[#8A7A69] focus:outline-none focus:border-[#F5A623]"
                placeholder="dono@restaurante.com"
              />
            </div>
            <div>
              <label className="block text-sm text-[#C9BCAC] mb-2">Palavra-passe</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-[#150D08] border border-[#3A241A] rounded-lg px-4 py-3 text-white placeholder-[#8A7A69] focus:outline-none focus:border-[#F5A623]"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-900/30 border border-red-700 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#F5A623] hover:bg-[#D6860F] disabled:bg-gray-600 text-[#150D08] font-bold py-3 px-4 rounded-lg transition-colors"
            >
              {loading ? 'A entrar...' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
