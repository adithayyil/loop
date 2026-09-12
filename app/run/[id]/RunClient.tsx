'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { RunRecord } from '@/lib/runs';
import type { Skill } from '@/lib/types';
import BrowserPane from '@/app/components/BrowserPane';

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function FileIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M13 3v6h6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

export default function RunClient({ skill }: { skill: Skill }) {
  const variableParams = skill.steps.filter((step) => step.param?.mode === 'variable');
  const [params, setParams] = useState<Record<string, string>>(
    Object.fromEntries(variableParams.map((s) => [s.param!.name, s.param!.value ?? s.value ?? ''])),
  );
  const [runId, setRunId] = useState<string | null>(null);
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

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

  const running = (runId != null && record == null) || record?.status === 'running';

  useEffect(() => {
    if (!running || startedAt == null) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running, startedAt]);

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
      setStartedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Run failed');
    }
  };

  const result = record?.result;
  const finished = record?.status === 'done' || record?.status === 'failed';

  const banner = running
    ? { cls: 'running', text: 'Running' }
    : record?.status === 'done'
      ? { cls: 'done', text: 'Done' }
      : record?.status === 'failed'
        ? { cls: 'needs', text: `Needs you — ${record.error ?? result?.error}` }
        : error
          ? { cls: 'needs', text: `Needs you — ${error}` }
          : null;

  return (
    <main className="lp-page">
      <div className="lp-wrap wide">
        <div className="lp-head">
          <p className="lp-kicker">Run · loop</p>
          <Link href="/" className="lp-backlink">
            ← Back to chat
          </Link>
        </div>

        <h1 className="lp-h1">{skill.name}</h1>
        <p className="lp-faint" style={{ fontSize: 12.5, marginTop: 6 }}>
          <span className="lp-mono">
            {skill.trigger.type} · {skill.trigger.value}
          </span>
          {skill.profileId ? ' · saved login reused' : ' · no saved login'}
        </p>

        {banner && (
          <div className={`lp-runstrip ${banner.cls}`}>
            <span className={`lp-orbit ${banner.cls === 'running' ? 'running' : banner.cls === 'done' ? 'done' : 'failed'}`} />
            {banner.text}
            {running && startedAt != null && <span className="lp-elapsed">{formatClock(now - startedAt)}</span>}
          </div>
        )}

        {record?.debugUrl && (
          <section style={{ margin: '12px 0' }}>
            <BrowserPane src={record.debugUrl} title="Steel live session" label="live session — steel cloud" />
            <div className="lp-takeover">
              <a href={record.debugUrl} target="_blank" rel="noreferrer">
                Take over in a new tab ↗
              </a>
              <span className="lp-faint" style={{ fontSize: 12 }}>
                we don&apos;t see what you type
              </span>
            </div>
          </section>
        )}

        {!running && !finished && variableParams.length > 0 && (
          <section style={{ marginTop: 14 }}>
            <p className="lp-kicker" style={{ marginBottom: 12 }}>
              Ask each time
            </p>
            {variableParams.map((step) => (
              <label key={step.param!.name} style={{ display: 'block', marginBottom: 12, fontSize: 14 }}>
                <span className="lp-faint lp-mono" style={{ display: 'block', fontSize: 11, marginBottom: 5 }}>
                  {step.param!.name} — {step.text}
                </span>
                <input
                  className="lp-field"
                  value={params[step.param!.name] ?? ''}
                  onChange={(e) => setParams((prev) => ({ ...prev, [step.param!.name]: e.target.value }))}
                />
              </label>
            ))}
          </section>
        )}

        {!finished && (
          <button type="button" className="lp-btn primary" onClick={start} disabled={running} style={{ marginTop: 10 }}>
            {running ? 'Running…' : runId ? 'Run again' : 'Run now →'}
          </button>
        )}

        {finished && result && (
          <section className="lp-save">
            <p className="lp-kicker">Result</p>
            <p style={{ margin: '10px 0 0', fontSize: 14 }}>
              {result.stepsRun}/{result.totalSteps} steps
              {result.skipped ? ` · ${result.skipped} skipped (already signed in)` : ''}
              {result.finalUrl ? (
                <>
                  {' '}
                  · final URL{' '}
                  <code className="lp-mono" style={{ fontSize: 12 }}>
                    {result.finalUrl}
                  </code>
                </>
              ) : null}
            </p>

            <p className="lp-kicker" style={{ margin: '20px 0 4px' }}>
              Downloads
            </p>
            {result.files.length === 0 ? (
              <p className="lp-muted" style={{ fontSize: 13 }}>
                No files downloaded.
              </p>
            ) : (
              <div className="lp-files">
                {result.files.map((file) => (
                  <a key={file.path} href={`/api/downloads/${runId}/${file.name}`} className="lp-file">
                    <span className="lp-file-icon">
                      <FileIcon />
                    </span>
                    <span>
                      <span className="lp-file-name">{file.name}</span>
                      <span className="lp-file-size" style={{ display: 'block' }}>
                        {file.size} bytes
                      </span>
                    </span>
                    <span className="lp-file-arrow">↓</span>
                  </a>
                ))}
              </div>
            )}

            <p className="lp-faint" style={{ fontSize: 12 }}>
              Next runs will be silent.
            </p>
            <button
              type="button"
              className="lp-btn"
              onClick={() => {
                setRunId(null);
                setRecord(null);
                setStartedAt(null);
              }}
            >
              Run again
            </button>
          </section>
        )}

        {!running && (
          <details className="lp-details">
            <summary>Steps</summary>
            <ol className="lp-stepslist">
              {skill.steps.map((step) => (
                <li key={step.n}>{step.text}</li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </main>
  );
}
