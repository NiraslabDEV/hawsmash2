/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@delivery/core", "@delivery/paysuite"],
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
