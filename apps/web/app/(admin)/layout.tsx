import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AdminShell } from './admin-shell';

// O painel instala-se como app própria, que abre em /pedidos. Sem isto, quem
// o punha no ecrã inicial recebia a app do POS (lib/pwa/manifests.ts).
export const metadata: Metadata = {
  manifest: '/painel.webmanifest',
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
