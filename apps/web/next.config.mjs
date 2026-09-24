/** @type {import('next').NextConfig} */
const nextConfig = {
  // A versão do build, igual no browser e no servidor: o POS compara as duas
  // (`/api/version`) e recarrega-se quando há deploy novo (lib/pos/app-update.ts).
  env: {
    NEXT_PUBLIC_APP_BUILD: process.env.RAILWAY_GIT_COMMIT_SHA || `build-${Date.now()}`,
  },
  transpilePackages: ["@delivery/core", "@delivery/payments", "@delivery/receipt"],
  images: {
    // Fotos de produto vêm do Storage do Supabase do cliente (whitelabel);
    // o demo usa também assets locais (/assets/*) e, no protótipo, Unsplash.
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
};

export default nextConfig;
