'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CircleStop,
  Globe,
  Loader2,
  Mic,
  MicOff,
  MousePointerClick,
  Play,
  Sparkles,
} from 'lucide-react';
import type { AgentRecord } from '@/lib/agent-runs';
import { BrowserPane } from '@/app/components/browser-pane';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

type Mode = 'record' | 'agent';

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function NewLoopClient({ initialMode }: { initialMode: Mode | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(initialMode);
  const done = (recordingId: string) => router.push(`/review/${recordingId}`);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 md:p-10">
      {mode === null ? (
        <ModeChooser onPick={setMode} />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setMode(null)}>
              <ArrowLeft />
              Change method
            </Button>
            <Badge variant="secondary">{mode === 'record' ? 'Record it yourself' : 'Describe it'}</Badge>
          </div>
          {mode === 'record' ? (
            <RecordFlow onDone={done} />
          ) : (
            <AgentFlow onDone={done} />
          )}
        </>
      )}
    </div>
  );
}

function ModeChooser({ onPick }: { onPick: (mode: Mode) => void }) {
  return (
    <>
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">New loop</h1>
        <p className="text-sm text-muted-foreground">
          Show loop the task once — by doing it, or by describing it to the agent.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <button type="button" onClick={() => onPick('record')} className="group text-left">
          <Card className="h-full transition-colors group-hover:border-primary/50 group-hover:bg-accent/40">
            <CardHeader>
              <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
                <MousePointerClick className="size-4.5" />
              </span>
              <CardTitle className="mt-2">Record it yourself</CardTitle>
              <CardDescription>
                Drive a cloud browser and do the task normally. loop captures every click and
                keystroke, plus anything you say.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                Start recording
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </CardContent>
          </Card>
        </button>
        <button type="button" onClick={() => onPick('agent')} className="group text-left">
          <Card className="h-full transition-colors group-hover:border-primary/50 group-hover:bg-accent/40">
            <CardHeader>
              <span className="grid size-9 place-items-center rounded-lg bg-secondary text-foreground">
                <Sparkles className="size-4.5" />
              </span>
              <CardTitle className="mt-2">Describe it</CardTitle>
              <CardDescription>
                Give the agent a goal in plain language. It drives the browser and turns its
                actions into a loop you can edit.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                Ask the agent
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </CardContent>
          </Card>
        </button>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Record mode                                                         */
/* ------------------------------------------------------------------ */

function RecordFlow({ onDone }: { onDone: (recordingId: string) => void }) {
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [debugUrl, setDebugUrl] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [recording, setRecording] = useState(false);
  const [narrating, setNarrating] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  const micRecorder = useRef<MediaRecorder | null>(null);
  const micStream = useRef<MediaStream | null>(null);
  const micChunks = useRef<Blob[]>([]);
  const micMime = useRef('audio/webm');

  useEffect(() => {
    if (!recording || startedAt == null) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [recording, startedAt]);

  useEffect(() => {
    return () => {
      if (micRecorder.current?.state === 'recording') micRecorder.current.stop();
      micStream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const response = await fetch('/api/recordings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not open the browser');
      setRecordingId(data.id);
      setDebugUrl(data.debugUrl);
      setRecording(true);
      setStartedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the browser');
    } finally {
      setStarting(false);
    }
  };

  const navigate = async () => {
    const url = address.trim();
    if (!recordingId || !url) return;
    const response = await fetch(`/api/recordings/${recordingId}/navigate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    }).catch(() => null);
    if (!response?.ok) return;
    const data = await response.json();
    setAddress(data.url);
  };

  const stopMic = () => {
    const recorder = micRecorder.current;
    if (!recorder) return Promise.resolve();
    return new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
      if (recorder.state !== 'inactive') recorder.stop();
      else resolve();
    }).then(() => {
      micStream.current?.getTracks().forEach((track) => track.stop());
      micStream.current = null;
      micRecorder.current = null;
      setNarrating(false);
    });
  };

  const toggleNarration = async () => {
    if (micRecorder.current) {
      await stopMic();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      micChunks.current = [];
      micMime.current = mimeType ?? 'audio/webm';
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) micChunks.current.push(event.data);
      });
      recorder.start();
      micStream.current = stream;
      micRecorder.current = recorder;
      setNarrating(true);
    } catch {
      /* mic permission denied; narration stays off */
    }
  };

  const uploadNarration = async (id: string) => {
    if (micChunks.current.length === 0) return;
    const blob = new Blob(micChunks.current, { type: micMime.current });
    micChunks.current = [];
    const form = new FormData();
    form.append('audio', blob, 'narration.webm');
    await fetch(`/api/recordings/${id}/narration`, { method: 'POST', body: form }).catch(() => null);
  };

  const stop = async () => {
    if (!recordingId) return;
    setRecording(false);
    setStopping(true);
    await stopMic();
    await uploadNarration(recordingId);
    try {
      const response = await fetch(`/api/recordings/${recordingId}/stop`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not stop recording');
      onDone(recordingId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not stop recording');
      setStopping(false);
    }
  };

  if (!recordingId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Record a task</CardTitle>
          <CardDescription>
            A cloud browser opens below. Do the task normally; when you stop, loop compiles your
            actions into an editable step list.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="start-url">Starting URL (optional)</Label>
            <div className="relative">
              <Globe className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="start-url"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="https://example.com"
                className="pl-8 font-mono text-sm"
              />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button onClick={start} disabled={starting}>
            {starting ? <Loader2 className="animate-spin" /> : <Play />}
            Start recording
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium">
            <span className="size-1.5 animate-pulse rounded-full bg-destructive" />
            Recording
          </span>
          <span className="font-mono text-sm text-muted-foreground tabular">
            {formatClock(now - (startedAt ?? now))}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={narrating ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => void toggleNarration()}
          >
            {narrating ? <MicOff /> : <Mic />}
            {narrating ? 'Stop narrating' : 'Narrate'}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => void stop()} disabled={stopping}>
            {stopping ? <Loader2 className="animate-spin" /> : <CircleStop />}
            Stop &amp; review
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {narrating
          ? 'Say why you do each step — it gets transcribed to guide the steps.'
          : 'Do the task normally. Add voice narration if the “why” matters.'}
      </p>

      {debugUrl ? (
        <BrowserPane
          src={debugUrl}
          title="Recording browser"
          recording
          address={address}
          onAddressChange={setAddress}
          onNavigate={() => void navigate()}
        />
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Agent mode                                                          */
/* ------------------------------------------------------------------ */

interface AgentStep {
  n: number;
  action: string;
  detail: string;
  result?: string;
}

function AgentFlow({ onDone }: { onDone: (recordingId: string) => void }) {
  const [goal, setGoal] = useState('');
  const [startUrl, setStartUrl] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [record, setRecord] = useState<AgentRecord | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const interval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (interval.current) clearInterval(interval.current);
    };
  }, []);

  const stopPolling = () => {
    if (interval.current) clearInterval(interval.current);
    interval.current = null;
  };

  const start = async () => {
    setStarting(true);
    setError(null);
    setRecord(null);
    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goal: goal.trim(), startUrl: startUrl.trim() || 'about:blank' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not start the agent');
      setRunId(data.runId);
      interval.current = setInterval(async () => {
        const poll = await fetch(`/api/agent/${data.runId}`).catch(() => null);
        if (!poll) return;
        const payload = await poll.json();
        if (payload.run) {
          setRecord(payload.run as AgentRecord);
          if (payload.run.status !== 'running') stopPolling();
        }
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the agent');
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    stopPolling();
    if (runId) await fetch(`/api/agent/${runId}`, { method: 'DELETE' }).catch(() => null);
    setRunId(null);
    setRecord(null);
  };

  const running = runId != null && record?.status !== 'done' && record?.status !== 'failed';
  const status = record?.status ?? (runId ? 'running' : 'idle');

  if (!runId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Describe the task</CardTitle>
          <CardDescription>
            The agent drives a cloud browser to reach your goal, one action at a time. Its actions
            become an editable loop.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="goal">Goal</Label>
            <Textarea
              id="goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="e.g. Go to news.ycombinator.com, open the top story, and summarize it"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-url">Starting URL</Label>
            <div className="relative">
              <Globe className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="agent-url"
                value={startUrl}
                onChange={(event) => setStartUrl(event.target.value)}
                placeholder="https://example.com"
                className="pl-8 font-mono text-sm"
              />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button onClick={() => void start()} disabled={starting || goal.trim() === ''}>
            {starting ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Run the agent
          </Button>
        </CardContent>
      </Card>
    );
  }

  const steps = record?.steps ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium">
            {running ? (
              <span className="size-1.5 animate-pulse rounded-full bg-primary" />
            ) : record?.status === 'done' ? (
              <span className="size-1.5 rounded-full bg-primary" />
            ) : (
              <span className="size-1.5 rounded-full bg-destructive" />
            )}
            {running ? 'Working' : status === 'done' ? 'Done' : 'Needs you'}
          </span>
          <span className="max-w-md truncate text-sm text-muted-foreground">{goal}</span>
        </div>
        {running ? (
          <Button variant="outline" size="sm" onClick={() => void stop()}>
            <CircleStop />
            Stop
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => { setRunId(null); setRecord(null); }}>
            <Bot />
            New goal
          </Button>
        )}
      </div>

      {record?.debugUrl && running ? (
        <BrowserPane src={record.debugUrl} title="Agent browser" label="live session · steel cloud" />
      ) : null}

      <Card className="py-0">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">Activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 p-3">
          {steps.length === 0 ? (
            <div className="space-y-2 py-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-5 w-3/5" />
            </div>
          ) : (
            steps.map((step) => (
              <div key={step.n} className="flex items-start gap-3 rounded-lg px-2 py-1.5 text-sm">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md bg-secondary font-mono text-[10px] text-muted-foreground tabular">
                  {step.n}
                </span>
                <div className="min-w-0">
                  <span className="font-medium">{step.action}</span>{' '}
                  <span className="text-muted-foreground">{step.detail}</span>
                  {step.result ? (
                    <span className="block truncate text-xs text-muted-foreground/80">{step.result}</span>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {record?.error ? <p className="text-sm text-destructive">{record.error}</p> : null}

      {record?.status === 'done' && record.recordingId ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-primary/40 bg-primary/5 py-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Captured {steps.length} actions</p>
            <p className="text-sm text-muted-foreground">
              Review the plain-language steps, then save it as a loop.
            </p>
          </div>
          <Button onClick={() => onDone(record.recordingId!)}>
            Review &amp; save
            <ArrowRight />
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
