'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { CompileResult, CompiledStep, RecordedEvent } from '@/lib/types';

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
}

function defaultParamName(step: CompiledStep): string {
  return slug(step.name || step.css || step.text) || `value_${step.n}`;
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 11v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="7.5" r="1.2" fill="currentColor" />
    </svg>
  );
}

export default function ReviewClient({
  recordingId,
  initial,
  events,
  profileId,
}: {
  recordingId: string;
  initial: CompileResult;
  events: RecordedEvent[];
  profileId: string | null;
}) {
  const [steps, setSteps] = useState<CompiledStep[]>(initial.steps);
  const [name, setName] = useState(initial.title);
  const [triggerType, setTriggerType] = useState<'phrase' | 'schedule'>('phrase');
  const [phrase, setPhrase] = useState(slug(initial.title).replace(/_/g, ' '));
  const [schedule, setSchedule] = useState('0 9 * * 1');
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [showEvents, setShowEvents] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const variableCount = useMemo(
    () => steps.filter((s) => s.param?.mode === 'variable').length,
    [steps],
  );

  useEffect(() => {
    if (menuFor == null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuFor(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuFor]);

  const updateStep = (index: number, patch: Partial<CompiledStep>) => {
    setSteps((prev) => prev.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  };

  const setMode = (index: number, mode: 'fixed' | 'variable') => {
    setSteps((prev) =>
      prev.map((step, i) =>
        i === index
          ? {
              ...step,
              param: {
                name: step.param?.name ?? defaultParamName(step),
                mode,
                value: step.value ?? step.param?.value,
              },
            }
          : step,
      ),
    );
  };

  const removeStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index).map((step, i) => ({ ...step, n: i + 1 })));
  };

  const mergeDown = (index: number) => {
    setSteps((prev) => {
      if (index >= prev.length - 1) return prev;
      const merged = [...prev];
      merged[index] = { ...merged[index], text: `${merged[index].text}; ${merged[index + 1].text}` };
      merged.splice(index + 1, 1);
      return merged.map((step, i) => ({ ...step, n: i + 1 }));
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          recordingId,
          name,
          trigger:
            triggerType === 'phrase'
              ? { type: 'phrase', value: phrase }
              : { type: 'schedule', value: schedule },
          steps,
          profileId,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Failed to save');
      setSavedId(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="lp-page">
      <div className="lp-wrap">
        <div className="lp-head">
          <p className="lp-kicker">Review · recording</p>
          <Link href="/" className="lp-backlink">
            ← Back to chat
          </Link>
        </div>

        <input className="lp-title-input" value={name} onChange={(e) => setName(e.target.value)} />
        <p className="lp-muted" style={{ marginTop: 2 }}>
          {initial.summary}
        </p>
        <p style={{ marginTop: 12 }}>
          {variableCount > 0 ? (
            <span className="lp-badge">
              {variableCount} value{variableCount === 1 ? '' : 's'} change each run
            </span>
          ) : (
            <span className="lp-badge neutral">All values are fixed</span>
          )}
        </p>

        <p className="lp-helper">
          <InfoIcon />
          <span>
            Click a value to choose whether it stays the same or changes each run. Edit any step
            text directly.
          </span>
        </p>

        <section className="lp-steps">
          {steps.map((step, index) => {
            const pillValue = step.value ?? step.param?.value;
            const showPill = pillValue != null || step.param != null;
            const variable = step.param?.mode === 'variable';
            return (
              <div key={index} className="lp-steprow">
                <div className="lp-stepnum">{String(step.n).padStart(2, '0')}</div>
                <div className="lp-stepbody">
                  <input
                    className="lp-steptext"
                    value={step.text}
                    onChange={(e) => updateStep(index, { text: e.target.value })}
                  />
                  {showPill && (
                    <div className="lp-pill-wrap">
                      <button
                        type="button"
                        className={`lp-pill${variable ? ' variable' : ''}`}
                        onClick={() => setMenuFor(menuFor === index ? null : index)}
                      >
                        <strong>{pillValue}</strong>
                        <span className="lp-pill-mode">{variable ? 'each run' : 'fixed'}</span>
                      </button>
                      {menuFor === index && (
                        <>
                          <div className="lp-menu-overlay" onClick={() => setMenuFor(null)} />
                          <div className="lp-menu">
                            {variable && step.param && (
                              <div style={{ padding: '4px 6px 2px' }}>
                                <label>parameter name</label>
                                <input
                                  className="lp-field mono"
                                  value={step.param.name}
                                  onChange={(e) =>
                                    updateStep(index, {
                                      param: { name: e.target.value, mode: 'variable', value: step.value },
                                    })
                                  }
                                />
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setMode(index, 'variable');
                                setMenuFor(null);
                              }}
                            >
                              <span>Changes each time</span>
                              {variable && <span className="lp-check">✓</span>}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setMode(index, 'fixed');
                                setMenuFor(null);
                              }}
                            >
                              <span>Always the same</span>
                              {!variable && step.param && <span className="lp-check">✓</span>}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="lp-stepactions">
                  {index < steps.length - 1 && (
                    <button type="button" className="lp-btn small ghost" onClick={() => mergeDown(index)}>
                      merge
                    </button>
                  )}
                  <button type="button" className="lp-btn small ghost danger" onClick={() => removeStep(index)} title="Delete step">
                    delete
                  </button>
                </div>
              </div>
            );
          })}
        </section>

        <button type="button" className="lp-btn ghost" style={{ marginTop: 14 }} onClick={() => setShowEvents((v) => !v)}>
          {showEvents ? 'Hide original events' : 'View original events'}
        </button>
        {showEvents && <pre className="lp-events">{events.map((e) => JSON.stringify(e)).join('\n')}</pre>}

        <section className="lp-save">
          <p className="lp-kicker">Save as loop</p>
          <h2 style={{ fontSize: 17, fontWeight: 650, margin: '8px 0 0', letterSpacing: '-0.01em' }}>
            Name it and set a trigger
          </h2>
          <p className="lp-muted" style={{ marginTop: 4, fontSize: 13 }}>
            Run it on demand, or exactly like this every time.
          </p>

          {savedId ? (
            <div className="lp-success">
              <strong>Saved.</strong>
              <Link href={`/run/${savedId}`} className="lp-btn primary">
                Run it now →
              </Link>
              <Link href="/library" className="lp-btn ghost">
                Go to library
              </Link>
            </div>
          ) : (
            <>
              <div className="lp-seg" style={{ marginTop: 16 }}>
                <button type="button" className={triggerType === 'phrase' ? 'active' : ''} onClick={() => setTriggerType('phrase')}>
                  Phrase
                </button>
                <button type="button" className={triggerType === 'schedule' ? 'active' : ''} onClick={() => setTriggerType('schedule')}>
                  Schedule
                </button>
              </div>
              <div style={{ marginTop: 12 }}>
                {triggerType === 'phrase' ? (
                  <input
                    className="lp-field"
                    value={phrase}
                    onChange={(e) => setPhrase(e.target.value)}
                    placeholder='e.g. "download unpaid invoices"'
                  />
                ) : (
                  <input
                    className="lp-field mono"
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value)}
                    placeholder="0 9 * * 1"
                  />
                )}
              </div>
              {error && <p className="lp-error">{error}</p>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 18 }}>
                <button type="button" className="lp-btn primary" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Looks good — save it'}
                </button>
                <span className="lp-faint" style={{ fontSize: 12.5 }}>
                  or keep refining above
                </span>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
