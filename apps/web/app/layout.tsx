import type { Metadata } from 'next';
import { DM_Sans, Bebas_Neue } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-body' });
const bebasNeue = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: 'Delivery OS',
  description: 'Sistema de encomendas online para restaurantes em Moçambique',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-MZ" className={`${dmSans.variable} ${bebasNeue.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
