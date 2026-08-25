import type { Metadata, Viewport } from 'next';
import { Inter, Oswald } from 'next/font/google';
import './globals.css';
import { CollectionProvider } from '@/components/shared/CollectionProvider';
import { ServiceWorker } from '@/components/shared/ServiceWorker';
import { TabBar } from '@/components/shared/TabBar';

const display = Oswald({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-display-src' });
const sans = Inter({ subsets: ['latin'], variable: '--font-sans-src' });

export const metadata: Metadata = {
  title: 'Hoja — tu álbum de cartas',
  description:
    'Tu colección de cartas como un álbum de verdad: lo que tienes, lo que te falta, ' +
    'tus repes y lo que vale. Funciona sin conexión.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Hoja' },
};

export const viewport: Viewport = {
  themeColor: '#0b1a15',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${display.variable} ${sans.variable}`}>
      <body className="pb-[calc(4.25rem+env(safe-area-inset-bottom))]">
        <CollectionProvider>
          {children}
          <TabBar />
          <ServiceWorker />
        </CollectionProvider>
      </body>
    </html>
  );
}
