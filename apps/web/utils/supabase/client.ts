import { createBrowserClient } from '@supabase/ssr';

// Fallbacks evitam que o construtor rebente durante o `next build`
// (prerender estático corre sem env). Em runtime as env reais estão presentes.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key',
    {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    },
  );
}
