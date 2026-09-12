'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { AgentRecord } from '@/lib/agent-runs';

interface Step {
  n: number;
  action: string;
  detail: string;
  result?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  kind?: 'agent' | 'browser';
  text?: string;
  goal?: string;
  steps?: Step[];
  status?: 'running' | 'processing' | 'done' | 'failed';
  debugUrl?: string;
  url?: string;
  runId?: string;
  recordingId?: string;
  stepCount?: number;
  summary?: string;
  error?: string;
}

interface SkillSummary {
  id: string;
  name: string;
  trigger: { type: string; value: string };
}

const SUGGESTIONS = [
  { label: 'Download the unpaid invoice PDF', detail: 'log in, filter to Unpaid, download', prompt: 'Log in with username "vendor" and password "hunter2", then filter to Unpaid and download the first unpaid invoice PDF' },
  { label: 'Download all unpaid invoices', detail: 'one file per unpaid invoice', prompt: 'Log in with username "vendor" and password "hunter2", then download every unpaid invoice PDF' },
  { label: 'Open the newest invoice', detail: 'find and open the latest one', prompt: 'Log in with username "vendor" and password "hunter2", then open the most recently issued invoice' },
  { label: 'Summarize the invoice list', detail: 'read the table, report totals', prompt: 'Log in with username "vendor" and password "hunter2", then read the invoice table and tell me how many are unpaid and the total unpaid amount' },
];

