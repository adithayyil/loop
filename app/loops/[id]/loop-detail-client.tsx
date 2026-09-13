'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Download,
  FileText,
  Play,
  Repeat2,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import type { RunRecord } from '@/lib/runs';
import type { Skill } from '@/lib/types';
import { BrowserPane } from '@/app/components/browser-pane';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function LoopDetail({
  skill,
  autoRun,
  initialRunId,
}: {
  skill: Skill;
  autoRun: boolean;
  initialRunId: string | null;
}) {
  const router = useRouter();
  const variableParams = skill.steps.filter((step) => step.param?.mode === 'variable');

  const [params, setParams] = useState<Record<string, string>>(
    Object.fromEntries(variableParams.map((s) => [s.param!.name, s.param!.value ?? s.value ?? ''])),
  );
  const [runId, setRunId] = useState<string | null>(initialRunId);
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [runMissing, setRunMissing] = useState(false);
  const autoStarted = useRef(false);
  const pollMisses = useRef(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!runId) return;
    pollMisses.current = 0;
    const timer = setInterval(async () => {
      const response = await fetch(`/api/runs/${runId}`).catch(() => null);
      if (!response) return;
      const data = await response.json();
      if (data.run) {
        pollMisses.current = 0;
        setRecord(data.run as RunRecord);
        setStartedAt((prev) => prev ?? (data.run.startedAt as number));
        if (data.run.status !== 'running') clearInterval(timer);
      } else if ((pollMisses.current += 1) >= 5) {
        // Runs live in memory; a stale id (e.g. after a restart) would otherwise spin forever.
        clearInterval(timer);
        setRunMissing(true);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [runId]);

  const running = !runMissing && ((runId != null && record == null) || record?.status === 'running');

  useEffect(() => {
    if (!running || startedAt == null) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running, startedAt]);

  const start = async () => {
    setError(null);
    setRunMissing(false);
    setRecord(null);
    setStartedAt(Date.now());
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

  useEffect(() => {
    // Auto-run only when there's nothing to fill in; a parameterized loop should show
    // its inputs first rather than run with stale defaults.
    if (autoRun && !initialRunId && variableParams.length === 0 && !autoStarted.current) {
      autoStarted.current = true;
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);

  const remove = async () => {
    setDeleting(true);
    const response = await fetch(`/api/skills/${skill.id}`, { method: 'DELETE' }).catch(() => null);
    setDeleting(false);
    if (response?.ok) {
      toast.success('Loop deleted');
      router.push('/');
      router.refresh();
    } else {
      toast.error('Could not delete the loop');
    }
  };

  const result = record?.result;
  const finished = record?.status === 'done' || record?.status === 'failed';
  const status = running ? 'running' : record?.status === 'done' ? 'done' : finished ? 'failed' : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 md:p-10">
      <div className="space-y-3">
        <Link href="/" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          <ArrowLeft />
          Loops
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">{skill.name}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline">
                {skill.trigger.type} · {skill.trigger.value}
              </Badge>
              <span className="tabular">{skill.steps.length} steps</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="size-3.5" />
                {skill.profileId ? 'Saved login' : 'No saved login'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => void start()} disabled={running}>
              <Play />
              {running ? 'Running…' : runId ? 'Run again' : 'Run now'}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="outline" size="icon" aria-label="Loop actions">
                    ⋯
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onClick={() => setConfirmOpen(true)}>
                  <Trash2 />
                  Delete loop
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {!runId && !running ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Run this loop</CardTitle>
            <CardDescription>
              {variableParams.length > 0
                ? 'Fill in the values that change each run.'
                : 'No inputs needed — press Run now.'}
            </CardDescription>
          </CardHeader>
          {variableParams.length > 0 ? (
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {variableParams.map((step) => (
                <div key={step.param!.name} className="space-y-2">
                  <Label className="font-mono text-xs">{step.param!.name}</Label>
                  <Input
                    value={params[step.param!.name] ?? ''}
                    onChange={(event) =>
                      setParams((prev) => ({ ...prev, [step.param!.name]: event.target.value }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">{step.text}</p>
                </div>
              ))}
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {runId && !runMissing ? (
        <Card className="overflow-hidden py-0">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <div className="flex items-center gap-2.5 text-sm font-medium">
              {status === 'running' ? (
                <>
                  <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                  Running
                </>
              ) : status === 'done' ? (
                <>
                  <span className="size-1.5 rounded-full bg-primary" />
                  Done
                </>
              ) : status === 'failed' ? (
                <>
                  <TriangleAlert className="size-4 text-destructive" />
                  Needs you
                </>
              ) : null}
            </div>
            {running && startedAt != null ? (
              <span className="font-mono text-sm text-muted-foreground tabular">
                {formatClock(now - startedAt)}
              </span>
            ) : null}
          </div>

          {record?.debugUrl && (running || record.status === 'failed') ? (
            <div className="p-3">
              <BrowserPane
                src={record.debugUrl}
                title="Steel live session"
                label="live session · steel cloud"
                className="border-0 shadow-none"
              />
              <div className="flex items-center justify-between px-1 pt-2 text-xs text-muted-foreground">
                <span>
                  {running
                    ? 'You can take over in a new tab; we don’t see what you type.'
                    : 'This session is kept open so you can take over and finish the step yourself.'}
                </span>
                <a href={record.debugUrl} target="_blank" rel="noreferrer" className="hover:text-foreground">
                  Take over ↗
                </a>
              </div>
            </div>
          ) : null}

          {finished && result ? (
            <CardContent className="space-y-4 pt-4">
              <p className="text-sm">
                <span className="font-medium">
                  {result.stepsRun}/{result.totalSteps} steps
                </span>
                {result.skipped ? (
                  <span className="text-muted-foreground"> · {result.skipped} skipped (signed in)</span>
                ) : null}
              </p>

              {result.error && record?.status === 'failed' ? (
                <p className="text-sm text-destructive">{result.error}</p>
              ) : null}

              {(result.healed?.length ?? 0) > 0 ? (
                <div className="space-y-2">
                  <Badge variant="secondary" className="gap-1.5">
                    <Sparkles className="size-3" />
                    Self-healed {result.healed.length} step{result.healed.length === 1 ? '' : 's'}
                  </Badge>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {result.healed.map((heal) => (
                      <li key={heal.step} className="font-mono">
                        step {heal.step}: {heal.from} → {heal.to}
                        {heal.via === 'vision' ? ' · vision' : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="space-y-2">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Downloads
                </p>
                {result.files.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No files downloaded.</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {result.files.map((file) => (
                      <a
                        key={file.path}
                        href={`/api/downloads/${runId}/${file.name}`}
                        className="flex items-center gap-3 rounded-lg border p-3 text-sm transition-colors hover:border-primary/50 hover:bg-accent/40"
                      >
                        <span className="grid size-8 place-items-center rounded-md bg-secondary text-muted-foreground">
                          <FileText className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{file.name}</span>
                        <Download className="size-4 text-muted-foreground" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {error && !record ? <p className="text-sm text-destructive">{error}</p> : null}

      {runMissing ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <TriangleAlert className="size-4 text-destructive" />
            That run is no longer available.
          </div>
          <Button variant="outline" size="sm" onClick={() => void start()}>
            <Play />
            Run now
          </Button>
        </Card>
      ) : null}

      <Card className="py-0">
        <CardHeader className="border-b py-3">
          <CardTitle className="text-sm">Steps</CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {skill.steps.map((step) => (
            <div key={step.n} className="flex items-start gap-3 p-3">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-secondary font-mono text-[11px] text-muted-foreground tabular">
                {step.n}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm">{step.text}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {step.action}
                  </Badge>
                  {step.param?.mode === 'variable' ? (
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      {`{{${step.param.name}}}`}
                    </Badge>
                  ) : null}
                  {step.loop?.each ? (
                    <Badge variant="secondary" className="gap-1 text-[10px]">
                      <Repeat2 className="size-3" />
                      each
                    </Badge>
                  ) : null}
                  {step.skipIfAuthenticated ? (
                    <Badge variant="outline" className="text-[10px]">
                      skip if signed in
                    </Badge>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this loop?</AlertDialogTitle>
            <AlertDialogDescription>
              “{skill.name}” will be removed permanently. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              <Trash2 />
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
