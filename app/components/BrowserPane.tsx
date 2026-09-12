'use client';

import { useEffect, useState, type ReactNode } from 'react';

function ExpandIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CompressIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 4v5H4M15 20v-5h5M20 9h-5V4M4 15h5v5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function BrowserPane({
  src,
  title = 'Live browser',
  label,
  recording = false,
  address,
  onAddressChange,
  onNavigate,
  placeholder = 'Type a URL and press Enter',
  actions,
  className = '',
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
      <div className={`lp-browser ${full ? 'lp-browser--full' : ''} ${className}`.trim()}>
        <div className="lp-browser-bar">
          {recording ? (
            <span className="lp-rec-chip">
              <span className="lp-led" />
              rec
            </span>
          ) : (
            <span className="lp-browser-dots">
              <span />
              <span />
              <span />
            </span>
          )}

          {onAddressChange ? (
            <input
              className="lp-browser-url"
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
            />
          ) : (
            <span className="lp-browser-url lp-browser-static">{label ?? 'live session'}</span>
          )}

          {actions}

          <button
            type="button"
            className="lp-icon-btn"
            onClick={() => setFull((value) => !value)}
            title={full ? 'Exit full screen (Esc)' : 'Full screen'}
            aria-label={full ? 'Exit full screen' : 'Full screen'}
          >
            {full ? <CompressIcon /> : <ExpandIcon />}
          </button>
        </div>

        <iframe
          src={src}
          title={title}
          className="lp-browser-view"
          allow="clipboard-read; clipboard-write"
        />
      </div>

      {full && <div className="lp-fullhint">Full screen · press Esc to exit</div>}
    </>
  );
}
