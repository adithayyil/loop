'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface Step {
  n: number;
  action: string;
  detail: string;
  result?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text?: string;
  steps?: Step[];
  status?: 'running' | 'done' | 'failed';
  debugUrl?: string;
  recordingId?: string;
  summary?: string;
  error?: string;
}

interface SkillSummary {
  id: string;
  name: string;
  trigger: { type: string; value: string };
}

const SUGGESTIONS = [
  'Log in, filter to Unpaid, and download the first invoice PDF',
  'Log in and download every unpaid invoice',
  'Find the newest invoice and open its detail page',
];

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ChatClient({
  defaultStartUrl,
  initialSkills,
}: {
  defaultStartUrl: string;
  initialSkills: SkillSummary[];
}) {
  const [startUrl, setStartUrl] = useState(defaultStartUrl);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [skills, setSkills] = useState<SkillSummary[]>(initialSkills);
  const threadRef = useRef<HTMLDivElement>(null);
  const intervals = useRef<Set<ReturnType<typeof setInterval>>>(new Set());

  useEffect(() => {
    return () => {
      intervals.current.forEach(clearInterval);
    };
  }, []);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  const patch = (id: string, update: Partial<Message>) => {
    setMessages((prev) => prev.map((message) => (message.id === id ? { ...message, ...update } : message)));
  };

  const refreshSkills = async () => {
    const response = await fetch('/api/skills').catch(() => null);
    if (!response) return;
    const data = await response.json();
    setSkills(data.skills ?? []);
  };

  const send = async (text: string) => {
    const goal = text.trim();
    if (!goal || busy) return;
    setInput('');

    if (!startUrl.trim()) {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'user', text: goal },
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          status: 'failed',
          error: 'Set a site URL above first (or set LOOP_DEMO_URL).',
        },
      ]);
      return;
    }

    setBusy(true);

    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', text: goal },
      { id: assistantId, role: 'assistant', status: 'running', steps: [] },
    ]);

    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goal, startUrl }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not start the agent');

      const runId: string = data.runId;
      const interval = setInterval(async () => {
        const poll = await fetch(`/api/agent/${runId}`).catch(() => null);
        if (!poll) return;
        const payload = await poll.json();
        const run = payload.run;
        if (!run) return;
        patch(assistantId, {
          steps: run.steps,
          status: run.status,
          debugUrl: run.debugUrl,
          recordingId: run.recordingId,
          summary: run.summary,
          error: run.error,
        });
        if (run.status !== 'running') {
          clearInterval(interval);
          intervals.current.delete(interval);
          setBusy(false);
          if (run.recordingId) void refreshSkills();
        }
      }, 1000);
      intervals.current.add(interval);
    } catch (error) {
      patch(assistantId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Agent failed to start',
      });
      setBusy(false);
    }
  };

  const newTask = () => {
    intervals.current.forEach(clearInterval);
    intervals.current.clear();
    setMessages([]);
    setBusy(false);
    setInput('');
  };

  const empty = messages.length === 0;

  return (
    <div className="lc-app">
      <aside className="lc-sidebar">
        <div className="lc-brand">
          <div className="lc-logo">l</div>
          <div>
            <div className="lc-brand-name">loop</div>
            <div className="lc-brand-sub">show it once, it does it forever</div>
          </div>
        </div>

        <button type="button" className="lc-new" onClick={newTask}>
          + New task
        </button>

        <div className="lc-section">Your loops</div>
        <div className="lc-list">
          {skills.length === 0 ? (
            <div className="lc-item" style={{ color: '#6b6b76', cursor: 'default' }}>
              No saved loops yet
            </div>
          ) : (
            skills.map((skill) => (
              <Link key={skill.id} href={`/run/${skill.id}`} className="lc-item">
                {skill.name}
                <small>
                  {skill.trigger.type}: {skill.trigger.value}
                </small>
              </Link>
            ))
          )}
        </div>

        <div className="lc-side-foot">
          <Link href="/library">Library</Link>
          <Link href="/record">Record manually</Link>
          <Link href="/demo/vendor">Demo app</Link>
        </div>
      </aside>

      <main className="lc-main">
        <div className="lc-topbar">
          <span className="lc-topbar-label">Site</span>
          <input
            className="lc-url"
            value={startUrl}
            onChange={(event) => setStartUrl(event.target.value)}
            placeholder="https://your-app.example.com (or set LOOP_DEMO_URL)"
            spellCheck={false}
          />
        </div>

        <div className="lc-thread" ref={threadRef}>
          {empty ? (
            <div className="lc-empty">
              <h2>What should loop do?</h2>
              <p>Describe a task in plain language. The agent does it in a cloud browser and turns it into a loop you can rerun.</p>
              <div className="lc-chips">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} type="button" className="lc-chip" onClick={() => void send(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className={`lc-msg ${message.role === 'user' ? 'user' : 'ai'}`}>
                <div className={`lc-avatar ${message.role === 'user' ? 'me' : 'ai'}`}>
                  {message.role === 'user' ? 'you' : 'l'}
                </div>
                {message.role === 'user' ? (
                  <div className="lc-bubble">{message.text}</div>
                ) : (
                  <div className="lc-body">
                    <div className="lc-status">
                      <span className={`lc-dot ${message.status ?? 'running'}`} />
                      {message.status === 'done'
                        ? 'Done'
                        : message.status === 'failed'
                          ? 'Needs you'
                          : 'Working…'}
                      {message.summary ? <span style={{ color: '#8b8b96', fontWeight: 400 }}>— {message.summary}</span> : null}
                    </div>

                    {(message.steps?.length ?? 0) > 0 && (
                      <div className="lc-steps">
                        {message.steps!.map((step) => (
                          <div key={step.n} className="lc-step">
                            <span className="lc-step-action">{step.action}</span>
                            <span className="lc-step-detail">
                              {step.detail}
                              {step.result ? <span className="lc-step-result"> — {step.result}</span> : null}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {message.debugUrl && message.status === 'running' ? (
                      <iframe src={message.debugUrl} title="Live browser" className="lc-viewer" allow="clipboard-read; clipboard-write" />
                    ) : null}

                    {message.status === 'failed' && message.error ? (
                      <p className="lc-error">{message.error}</p>
                    ) : null}

                    {message.recordingId ? (
                      <div className="lc-card">
                        <div>
                          <div className="lc-card-title">Captured {message.steps?.length ?? 0} actions</div>
                          <div className="lc-card-sub">Review the plain-language steps, then save it as a loop.</div>
                        </div>
                        <Link href={`/review/${message.recordingId}`} className="lc-btn primary">
                          Review &amp; save →
                        </Link>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="lc-composer">
          <div className="lc-composer-inner">
            <textarea
              className="lc-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(input);
                }
              }}
              placeholder="Describe a task…  (Enter to run, Shift+Enter for a new line)"
              rows={1}
            />
            <button type="button" className="lc-send" onClick={() => void send(input)} disabled={busy || input.trim() === ''} aria-label="Send">
              <SendIcon />
            </button>
          </div>
          <div className="lc-hint">
            <span>The agent drives a real cloud browser and records what it does.</span>
            <span>{busy ? 'Running…' : 'Enter to run'}</span>
          </div>
        </div>
      </main>
    </div>
  );
}
