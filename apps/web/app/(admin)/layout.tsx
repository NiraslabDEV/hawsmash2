'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import type { User } from '@supabase/supabase-js';
import { brand } from '@brand';
import { createClient } from '@/utils/supabase/client';

// ─── Ícones (SVG inline, leves) ───────────────────────────────────────────────
function Icon({ name }: { name: string }) {
  const p: Record<string, React.ReactNode> = {
    pedidos: <path d="M6 2h9l5 5v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm8 1v5h5M8 12h8M8 16h8M8 8h3" />,
    cardapio: <path d="M3 4h18M3 12h18M3 20h18" />,
    caixa: <path d="M3 7h18v12H3zM3 7l2-3h14l2 3M8 13h.01M16 13a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" />,
    analise: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
    feedback: <path d="m12 2 3 7 7 .5-5.5 4.5 2 7-6.5-4-6.5 4 2-7L2 9.5 9 9z" />,
    clientes: <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87" />,
    marketing: <path d="m3 11 18-5v12L3 14v-3zM11.6 16.8a3 3 0 1 1-5.8-1.6" />,
    definicoes: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 0-.2-1.8l2-1.5-2-3.4-2.3 1a8 8 0 0 0-3-1.8L14 .5h-4l-.5 2.2a8 8 0 0 0-3 1.8l-2.3-1-2 3.4 2 1.5A8 8 0 0 0 4 12c0 .6 0 1.2.2 1.8l-2 1.5 2 3.4 2.3-1a8 8 0 0 0 3 1.8L10 23.5h4l.5-2.2a8 8 0 0 0 3-1.8l2.3 1 2-3.4-2-1.5c.2-.6.2-1.2.2-1.8Z" />,
    mesas: <path d="M3 10h18M3 10a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1M3 10v9a1 1 0 0 0 1 1h1v-3M21 10v9a1 1 0 0 1-1 1h-1v-3M7 20h10" />,
    estoque: <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9ZM3 7.5 12 12m0 0 9-4.5M12 12v9" />,
    equipa: <path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
    sistema: <path d="M4 5h16v10H4zM2 19h20M9 19v-4M15 19v-4M8 9h.01M12 9h4" />,
    lojas: <path d="M4 9h16l-1-4H5L4 9Zm0 0v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9M9 20v-6h6v6" />,
  };
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {p[name]}
    </svg>
  );
}

