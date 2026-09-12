'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AgentRecord } from '@/lib/agent-runs';

interface Active {
  id: string;
  sessionId: string;
  debugUrl: string;
}

function format(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function RecordClient({ defaultStartUrl }: { defaultStartUrl: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<'manual' | 'agent'>('manual');
  const [startUrl, setStartUrl] = useState(defaultStartUrl);
  const [goal, setGoal] = useState('');
  const [error, setError] = useState<string | null>(null);

  // manual recording
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'stopping'>('idle');
  const [active, setActive] = useState<Active | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // agent run
  const [agentRunId, setAgentRunId] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentRecord | null>(null);

  useEffect(() => {
    if (phase !== 'recording') return;
    timer.current = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [phase]);

  useEffect(() => {
    if (!agentRunId) return;
    const poll = setInterval(async () => {
      const response = await fetch(`/api/agent/${agentRunId}`).catch(() => null);
      if (!response) return;
      const data = await response.json();
      if (!data.run) return;
      setAgent(data.run as AgentRecord);
      if (data.run.status !== 'running') {
        clearInterval(poll);
        if (data.run.recordingId) router.push(`/review/${data.run.recordingId}`);
      }
    }, 1000);
    return () => clearInterval(poll);
  }, [agentRunId, router]);

  const startManual = async () => {
    setError(null);
    setPhase('starting');
    try {
      const response = await fetch('/api/recordings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ startUrl }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not start recording');
      setActive(data as Active);
      setElapsed(0);
      setPhase('recording');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start recording');
      setPhase('idle');
    }
  };

  const stopManual = async () => {
    if (!active) return;
    setPhase('stopping');
    try {
      const response = await fetch(`/api/recordings/${active.id}/stop`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not stop recording');
      router.push(`/review/${active.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not stop recording');
      setPhase('recording');
    }
  };

  const startAgent = async () => {
    setError(null);
    setAgent(null);
    setAgentRunId(null);
    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goal, startUrl }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not start the agent');
      setAgentRunId(data.runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the agent');
    }
  };

  if (phase === 'recording' && active) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#0b0b0f', display: 'flex', flexDirection: 'column' }}>
        <iframe src={active.debugUrl} title="Steel recording session" allow="clipboard-read; clipboard-write" style={{ flex: 1, border: 'none', width: '100%' }} />
        <div style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 14, background: 'rgba(24,24,27,.92)', color: '#fff', borderRadius: 999, padding: '10px 16px', boxShadow: '0 12px 40px rgba(0,0,0,.4)' }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 0 4px rgba(239,68,68,.25)' }} />
          <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{format(elapsed)}</span>
          <button type="button" onClick={stopManual} style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 999, padding: '7px 16px', fontWeight: 600, cursor: 'pointer' }}>
            Stop
          </button>
        </div>
      </div>
    );
  }

  const agentRunning = agentRunId != null && (agent == null || agent.status === 'running');

  return (
    <main className="container">
      <div className="topbar">
        <h1 style={{ fontSize: 24, margin: 0 }}>Record a task</h1>
        <a href="/">Home</a>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        Show it once or describe it once — either way you get an editable, replayable step list.
      </p>

      <div className="segmented" style={{ marginTop: 16 }}>
        <button type="button" className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')}>
          I&apos;ll show it
        </button>
        <button type="button" className={mode === 'agent' ? 'active' : ''} onClick={() => setMode('agent')}>
          Let the agent do it
        </button>
      </div>

      <label className="eyebrow" style={{ display: 'block', marginTop: 20 }}>
        Start URL
      </label>
      <input
        className="field"
        value={startUrl}
        onChange={(event) => setStartUrl(event.target.value)}
        placeholder="https://your-app.example.com/login"
        style={{ marginTop: 6 }}
      />

      {mode === 'agent' && (
        <>
          <label className="eyebrow" style={{ display: 'block', marginTop: 16 }}>
            What should it do?
          </label>
          <textarea
            className="field"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="Log in with username vendor and password hunter2, then download the unpaid invoice PDF"
            rows={3}
            style={{ marginTop: 6, resize: 'vertical' }}
          />
        </>
      )}

      {!defaultStartUrl && (
        <p className="helper" style={{ marginTop: 12 }}>
          The Steel cloud browser must be able to reach this URL. For the local demo app, run
          <code> npm run tunnel</code> and set <code>LOOP_DEMO_URL</code> to the printed
          trycloudflare URL.
        </p>
      )}
      {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}

      {mode === 'manual' ? (
        <>
          <button
            type="button"
            className="btn btn-primary"
            onClick={startManual}
            disabled={phase === 'starting' || startUrl.trim() === ''}
            style={{ marginTop: 16, fontSize: 16, padding: '12px 22px' }}
          >
            {phase === 'starting' ? 'Starting cloud browser…' : '● Record'}
          </button>
          <p className="muted small" style={{ marginTop: 10 }}>
            Replays reuse the login from this recording — you only sign in once.
          </p>
        </>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-primary"
            onClick={startAgent}
            disabled={agentRunning || startUrl.trim() === '' || goal.trim() === ''}
            style={{ marginTop: 16, fontSize: 16, padding: '12px 22px' }}
          >
            {agentRunning ? 'Working…' : '▶ Let the agent try'}
          </button>
          <p className="muted small" style={{ marginTop: 10 }}>
            The agent drives a cloud browser and records what it does, so replays are deterministic.
          </p>
        </>
      )}

      {mode === 'agent' && (agentRunId || agent) && (
        <div className={`banner ${agent?.status === 'failed' ? 'needs' : agent?.status === 'done' ? 'done' : 'running'}`}>
          {agent?.status === 'failed'
            ? `Needs you — ${agent.error ?? 'agent stopped'}`
            : agent?.status === 'done'
              ? `Done — ${agent.summary ?? 'task complete'}`
              : 'Agent is working…'}
        </div>
      )}

      {agent?.debugUrl && (
        <iframe src={agent.debugUrl} title="Steel agent session" className="viewer" allow="clipboard-read; clipboard-write" style={{ marginTop: 12 }} />
      )}

      {agent && agent.steps.length > 0 && (
        <ol className="events" style={{ listStyle: 'none', padding: 12, whiteSpace: 'normal' }}>
          {agent.steps.map((step) => (
            <li key={step.n} style={{ marginBottom: 4 }}>
              <strong>{step.action}</strong> {step.detail}
              {step.result ? <span className="muted"> — {step.result}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
