'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function HomeActions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const compileSample = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fixture: 'invoice-unpaid' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not compile the sample');
      router.push(`/review/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not compile the sample');
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 20 }}>
      <button type="button" className="btn btn-primary" onClick={compileSample} disabled={busy}>
        {busy ? 'Compiling…' : 'Compile the sample recording'}
      </button>
      {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
    </div>
  );
}