const NAV = [
  { href: '/pedidos', label: 'Pedidos', icon: 'pedidos', badge: true },
  { href: '/cardapio', label: 'Cardápio', icon: 'cardapio' },
  { href: '/mesas', label: 'Mesas', icon: 'mesas' },
  { href: '/caixa', label: 'Caixa', icon: 'caixa' },
  { href: '/estoque', label: 'Estoque', icon: 'estoque' },
  { href: '/analise', label: 'Análise', icon: 'analise' },
  { href: '/feedback', label: 'Avaliações', icon: 'feedback' },
  { href: '/lista-espera', label: 'Clientes', icon: 'clientes' },
  { href: '/marketing', label: 'Marketing', icon: 'marketing' },
  { href: '/lojas', label: 'Lojas', icon: 'lojas' },
  { href: '/equipa', label: 'Equipa', icon: 'equipa' },
  { href: '/sistema', label: 'Sistema', icon: 'sistema' },
  { href: '/definicoes', label: 'Definições', icon: 'definicoes' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [badge, setBadge] = useState<number | null>(null);
  const [storeOpen, setStoreOpen] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    async function checkAuth() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login'); return; }
      if (session.user.user_metadata?.role === 'kitchen') { router.replace('/'); return; }
      setUser(session.user);
      setLoading(false);
      // badge (pedidos ativos) + estado da loja
      supabase.rpc('get_order_stats').then(({ data }) => {
        if (data) setBadge((data.ativos ?? 0) + (data.aguarda_pagamento ?? 0));
      });
      supabase.from('settings').select('accepting_orders').eq('id', 1).single()
        .then(({ data }) => { if (data) setStoreOpen(data.accepting_orders); });
    }
    checkAuth();
  }, [router]);

  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#150D08] flex items-center justify-center">
        <div className="text-[#F5A623] text-lg font-semibold animate-pulse">A carregar painel…</div>
      </div>
    );
  }

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace('/login');
  };

  const Sidebar = (
    <aside className="flex h-full w-64 flex-col bg-white/[0.03] backdrop-blur-[12px] border-r border-white/[0.08]">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-white/[0.08]">
        {/* O logótipo tem lettering castanho escuro — precisa do chip creme para ler sobre o painel escuro. */}
        <span className="grid place-items-center w-9 h-9 shrink-0 rounded-lg bg-[#FBF6EC] p-[3px] shadow-[0_0_16px_rgba(245,166,35,0.35)]">
          <Image
            src={brand.storefront.logoImage}
            alt={brand.name}
            width={36}
            height={36}
            className="w-full h-full object-contain"
            priority
          />
        </span>
        <span className="leading-tight min-w-0">
          <span className="block font-bold text-white tracking-tight truncate">{brand.name}</span>
          <span className="block text-[11px] text-[#8A7A69]">Painel Admin</span>
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                active
                  ? 'bg-[#F5A623]/[0.12] text-[#F5A623] border-l-[3px] border-[#F5A623] shadow-[inset_0_0_16px_rgba(245,166,35,0.08)]'
                  : 'border-l-[3px] border-transparent text-[#C9BCAC] hover:bg-white/[0.06] hover:text-white'
              }`}
            >
              <Icon name={item.icon} />
              <span className="flex-1">{item.label}</span>
              {item.badge && badge != null && badge > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 grid place-items-center rounded-full text-[11px] font-bold bg-[#F5A623] text-[#2A1710]">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Rodapé: estado da loja */}
      <div className="border-t border-white/[0.08] p-4 space-y-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[#8A7A69] mb-1">Status da loja</p>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${storeOpen ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`} />
            <span className={`text-sm font-medium ${storeOpen ? 'text-green-400' : 'text-red-400'}`}>
              {storeOpen == null ? '—' : storeOpen ? 'Loja aberta' : 'Loja fechada'}
            </span>
          </div>
        </div>
        <a href="/menu" target="_blank" rel="noopener noreferrer"
          className="block text-center text-sm font-semibold rounded-xl border border-white/[0.08] py-2 text-[#F3E4CE] hover:bg-white/[0.06] transition-all">
          Ver loja
        </a>
      </div>
    </aside>
  );

  return (
    <div className="relative min-h-screen bg-[#150D08] text-[#F3E4CE] flex">
      {/* brilho ambiente para o glassmorphism ter profundidade */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0
        bg-[radial-gradient(60rem_40rem_at_85%_-10%,rgba(245,166,35,0.10),transparent_60%),radial-gradient(50rem_40rem_at_-10%_110%,rgba(245,166,35,0.06),transparent_55%)]" />

      {/* Sidebar desktop */}
      <div className="hidden lg:block fixed inset-y-0 left-0 z-30">{Sidebar}</div>

      {/* Drawer mobile */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={() => setDrawerOpen(false)} />
          <div className="relative h-full">{Sidebar}</div>
        </div>
      )}

      {/* Conteúdo */}
      <div className="relative z-10 flex-1 lg:ml-64 min-w-0">
        {/* Topbar */}
        <header className="sticky top-0 z-20 h-16 bg-white/[0.03] backdrop-blur-[12px] border-b border-white/[0.08] flex items-center gap-3 px-4 lg:px-6">
          <button onClick={() => setDrawerOpen(true)} className="lg:hidden text-[#C9BCAC] hover:text-white" aria-label="Menu">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
          </button>
          <div className="flex-1 max-w-md hidden sm:block">
            <div className="flex items-center gap-2 bg-black/20 border border-white/[0.08] rounded-xl px-3 py-2 backdrop-blur-[8px]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A3947F" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></svg>
              <input placeholder="Buscar pedido, cliente…" className="bg-transparent text-sm text-white placeholder-[#8A7A69] focus:outline-none w-full" />
              <kbd className="hidden md:inline-flex items-center gap-0.5 rounded-md border border-white/[0.10] bg-white/[0.04] px-1.5 text-[10px] text-[#8A7A69]">⌘K</kbd>
            </div>
          </div>
          <div className="flex-1 sm:hidden" />
          <button className="relative grid place-items-center w-9 h-9 rounded-xl border border-white/[0.08] text-[#C9BCAC] hover:text-white hover:bg-white/[0.06] transition-all" aria-label="Notificações">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></svg>
          </button>
          <div className="flex items-center gap-2 pl-2 border-l border-white/[0.08]">
            <div className="w-8 h-8 rounded-full bg-[#F5A623]/20 text-[#F5A623] grid place-items-center text-sm font-bold">
              {user?.email?.[0]?.toUpperCase() ?? 'A'}
            </div>
            <div className="hidden md:block leading-tight">
              <p className="text-sm font-medium text-white truncate max-w-[160px]">{user?.email}</p>
              <p className="text-[11px] text-[#8A7A69]">Administrador</p>
            </div>
            <button onClick={signOut} className="ml-1 text-sm text-[#C9BCAC] hover:text-[#F5A623] transition-colors">Sair</button>
          </div>
        </header>

        <main className="p-4 lg:p-6 max-w-[1400px] mx-auto">{children}</main>
      </div>
    </div>
  );
}
