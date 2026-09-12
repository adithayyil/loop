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
    <main className="container">
      <div className="topbar">
        <p className="eyebrow">Review recording</p>
        <Link href="/library" className="small">
          Library
        </Link>
      </div>
      <input className="title-input" value={name} onChange={(e) => setName(e.target.value)} />
      <p className="muted" style={{ marginTop: 2 }}>{initial.summary}</p>
      <p style={{ marginTop: 10 }}>
        {variableCount > 0 ? (
          <span className="badge">{variableCount} value{variableCount === 1 ? '' : 's'} change each run</span>
        ) : (
          <span className="badge neutral">All values are fixed</span>
        )}
      </p>

      <p className="helper">
        Click a highlighted value to choose whether it stays the same or changes each run.
        Edit any step text directly.
      </p>

      <section className="card steps">
        {steps.map((step, index) => {
          const pillValue = step.value ?? step.param?.value;
          const showPill = pillValue != null || step.param != null;
          const variable = step.param?.mode === 'variable';
          return (
            <div key={index} className="step">
              <div className="step-num">{step.n}</div>
              <div className="step-body">
                <input
                  className="step-text"
                  value={step.text}
                  onChange={(e) => updateStep(index, { text: e.target.value })}
                />
                {showPill && (
                  <div className="menu-wrap">
                    <button
                      type="button"
                      className={`pill${variable ? ' variable' : ''}`}
                      onClick={() => setMenuFor(menuFor === index ? null : index)}
                    >
                      <strong>{pillValue}</strong>
                      <span>{variable ? 'changes each time' : 'always the same'}</span>
                    </button>
                    {menuFor === index && (
                      <div className="menu">
                        {variable && step.param && (
                          <div style={{ padding: '4px 6px 0' }}>
                            <label>parameter name</label>
                            <input
                              className="field"
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
                          {variable && <span className="check">✓</span>}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMode(index, 'fixed');
                            setMenuFor(null);
                          }}
                        >
                          <span>Always the same</span>
                          {!variable && step.param && <span className="check">✓</span>}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="step-actions">
                {index < steps.length - 1 && (
                  <button type="button" className="btn btn-small" onClick={() => mergeDown(index)}>
                    merge
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => removeStep(index)}
                  title="Delete step"
                >
                  delete
                </button>
              </div>
            </div>
          );
        })}
      </section>

      <button
        type="button"
        className="btn btn-ghost small"
        style={{ marginTop: 12 }}
        onClick={() => setShowEvents((v) => !v)}
      >
        {showEvents ? 'Hide original events' : 'View original events'}
      </button>
      {showEvents && <pre className="events">{events.map((e) => JSON.stringify(e)).join('\n')}</pre>}

      <section className="card" style={{ padding: 20, marginTop: 32 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Name it and set a trigger</h2>
        <p className="muted small" style={{ marginTop: 4 }}>
          Run it on demand, or exactly like this every time.
        </p>

        {savedId ? (
          <div className="save-success" style={{ marginTop: 16 }}>
            <strong>Saved.</strong>
            <Link href={`/run/${savedId}`} className="btn btn-primary">
              Run it now →
            </Link>
            <Link href="/library">Go to library</Link>
          </div>
        ) : (
          <>
            <div className="segmented" style={{ marginTop: 14 }}>
              <button
                type="button"
                className={triggerType === 'phrase' ? 'active' : ''}
                onClick={() => setTriggerType('phrase')}
              >
                Phrase
              </button>
              <button
                type="button"
                className={triggerType === 'schedule' ? 'active' : ''}
                onClick={() => setTriggerType('schedule')}
              >
                Schedule
              </button>
            </div>
            <div style={{ marginTop: 10 }}>
              {triggerType === 'phrase' ? (
                <input
                  className="field"
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  placeholder='e.g. "download unpaid invoices"'
                />
              ) : (
                <input
                  className="field"
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  placeholder="0 9 * * 1"
                  style={{ fontFamily: 'monospace' }}
                />
              )}
            </div>
            {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 16 }}>
              <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Looks good — save it'}
              </button>
              <span className="muted small">or keep refining above</span>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
