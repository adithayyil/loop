'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { AgentRecord } from '@/lib/agent-runs';
import BrowserPane from '@/app/components/BrowserPane';

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
  { label: 'Top of Hacker News', detail: 'open the #1 story, summarize it', prompt: 'Go to news.ycombinator.com, open the top story, and summarize what it is about' },
  { label: 'GitHub trending', detail: "today's top repo, explained", prompt: 'Go to github.com/trending, open the top repository, and tell me what it does' },
  { label: 'Weather in Tokyo', detail: 'look it up, report back', prompt: 'Look up the current weather in Tokyo and report the temperature and conditions' },
  { label: 'Wikipedia rabbit hole', detail: 'featured article, summarized', prompt: 'Go to wikipedia.org, open today’s featured article, and summarize it in three sentences' },
];

function LoopMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 12c-1.6-2.9-3.4-4.4-5.2-4.4C4.7 7.6 3 9.6 3 12s1.7 4.4 3.8 4.4c1.8 0 3.6-1.5 5.2-4.4 1.6-2.9 3.4-4.4 5.2-4.4 2.1 0 3.8 2 3.8 4.4s-1.7 4.4-3.8 4.4c-1.8 0-3.6-1.5-5.2-4.4"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg className="lp-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 12h18M12 3c2.6 2.5 3.9 5.6 3.9 9S14.6 18.5 12 21c-2.6-2.5-3.9-5.6-3.9-9S9.4 5.5 12 3z" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9L12 2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
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
  const [recStartedAt, setRecStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

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

  useEffect(() => {
    if (!recording || recStartedAt == null) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [recording, recStartedAt]);

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
          patch(assistantId, { status: 'failed', error: 'Lost contact with the run. Try again.' });
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
      setRecStartedAt(Date.now());
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
    setRecStartedAt(null);
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
    <div className="lp-app">
      <aside className="lp-sidebar">
        <div className="lp-brand">
          <div className="lp-logo">
            <LoopMark />
          </div>
          <div>
            <div className="lp-brand-name">loop</div>
            <div className="lp-brand-sub">browser automation</div>
          </div>
        </div>

        <button type="button" className="lp-new" onClick={newTask} disabled={!idle}>
          + New task
        </button>
        <button type="button" className="lp-side-link" onClick={() => void openBrowser()} disabled={!idle}>
          <span className="lp-led-static" />
          Open a browser
        </button>

        <div className="lp-section">Your loops</div>
        <div className="lp-list">
          {skills.length === 0 ? (
            <div className="lp-loop-empty">No saved loops yet</div>
          ) : (
            skills.map((skill) => (
              <Link key={skill.id} href={`/run/${skill.id}`} className="lp-loop">
                {skill.name}
                <small>
                  {skill.trigger.type} · {skill.trigger.value}
                </small>
              </Link>
            ))
          )}
        </div>

        <div className="lp-side-foot">
          <Link href="/library">Library →</Link>
        </div>
      </aside>

      <main className="lp-main">
        <div
          className="lp-thread"
          ref={threadRef}
          onScroll={() => {
            const el = threadRef.current;
            if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
        >
          {messages.length === 0 ? (
            <div className="lp-hero">
              <div className="lp-hero-mark">
                <LoopMark size={22} />
              </div>
              <p className="lp-kicker">loop · cloud browser automation</p>
              <h1 className="lp-hero-title">
                Show it once.
                <br />
                <em>It does it forever.</em>
              </h1>
              <p className="lp-hero-sub">
                Drive a cloud browser yourself, or describe the task and let the agent work.
                Either way, loop captures the steps and replays them on demand.
              </p>

              <div className="lp-actions">
                <button type="button" className="lp-action" onClick={() => void openBrowser()} disabled={starting}>
                  <span className="lp-action-icon">
                    <GlobeIcon />
                  </span>
                  <div className="lp-action-title">{starting ? 'Opening…' : 'Open a browser'}</div>
                  <div className="lp-action-sub">You drive. loop captures every click and keystroke.</div>
                </button>
                <button type="button" className="lp-action" onClick={() => textareaRef.current?.focus()}>
                  <span className="lp-action-icon">
                    <SparkIcon />
                  </span>
                  <div className="lp-action-title">Ask the agent</div>
                  <div className="lp-action-sub">Describe the outcome. Watch it work, keep the loop.</div>
                </button>
              </div>

              <div className="lp-or">or try an idea</div>
              <div className="lp-chips">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion.label} type="button" className="lp-chip" onClick={() => fill(suggestion.prompt)}>
                    {suggestion.label}
                    <small>{suggestion.detail}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="lp-thread-inner">
              {messages.map((message) =>
                message.role === 'user' ? (
                  <div key={message.id} className="lp-msg user">
                    <div className="lp-bubble">{message.text}</div>
                  </div>
                ) : (
                  <div key={message.id} className="lp-msg ai">
                    <div className="lp-ai">
                      <div className="lp-statusline">
                        {message.kind === 'browser' && message.status === 'running' ? (
                          <span className="lp-led" />
                        ) : (
                          <span className={`lp-orbit ${message.status ?? 'running'}`} />
                        )}
                        {message.kind === 'browser'
                          ? message.status === 'running'
                            ? 'Recording'
                            : message.status === 'processing'
                              ? 'Compiling'
                              : message.status === 'failed'
                                ? 'Needs you'
                                : `Recorded ${message.stepCount ?? 0} actions`
                          : message.status === 'done'
                            ? 'Done'
                            : message.status === 'failed'
                              ? 'Needs you'
                              : 'Working'}
                        {message.kind === 'browser' && message.status === 'running' && recStartedAt != null ? (
                          <span className="lp-timer">{formatClock(now - recStartedAt)}</span>
                        ) : null}
                        {message.summary ? <span className="lp-summary">· {message.summary}</span> : null}
                      </div>

                      {message.kind === 'browser' && message.status === 'processing' ? (
                        <div className="lp-activity open">
                          <div className="lp-loading">
                            <span className="lp-spinner" />
                            <span className="lp-loading-label">
                              <em>Turning your recording into steps…</em>
                            </span>
                            <div className="lp-skel">
                              <span className="lp-skel-row" />
                              <span className="lp-skel-row" />
                              <span className="lp-skel-row" />
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {message.kind === 'browser' && message.status === 'running' && message.debugUrl ? (
                        <BrowserPane
                          src={message.debugUrl}
                          title="Recording browser"
                          recording
                          address={address}
                          onAddressChange={setAddress}
                          onNavigate={() => void navigate()}
                          actions={
                            <button type="button" className="lp-btn danger small" onClick={stopRecording} disabled={starting}>
                              Stop
                            </button>
                          }
                        />
                      ) : null}

                      {message.kind !== 'browser' && ((message.steps?.length ?? 0) > 0 || message.status === 'running') ? (
                        <div className={`lp-activity ${openIds.has(message.id) ? 'open' : ''}`}>
                          <button type="button" className="lp-activity-head" onClick={() => toggle(message.id)}>
                            <span>
                              {message.status === 'running' ? 'Activity' : `${message.steps?.length ?? 0} action${(message.steps?.length ?? 0) === 1 ? '' : 's'}`}
                            </span>
                            <Chevron />
                          </button>
                          {openIds.has(message.id) && (
                            <div className="lp-activity-body">
                              {message.steps?.map((step) => (
                                <div key={step.n} className="lp-tl">
                                  <span className="lp-tl-action">{step.action}</span>
                                  <span className="lp-tl-detail">
                                    {step.detail}
                                    {step.result ? <span className="lp-tl-result"> · {step.result}</span> : null}
                                  </span>
                                </div>
                              ))}
                              {message.steps?.length === 0 ? <p className="lp-tl-result">Starting the browser…</p> : null}
                            </div>
                          )}
                          {message.status === 'running' && message.debugUrl ? (
                            <BrowserPane
                              src={message.debugUrl}
                              title="Live browser"
                              label="live session · steel cloud"
                              className="lp-browser--flush"
                            />
                          ) : null}
                        </div>
                      ) : null}

                      {message.status === 'failed' && message.error ? <p className="lp-error">{message.error}</p> : null}
                      {message.status === 'failed' && message.goal ? (
                        <button type="button" className="lp-btn ghost" onClick={() => void send(message.goal!)}>
                          ↺ Try again
                        </button>
                      ) : null}

                      {message.recordingId ? (
                        <div className="lp-card">
                          <div>
                            <div className="lp-card-title">Captured {message.stepCount ?? message.steps?.length ?? 0} actions</div>
                            <div className="lp-card-sub">Review the plain-language steps, then save it as a loop.</div>
                          </div>
                          <Link href={`/review/${message.recordingId}`} className="lp-btn primary">
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

        <div className="lp-composer">
          <div className="lp-modes">
            <button type="button" className={mode === 'agent' ? 'active' : ''} onClick={() => setMode('agent')} disabled={busy || recording || compiling}>
              Ask the agent
            </button>
            <button type="button" className={mode === 'browser' ? 'active' : ''} onClick={() => void openBrowser()} disabled={!idle}>
              Open a browser
            </button>
          </div>

          {mode === 'agent' ? (
            <div className="lp-composer-inner">
              <textarea
                ref={textareaRef}
                className="lp-input"
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
                <button type="button" className="lp-send stop" onClick={() => void stopAgent()} aria-label="Stop">
                  <StopIcon />
                </button>
              ) : (
                <button type="button" className="lp-send" onClick={() => void send(input)} disabled={input.trim() === '' || recording} aria-label="Send">
                  <SendIcon />
                </button>
              )}
            </div>
          ) : (
            <div className="lp-composer-inner" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--lp-text-2)', fontSize: 13 }}>
                {recording ? 'Type a URL above to navigate, then Stop when you finish.' : 'Opens a cloud browser you can drive.'}
              </span>
              {recording ? (
                <button type="button" className="lp-btn danger" onClick={stopRecording}>
                  Stop
                </button>
              ) : null}
            </div>
          )}

          <div className="lp-hint">
            <span>{mode === 'agent' ? 'Enter to run · Shift+Enter new line' : 'You drive · we capture the steps'}</span>
            <span className={compiling || busy ? 'lp-busy' : recording ? 'lp-live' : ''}>
              {compiling ? 'compiling' : busy ? 'running' : recording ? 'rec' : 'cloud browser'}
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
