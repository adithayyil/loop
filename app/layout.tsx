import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'loop',
  description: 'Show it once, it does it forever.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
