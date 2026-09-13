'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function BrowserPane({
  src,
  title = 'Live browser',
  label,
  recording = false,
  address,
  onAddressChange,
  onNavigate,
  placeholder = 'Type a URL and press Enter',
  actions,
  className,
}: {
  src: string;
  title?: string;
  label?: string;
  recording?: boolean;
  address?: string;
  onAddressChange?: (value: string) => void;
  onNavigate?: () => void;
  placeholder?: string;
  actions?: ReactNode;
  className?: string;
}) {
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (!full) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  return (
    <>
      <div
        className={cn(
          'overflow-hidden rounded-xl border bg-card shadow-sm',
          full && 'fixed inset-3 z-50 shadow-2xl',
          className,
        )}
      >
        <div className="flex h-11 items-center gap-2 border-b bg-background/60 px-2.5">
          {recording ? (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-destructive/15 px-2 py-1 text-[11px] font-semibold tracking-wide text-destructive uppercase">
              <span className="size-1.5 animate-pulse rounded-full bg-destructive" />
              rec
            </span>
          ) : (
            <span className="flex gap-1.5 pl-1.5">
              <span className="size-2.5 rounded-full bg-muted-foreground/30" />
              <span className="size-2.5 rounded-full bg-muted-foreground/30" />
              <span className="size-2.5 rounded-full bg-muted-foreground/30" />
            </span>
          )}

          {onAddressChange ? (
            <Input
              value={address}
              onChange={(event) => onAddressChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onNavigate?.();
                }
              }}
              placeholder={placeholder}
              spellCheck={false}
              className="h-7 flex-1 font-mono text-xs"
            />
          ) : (
            <span className="flex-1 truncate px-1 text-xs text-muted-foreground">
              {label ?? 'live session · steel cloud'}
            </span>
          )}

          {actions}

          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => setFull((value) => !value)}
            title={full ? 'Exit full screen (Esc)' : 'Full screen'}
            aria-label={full ? 'Exit full screen' : 'Full screen'}
          >
            {full ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </div>

        <iframe
          src={src}
          title={title}
          className={cn('w-full border-0 bg-white', full ? 'h-[calc(100svh-4.5rem)]' : 'h-[520px]')}
          allow="clipboard-read; clipboard-write"
        />
      </div>

      {full && <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border bg-popover px-3 py-1 text-xs text-muted-foreground shadow-lg">Full screen · press Esc to exit</div>}
    </>
  );
}
