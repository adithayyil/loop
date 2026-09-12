'use client';

import { useMemo, useState } from 'react';
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
    <main className="dk-page loop-dark">
      <div className="dk-wrap">
        <div className="dk-head">
          <p className="dk-eyebrow">Review</p>
          <Link href="/" className="dk-link">
            Back to chat
          </Link>
        </div>

        <input className="dk-title" value={name} onChange={(e) => setName(e.target.value)} />
        <p className="dk-muted" style={{ marginTop: 2 }}>
          {initial.summary}
        </p>
        <p style={{ marginTop: 10 }}>
          {variableCount > 0 ? (
            <span className="dk-badge">
              {variableCount} value{variableCount === 1 ? '' : 's'} change each run
            </span>
          ) : (
            <span className="dk-badge neutral">All values are fixed</span>
          )}
        </p>

        <p className="dk-helper">
          Click a value to choose whether it stays the same or changes each run. Edit any step text
          directly.
        </p>

        <section className="dk-card dk-list">
          {steps.map((step, index) => {
            const pillValue = step.value ?? step.param?.value;
            const showPill = pillValue != null || step.param != null;
            const variable = step.param?.mode === 'variable';
            return (
              <div key={index} className="dk-row">
                <div className="dk-num">{step.n}</div>
                <div className="dk-rowbody">
                  <input
                    className="dk-text"
                    value={step.text}
                    onChange={(e) => updateStep(index, { text: e.target.value })}
                  />
                  {showPill && (
                    <div className="dk-pill-wrap">
                      <button
                        type="button"
                        className={`dk-pill${variable ? ' variable' : ''}`}
                        onClick={() => setMenuFor(menuFor === index ? null : index)}
                      >
                        <strong>{pillValue}</strong>
                        <span>{variable ? 'changes each time' : 'always the same'}</span>
                      </button>
                      {menuFor === index && (
                        <div className="dk-menu">
                          {variable && step.param && (
                            <div style={{ padding: '4px 6px 0' }}>
                              <label>parameter name</label>
                              <input
                                className="dk-input"
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
                            {variable && <span className="dk-check">✓</span>}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMode(index, 'fixed');
                              setMenuFor(null);
                            }}
                          >
                            <span>Always the same</span>
                            {!variable && step.param && <span className="dk-check">✓</span>}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="dk-rowactions">
                  {index < steps.length - 1 && (
                    <button type="button" className="dk-btn small ghost" onClick={() => mergeDown(index)}>
                      merge
                    </button>
                  )}
                  <button type="button" className="dk-btn small ghost" onClick={() => removeStep(index)} title="Delete step">
                    delete
                  </button>
                </div>
              </div>
            );
          })}
        </section>

        <button type="button" className="dk-btn ghost" style={{ marginTop: 12 }} onClick={() => setShowEvents((v) => !v)}>
          {showEvents ? 'Hide original events' : 'View original events'}
        </button>
        {showEvents && <pre className="dk-events">{events.map((e) => JSON.stringify(e)).join('\n')}</pre>}

        <section className="dk-save">
          <h2 style={{ fontSize: 16, margin: 0 }}>Name it and set a trigger</h2>
          <p className="dk-muted" style={{ marginTop: 4, fontSize: 13 }}>
            Run it on demand, or exactly like this every time.
          </p>

          {savedId ? (
            <div className="dk-success">
              <strong>Saved.</strong>
              <Link href={`/run/${savedId}`} className="dk-btn primary">
                Run it now →
              </Link>
              <Link href="/library" className="dk-link">
                Go to library
              </Link>
            </div>
          ) : (
            <>
              <div className="dk-seg" style={{ marginTop: 14 }}>
                <button type="button" className={triggerType === 'phrase' ? 'active' : ''} onClick={() => setTriggerType('phrase')}>
                  Phrase
                </button>
                <button type="button" className={triggerType === 'schedule' ? 'active' : ''} onClick={() => setTriggerType('schedule')}>
                  Schedule
                </button>
              </div>
              <div style={{ marginTop: 10 }}>
                {triggerType === 'phrase' ? (
                  <input
                    className="dk-input"
                    value={phrase}
                    onChange={(e) => setPhrase(e.target.value)}
                    placeholder='e.g. "download unpaid invoices"'
                  />
                ) : (
                  <input
                    className="dk-input mono"
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value)}
                    placeholder="0 9 * * 1"
                  />
                )}
              </div>
              {error && <p className="dk-error">{error}</p>}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16 }}>
                <button type="button" className="dk-btn primary" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Looks good — save it'}
                </button>
                <span className="dk-muted" style={{ fontSize: 13 }}>
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
