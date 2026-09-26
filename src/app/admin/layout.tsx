import type { Metadata, Viewport } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';
import './admin.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-playfair',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Site updates · Sri Gowralaya',
  robots: { index: false, follow: false },
  // Lets the portal be added to the phone's home screen like an app.
  appleWebApp: { capable: true, title: 'Gowralaya Updates', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#FDF8F0',
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className={`admin ${inter.variable} ${playfair.variable}`}>{children}</div>;
}
