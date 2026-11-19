import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// O portal é privado: nunca em motores de busca, nunca a mandar o endereço a outros sites.
export const metadata: Metadata = {
  title: 'Contabilista',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default function ContabilistaLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-[#16110d] text-[#E9DFD2]">{children}</div>;
}
