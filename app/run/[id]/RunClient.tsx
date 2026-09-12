'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { RunRecord } from '@/lib/runs';
import type { Skill } from '@/lib/types';

export default function RunClient({ skill }: { skill: Skill }) {
  const variableParams = skill.steps.filter((step) => step.param?.mode === 'variable');
  const [params, setParams] = useState<Record<string, string>>(
    Object.fromEntries(variableParams.map((s) => [s.param!.name, s.param!.value ?? s.value ?? ''])),
  );
  const [runId, setRunId] = useState<string | null>(null);
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/runs/${runId}`).catch(() => null);
      if (!response) return;
      const data = await response.json();
      if (data.run) {
        setRecord(data.run as RunRecord);
        if (data.run.status !== 'running') clearInterval(timer);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [runId]);

  const start = async () => {
    setError(null);
    setRecord(null);
    try {
      const response = await fetch(`/api/skills/${skill.id}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ params }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Run failed');
      setRunId(data.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Run failed');
    }
  };

  const running = (runId != null && record == null) || record?.status === 'running';
  const result = record?.result;
  const finished = record?.status === 'done' || record?.status === 'failed';

  const banner = running
    ? { cls: 'running', text: 'Running…' }
    : record?.status === 'done'
      ? { cls: 'done', text: 'Done' }
      : record?.status === 'failed'
        ? { cls: 'needs', text: `Needs you — ${record.error ?? result?.error}` }
        : error
          ? { cls: 'needs', text: `Needs you — ${error}` }
          : null;

  return (
    <main className="container container-wide">
      <div className="topbar">
        <h1 style={{ fontSize: 22, margin: 0 }}>{skill.name}</h1>
        <Link href="/library">Library</Link>
      </div>
      <p className="muted small">
        Trigger: <code>{skill.trigger.type}: {skill.trigger.value}</code>
        {skill.profileId ? ' · saved login reused' : ' · no saved login'}
      </p>

      {banner && <div className={`banner ${banner.cls}`}>{banner.text}</div>}

      {record?.debugUrl && (
        <section style={{ margin: '12px 0' }}>
          <iframe src={record.debugUrl} title="Steel live session" className="viewer" allow="clipboard-read; clipboard-write" />
          <div style={{ display: 'flex', gap: 12, marginTop: 8, alignItems: 'center' }}>
            <a href={record.debugUrl} target="_blank" rel="noreferrer" className="small">
              Take over in a new tab
            </a>
            <span className="muted small">we don&apos;t see what you type</span>
          </div>
        </section>
      )}

      {!running && !finished && variableParams.length > 0 && (
        <section style={{ marginTop: 8 }}>
          <h2 className="eyebrow" style={{ marginBottom: 8 }}>Ask each time</h2>
          {variableParams.map((step) => (
            <label key={step.param!.name} style={{ display: 'block', marginBottom: 10, fontSize: 14 }}>
              <span className="muted small" style={{ display: 'block' }}>
                {step.param!.name} — {step.text}
              </span>
              <input
                className="field"
                value={params[step.param!.name] ?? ''}
                onChange={(e) => setParams((prev) => ({ ...prev, [step.param!.name]: e.target.value }))}
              />
            </label>
          ))}
        </section>
      )}

      {!finished && (
        <button type="button" className="btn btn-primary" onClick={start} disabled={running} style={{ marginTop: 8 }}>
          {running ? 'Running…' : runId ? 'Run again' : 'Run now'}
        </button>
      )}

      {finished && result && (
        <section className="card" style={{ padding: 20, marginTop: 18 }}>
          <p style={{ margin: 0 }}>
            {result.stepsRun}/{result.totalSteps} steps
            {result.skipped ? ` · ${result.skipped} skipped (already signed in)` : ''}
            {result.finalUrl ? <> · final URL <code>{result.finalUrl}</code></> : null}
          </p>
          <h2 className="eyebrow" style={{ margin: '16px 0 6px' }}>Downloads</h2>
          {result.files.length === 0 ? (
            <p className="muted small">No files downloaded.</p>
          ) : (
            <ul>
              {result.files.map((file) => (
                <li key={file.path}>
                  <a href={`/api/downloads/${runId}/${file.name}`}>
                    <code>{file.name}</code>
                  </a>{' '}
                  <span className="muted small">({file.size} bytes)</span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">Next runs will be silent.</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setRunId(null);
              setRecord(null);
            }}
          >
            Run again
          </button>
        </section>
      )}

      {!running && (
        <details style={{ marginTop: 24 }}>
          <summary className="muted small" style={{ cursor: 'pointer' }}>Steps</summary>
          <ol style={{ color: '#3f3f46', fontSize: 14 }}>
            {skill.steps.map((step) => (
              <li key={step.n}>{step.text}</li>
            ))}
          </ol>
        </details>
      )}
    </main>
  );
}
