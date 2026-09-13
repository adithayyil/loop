'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileJson,
  Info,
  Layers,
  Repeat2,
  Save,
  Trash2,
} from 'lucide-react';
import type { CompileResult, CompiledStep, RecordedEvent } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
  narration,
}: {
  recordingId: string;
  initial: CompileResult;
  events: RecordedEvent[];
  profileId: string | null;
  narration: string | null;
}) {
  const router = useRouter();
  const [steps, setSteps] = useState<CompiledStep[]>(initial.steps);
  const [name, setName] = useState(initial.title);
  const [triggerType, setTriggerType] = useState<'phrase' | 'schedule'>('phrase');
  const [phrase, setPhrase] = useState(slug(initial.title).replace(/_/g, ' '));
  const [schedule, setSchedule] = useState('0 9 * * 1');
  const [openPill, setOpenPill] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const variableCount = useMemo(
    () => steps.filter((step) => step.param?.mode === 'variable').length,
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

  const toggleLoop = (index: number) => {
    setSteps((prev) =>
      prev.map((step, i) =>
        i === index ? { ...step, loop: step.loop?.each ? undefined : { each: true } } : step,
      ),
    );
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
    <div className="mx-auto grid w-full max-w-6xl gap-8 p-6 md:p-10 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-6">
        <div className="space-y-3">
          <Link href="/" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            <ArrowLeft />
            Loops
          </Link>
          <div>
            <Label htmlFor="loop-name" className="text-xs text-muted-foreground">
              Loop name
            </Label>
            <input
              id="loop-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full border-0 bg-transparent p-0 text-2xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground"
            />
          </div>
          <p className="text-sm text-muted-foreground">{initial.summary}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={variableCount > 0 ? 'default' : 'secondary'}>
              {variableCount > 0
                ? `${variableCount} value${variableCount === 1 ? '' : 's'} change each run`
                : 'All values are fixed'}
            </Badge>
            <Badge variant="outline" className="gap-1.5">
              <Info className="size-3" />
              Click a value to make it change each run
            </Badge>
          </div>
        </div>

        {narration ? (
          <Card className="border-primary/30 bg-primary/5 py-3">
            <CardContent className="flex gap-3 text-sm">
              <MicNote />
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">You said: </span>
                “{narration}”
              </p>
            </CardContent>
          </Card>
        ) : null}

        <Card className="py-0">
          <CardHeader className="flex-row items-center justify-between border-b py-3">
            <CardTitle className="text-sm">Steps</CardTitle>
            <Sheet>
              <SheetTrigger
                render={
                  <Button variant="ghost" size="sm">
                    <FileJson />
                    Raw events
                  </Button>
                }
              />
              <SheetContent side="right" className="w-full sm:max-w-lg">
                <SheetHeader>
                  <SheetTitle>Original events</SheetTitle>
                  <SheetDescription>
                    The unedited capture. Steps above are inferred from these.
                  </SheetDescription>
                </SheetHeader>
                <div className="flex-1 overflow-auto px-4 pb-4">
                  <pre className="rounded-lg bg-background p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                    {events.map((event) => JSON.stringify(event)).join('\n')}
                  </pre>
                </div>
              </SheetContent>
            </Sheet>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {steps.map((step, index) => {
              const pillValue = step.value ?? step.param?.value;
              const showPill = pillValue != null || step.param != null;
              const variable = step.param?.mode === 'variable';
              return (
                <div key={index} className="flex items-start gap-3 p-3">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-secondary font-mono text-[11px] text-muted-foreground tabular">
                    {step.n}
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <input
                      value={step.text}
                      onChange={(event) => updateStep(index, { text: event.target.value })}
                      className="w-full border-0 bg-transparent p-0 text-sm font-medium outline-none"
                    />
                    {showPill ? (
                      <Popover open={openPill === index} onOpenChange={(open) => setOpenPill(open ? index : null)}>
                        <PopoverTrigger
                          render={
                            <button
                              type="button"
                              className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                                variable
                                  ? 'border-primary/40 bg-primary/10 text-primary'
                                  : 'border-border bg-secondary/60 text-muted-foreground'
                              }`}
                            >
                              <span className="font-mono">{pillValue}</span>
                              <span className="opacity-70">{variable ? 'each run' : 'fixed'}</span>
                            </button>
                          }
                        />
                        <PopoverContent align="start" className="w-64 space-y-2 p-3">
                          <p className="text-xs text-muted-foreground">
                            Does this value change each run?
                          </p>
                          <Button
                            variant={variable ? 'default' : 'outline'}
                            size="sm"
                            className="w-full justify-start"
                            onClick={() => {
                              setMode(index, 'variable');
                              setOpenPill(null);
                            }}
                          >
                            <Check className={variable ? '' : 'opacity-0'} />
                            Changes each time
                          </Button>
                          <Button
                            variant={!variable ? 'default' : 'outline'}
                            size="sm"
                            className="w-full justify-start"
                            onClick={() => {
                              setMode(index, 'fixed');
                              setOpenPill(null);
                            }}
                          >
                            <Check className={!variable ? '' : 'opacity-0'} />
                            Always the same
                          </Button>
                          {variable && step.param ? (
                            <div className="space-y-1.5 pt-1">
                              <Label className="text-xs">Parameter name</Label>
                              <Input
                                value={step.param.name}
                                onChange={(event) =>
                                  updateStep(index, {
                                    param: {
                                      name: event.target.value,
                                      mode: 'variable',
                                      value: step.value,
                                    },
                                  })
                                }
                                className="h-7 font-mono text-xs"
                              />
                            </div>
                          ) : null}
                        </PopoverContent>
                      </Popover>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {step.action !== 'goto' ? (
                      <Button
                        variant={step.loop?.each ? 'secondary' : 'ghost'}
                        size="icon-sm"
                        title="Repeat for every matching item"
                        onClick={() => toggleLoop(index)}
                      >
                        <Repeat2 className={step.loop?.each ? 'text-primary' : ''} />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Delete step"
                      onClick={() => removeStep(index)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Save as a loop</CardTitle>
            <CardDescription>Run it on demand, or exactly like this every time.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {savedId ? (
              <div className="space-y-3">
                <p className="flex items-center gap-2 text-sm font-medium text-primary">
                  <Check className="size-4" />
                  Saved.
                </p>
                <Link
                  href={`/loops/${savedId}?run=1`}
                  className={buttonVariants({ className: 'w-full' })}
                >
                  Run it now
                  <ArrowRight />
                </Link>
                <Link
                  href="/"
                  className={buttonVariants({ variant: 'outline', className: 'w-full' })}
                >
                  Back to loops
                </Link>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="trigger-name">Trigger</Label>
                  <Tabs
                    value={triggerType}
                    onValueChange={(value) => setTriggerType(value as 'phrase' | 'schedule')}
                  >
                    <TabsList className="w-full">
                      <TabsTrigger value="phrase">Phrase</TabsTrigger>
                      <TabsTrigger value="schedule">Schedule</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  {triggerType === 'phrase' ? (
                    <Input
                      id="trigger-name"
                      value={phrase}
                      onChange={(event) => setPhrase(event.target.value)}
                      placeholder="download unpaid invoices"
                    />
                  ) : (
                    <Input
                      value={schedule}
                      onChange={(event) => setSchedule(event.target.value)}
                      placeholder="0 9 * * 1"
                      className="font-mono"
                    />
                  )}
                </div>
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
                <Button className="w-full" onClick={() => void save()} disabled={saving}>
                  <Save />
                  {saving ? 'Saving…' : 'Looks good, save it'}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  or keep refining the steps
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {profileId ? (
          <Card className="py-3">
            <CardContent className="flex items-center gap-2 text-xs text-muted-foreground">
              <Layers className="size-3.5" />
              Saved login reused on every run.
            </CardContent>
          </Card>
        ) : null}
      </aside>
    </div>
  );
}

function MicNote() {
  return (
    <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-primary/15 text-primary">
      <MicIcon />
    </span>
  );
}

function MicIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="2.5" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.9" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
