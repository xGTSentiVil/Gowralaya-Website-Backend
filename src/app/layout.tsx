import type { Metadata } from 'next';
import './globals.css';

// This app is the website's API plus the private updates portal. Nothing here
// is meant for search engines.
export const metadata: Metadata = {
  title: 'Sri Gowralaya Builders',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
