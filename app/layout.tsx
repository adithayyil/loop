import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Space_Grotesk, Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { cn } from '@/lib/utils';
import { store } from '@/lib/store';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/app/components/app-sidebar';

const grotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-grotesk', display: 'swap' });
const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument',
  display: 'swap',
});
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  title: 'loop',
  description: 'Show it once, it does it forever.',
};

function sidebarLoops(): Array<{ id: string; name: string }> {
  try {
    return store.skills.values().map((skill) => ({ id: skill.id, name: skill.name }));
  } catch {
    return [];
  }
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn('dark', grotesk.variable, serif.variable, mono.variable)}>
      <body className="min-h-svh antialiased">
        <TooltipProvider delay={200}>
          <SidebarProvider>
            <AppSidebar loops={sidebarLoops()} />
            <SidebarInset>{children}</SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
