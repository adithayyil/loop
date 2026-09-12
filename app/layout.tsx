import type { ReactNode } from 'react';
import { Space_Grotesk, Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const grotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-ui',
  display: 'swap',
});

const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata = {
  title: 'loop',
  description: 'Show it once, it does it forever.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${grotesk.variable} ${serif.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