function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg className="lc-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'agent' | 'browser'>('agent');
  const [messages, setMessages] = useState<Message[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>(initialSkills);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [starting, setStarting] = useState(false);
  const [address, setAddress] = useState(defaultStartUrl);
  const [lastUrl, setLastUrl] = useState(defaultStartUrl);

  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  const intervals = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const activeRun = useRef<{ messageId: string; runId: string } | null>(null);
  const activeRecording = useRef<{ messageId: string; recordingId: string } | null>(null);

  useEffect(() => {
    const map = intervals.current;
    return () => map.forEach(clearInterval);
  }, []);

  useEffect(() => {
    if (nearBottom.current && threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  const patch = (id: string, update: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...update } : m)));
  };

  const refreshSkills = async () => {
    const response = await fetch('/api/skills').catch(() => null);
    if (!response) return;
    const data = await response.json();
    setSkills(data.skills ?? []);
  };

  const send = async (text: string) => {
    const goal = text.trim();
    if (!goal || busy || recording || compiling) return;
    setInput('');
    setBusy(true);
    nearBottom.current = true;

    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    setOpenIds((prev) => new Set(prev).add(assistantId));
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', text: goal },
      { id: assistantId, role: 'assistant', kind: 'agent', goal, status: 'running', steps: [] },
    ]);

    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goal, startUrl: lastUrl || defaultStartUrl || 'about:blank' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not start the agent');

      const runId: string = data.runId;
      activeRun.current = { messageId: assistantId, runId };
      patch(assistantId, { runId });

      const interval = setInterval(async () => {
        const poll = await fetch(`/api/agent/${runId}`).catch(() => null);
        if (!poll) {
          clearInterval(interval);
          intervals.current.delete(assistantId);
          patch(assistantId, { status: 'failed', error: 'Lost contact with the run — try again.' });
          setBusy(false);
          return;
        }
        const payload = await poll.json();
        const run: AgentRecord | undefined = payload.run;
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
          intervals.current.delete(assistantId);
          activeRun.current = null;
          setOpenIds((prev) => {
            if (!prev.has(assistantId)) return prev;
            const next = new Set(prev);
            next.delete(assistantId);
            return next;
          });
          setBusy(false);
          if (run.recordingId) void refreshSkills();
        }
      }, 1000);
      intervals.current.set(assistantId, interval);
    } catch (error) {
      patch(assistantId, { status: 'failed', error: error instanceof Error ? error.message : 'Agent failed to start' });
      activeRun.current = null;
      setBusy(false);
    }
  };

  const stopAgent = async () => {
    const active = activeRun.current;
    if (!active) return;
    const interval = intervals.current.get(active.messageId);
    if (interval) {
      clearInterval(interval);
      intervals.current.delete(active.messageId);
    }
    activeRun.current = null;
    setBusy(false);
    patch(active.messageId, { status: 'failed', error: 'Stopped' });
    await fetch(`/api/agent/${active.runId}`, { method: 'DELETE' }).catch(() => null);
  };

  const openBrowser = async () => {
    if (busy || recording || compiling) return;
    setStarting(true);
    setMode('browser');
    nearBottom.current = true;
    const messageId = crypto.randomUUID();
    setMessages((prev) => [...prev, { id: messageId, role: 'assistant', kind: 'browser', status: 'running', url: address || undefined }]);
    try {
      const response = await fetch('/api/recordings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not open the browser');
      activeRecording.current = { messageId, recordingId: data.id };
      setRecording(true);
      patch(messageId, { debugUrl: data.debugUrl });
    } catch (error) {
      patch(messageId, { status: 'failed', error: error instanceof Error ? error.message : 'Could not open the browser' });
      setMode('agent');
    } finally {
      setStarting(false);
    }
  };

  const navigate = async () => {
    const active = activeRecording.current;
    const url = address.trim();
    if (!active || !url) return;
    const response = await fetch(`/api/recordings/${active.recordingId}/navigate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    }).catch(() => null);
    if (!response || !response.ok) return;
    const data = await response.json();
    setLastUrl(data.url);
    setAddress(data.url);
    patch(active.messageId, { url: data.url });
  };

  const stopRecording = async () => {
    const active = activeRecording.current;
    if (!active) return;
    setRecording(false);
    setCompiling(true);
    // Immediately show the compiling state and drop the (now-released) viewer.
    patch(active.messageId, { status: 'processing', debugUrl: undefined });
    try {
      const response = await fetch(`/api/recordings/${active.recordingId}/stop`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not stop recording');
      patch(active.messageId, {
        status: 'done',
        recordingId: active.recordingId,
        stepCount: data.result?.steps?.length ?? 0,
        debugUrl: undefined,
      });
    } catch (error) {
      patch(active.messageId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Could not stop recording',
      });
    } finally {
      activeRecording.current = null;
      setCompiling(false);
      void refreshSkills();
    }
  };

  const newTask = () => {
    if (busy || recording || compiling) return;
    setMessages([]);
    setOpenIds(new Set());
    setInput('');
    setMode('agent');
  };

  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const fill = (text: string) => {
    setMode('agent');
    setInput(text);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const idle = !busy && !recording && !compiling;

  return (
    <div className="lc-app loop-dark">
      <aside className="lc-sidebar">
        <div className="lc-brand">
          <div className="lc-logo">l</div>
          <div>
            <div className="lc-brand-name">loop</div>
            <div className="lc-brand-sub">show it once, it does it forever</div>
          </div>
        </div>

        <button type="button" className="lc-new" onClick={newTask} disabled={!idle}>
          + New task
        </button>
        <button type="button" className="lc-side-link" onClick={() => void openBrowser()} disabled={!idle}>
          ● Open a browser
        </button>

        <div className="lc-section">Your loops</div>
        <div className="lc-list">
          {skills.length === 0 ? (
            <div className="lc-empty-item">No saved loops yet</div>
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
          <Link href="/demo/vendor">Demo app</Link>
        </div>
      </aside>

      <main className="lc-main">
        <div
          className="lc-thread"
          ref={threadRef}
          onScroll={() => {
            const el = threadRef.current;
            if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
        >
          {messages.length === 0 ? (
            <div className="lc-empty">
              <h2>What should loop do?</h2>
              <p>Open a browser and do the task yourself, or describe it and the agent does it. Either way you get a loop you can rerun.</p>
              <button type="button" className="lc-btn primary" onClick={() => void openBrowser()} disabled={starting}>
                {starting ? 'Opening…' : 'Open a browser'}
              </button>
              <div className="lc-or">or describe a task for the agent</div>
              <div className="lc-chips">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion.label} type="button" className="lc-chip" onClick={() => fill(suggestion.prompt)}>
                    {suggestion.label}
                    <small>{suggestion.detail}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="lc-thread-inner">
              {messages.map((message) =>
                message.role === 'user' ? (
                  <div key={message.id} className="lc-msg user">
                    <div className="lc-bubble">{message.text}</div>
                  </div>
                ) : (
                  <div key={message.id} className="lc-msg ai">
                    <div className="lc-body">
                      <div className="lc-status">
                        {message.kind === 'browser' && message.status === 'running' ? (
                          <span className="lc-recdot" />
                        ) : (
                          <span className={`lc-dot ${message.status ?? 'running'}`} />
                        )}
                        {message.kind === 'browser'
                          ? message.status === 'running'
                            ? 'Browser'
                            : message.status === 'processing'
                              ? 'Compiling…'
                              : message.status === 'failed'
                                ? 'Needs you'
                                : `Recorded ${message.stepCount ?? 0} actions`
                          : message.status === 'done'
                            ? 'Done'
                            : message.status === 'failed'
                              ? 'Needs you'
                              : 'Working…'}
                        {message.summary ? <span className="lc-summary">— {message.summary}</span> : null}
                      </div>

                      {message.kind === 'browser' && message.status === 'processing' ? (
                        <div className="lc-activity open">
                          <div className="lc-loading">
                            <span className="lc-spinner" />
                            <span className="lc-loading-label">Turning your recording into steps…</span>
                            <div className="lc-skel">
                              <span className="lc-skel-row" />
                              <span className="lc-skel-row" />
                              <span className="lc-skel-row" />
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {message.kind === 'browser' && message.status === 'running' && message.debugUrl ? (
                        <div className="lc-activity open">
                          <div className="lc-addressbar">
                            <input
                              className="lc-url"
                              value={address}
                              onChange={(event) => setAddress(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void navigate();
                                }
                              }}
                              placeholder="Type a URL and press Enter"
                              spellCheck={false}
                            />
                            <button type="button" className="lc-btn danger" onClick={stopRecording} disabled={starting}>
                              Stop
                            </button>
                          </div>
                          <iframe src={message.debugUrl} title="Recording browser" className="lc-viewer" allow="clipboard-read; clipboard-write" />
                        </div>
                      ) : null}

                      {message.kind !== 'browser' && ((message.steps?.length ?? 0) > 0 || message.status === 'running') ? (
                        <div className={`lc-activity ${openIds.has(message.id) ? 'open' : ''}`}>
                          <button type="button" className="lc-activity-head" onClick={() => toggle(message.id)}>
                            <span>
                              {message.status === 'running' ? 'Activity' : `${message.steps?.length ?? 0} action${(message.steps?.length ?? 0) === 1 ? '' : 's'}`}
                            </span>
                            <Chevron />
                          </button>
                          {openIds.has(message.id) && (
                            <div className="lc-activity-body">
                              {message.steps?.map((step) => (
                                <div key={step.n} className="lc-step">
                                  <span className="lc-step-action">{step.action}</span>
                                  <span className="lc-step-detail">
                                    {step.detail}
                                    {step.result ? <span className="lc-step-result"> — {step.result}</span> : null}
                                  </span>
                                </div>
                              ))}
                              {message.steps?.length === 0 ? <p className="lc-step-result">Starting the browser…</p> : null}
                            </div>
                          )}
                          {message.status === 'running' && message.debugUrl ? (
                            <iframe src={message.debugUrl} title="Live browser" className="lc-viewer" allow="clipboard-read; clipboard-write" />
                          ) : null}
                        </div>
                      ) : null}

                      {message.status === 'failed' && message.error ? <p className="lc-error">{message.error}</p> : null}
                      {message.status === 'failed' && message.goal ? (
                        <button type="button" className="lc-btn text" onClick={() => void send(message.goal!)}>
                          Try again
                        </button>
                      ) : null}

                      {message.recordingId ? (
                        <div className="lc-card">
                          <div>
                            <div className="lc-card-title">Captured {message.stepCount ?? message.steps?.length ?? 0} actions</div>
                            <div className="lc-card-sub">Review the plain-language steps, then save it as a loop.</div>
                          </div>
                          <Link href={`/review/${message.recordingId}`} className="lc-btn primary">
                            Review &amp; save →
                          </Link>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </div>

        <div className="lc-composer">
          <div className="lc-modes">
            <button type="button" className={mode === 'agent' ? 'active' : ''} onClick={() => setMode('agent')} disabled={busy || recording || compiling}>
              Ask the agent
            </button>
            <button type="button" className={mode === 'browser' ? 'active' : ''} onClick={() => void openBrowser()} disabled={!idle}>
              Open a browser
            </button>
          </div>

          {mode === 'agent' ? (
            <div className="lc-composer-inner">
              <textarea
                ref={textareaRef}
                className="lc-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (!busy) void send(input);
                  }
                }}
                placeholder="Describe a task…"
                rows={1}
                disabled={busy || recording || compiling}
              />
              {busy ? (
                <button type="button" className="lc-send" onClick={() => void stopAgent()} aria-label="Stop">
                  <StopIcon />
                </button>
              ) : (
                <button type="button" className="lc-send" onClick={() => void send(input)} disabled={input.trim() === '' || recording} aria-label="Send">
                  <SendIcon />
                </button>
              )}
            </div>
          ) : (
            <div className="lc-composer-inner" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--lc-muted)', fontSize: 13 }}>
                {recording ? 'Type a URL above to navigate, then Stop when you finish.' : 'Opens a cloud browser you can drive.'}
              </span>
              {recording ? (
                <button type="button" className="lc-btn danger" onClick={stopRecording}>
                  Stop
                </button>
              ) : null}
            </div>
          )}

          <div className="lc-hint">
            <span>{mode === 'agent' ? 'Enter to run · Shift+Enter for a new line' : 'You drive the browser; we capture the steps.'}</span>
            <span>{compiling ? 'Compiling…' : busy ? 'Running…' : recording ? 'Recording…' : 'Cloud browser'}</span>
          </div>
        </div>
      </main>
    </div>
  );
}
