'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CalendarClock,
  MoreHorizontal,
  MousePointerClick,
  Play,
  Search,
  Sparkles,
  Trash2,
  Workflow,
} from 'lucide-react';
import { toast } from 'sonner';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export interface LoopSummary {
  id: string;
  name: string;
  trigger: { type: 'phrase' | 'schedule'; value: string };
  stepCount: number;
  hasProfile: boolean;
}

export function LoopsHome({ loops }: { loops: LoopSummary[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<LoopSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return loops;
    return loops.filter(
      (loop) =>
        loop.name.toLowerCase().includes(q) ||
        loop.trigger.value.toLowerCase().includes(q) ||
        loop.trigger.type.includes(q),
    );
  }, [loops, query]);

  const run = (id: string) => router.push(`/loops/${id}?run=1`);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const response = await fetch(`/api/skills/${pendingDelete.id}`, { method: 'DELETE' }).catch(
      () => null,
    );
    setDeleting(false);
    if (response?.ok) {
      toast.success(`Deleted “${pendingDelete.name}”`);
      setPendingDelete(null);
      router.refresh();
    } else {
      toast.error('Could not delete the loop');
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6 md:p-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Loops</h1>
          <p className="text-sm text-muted-foreground">
            {loops.length === 0
              ? 'Record a task once, replay it forever.'
              : `${loops.length} saved loop${loops.length === 1 ? '' : 's'}.`}
          </p>
        </div>
        <Link href="/new" className={buttonVariants()}>
          <MousePointerClick />
          New loop
        </Link>
      </header>

      {loops.length === 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/new?mode=record" className="group">
            <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/40">
              <CardHeader>
                <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <MousePointerClick className="size-4.5" />
                </span>
                <CardTitle className="mt-2">Record it yourself</CardTitle>
                <CardDescription>
                  Drive a cloud browser and show loop what to do. It turns your clicks into an
                  editable step list.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                  Start recording <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </CardContent>
            </Card>
          </Link>
          <Link href="/new?mode=agent" className="group">
            <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/40">
              <CardHeader>
                <span className="grid size-9 place-items-center rounded-lg bg-secondary text-foreground">
                  <Sparkles className="size-4.5" />
                </span>
                <CardTitle className="mt-2">Describe it</CardTitle>
                <CardDescription>
                  Give the agent a goal in plain language and watch it work. Keep the steps it
                  discovers as a loop.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                  Ask the agent <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </CardContent>
            </Card>
          </Link>
        </div>
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="flex items-center gap-3 border-b p-3">
            <div className="relative flex-1">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search loops…"
                className="pl-8"
              />
            </div>
            <Badge variant="secondary" className="tabular">
              {filtered.length}
            </Badge>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Loop</TableHead>
                <TableHead className="hidden sm:table-cell">Trigger</TableHead>
                <TableHead className="hidden md:table-cell">Steps</TableHead>
                <TableHead className="hidden md:table-cell">Access</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((loop) => (
                <TableRow key={loop.id}>
                  <TableCell>
                    <Link
                      href={`/loops/${loop.id}`}
                      className="flex items-center gap-2.5 font-medium hover:text-primary"
                    >
                      <span className="grid size-7 place-items-center rounded-md bg-secondary text-muted-foreground">
                        <Workflow className="size-3.5" />
                      </span>
                      {loop.name}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="outline" className="gap-1">
                      {loop.trigger.type === 'schedule' ? (
                        <CalendarClock className="size-3" />
                      ) : null}
                      <span className="max-w-[14rem] truncate font-normal">{loop.trigger.value}</span>
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground tabular md:table-cell">
                    {loop.stepCount}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {loop.hasProfile ? 'Saved login' : 'None'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => run(loop.id)}>
                        <Play />
                        Run
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button size="icon-sm" variant="ghost" aria-label="Loop actions">
                              <MoreHorizontal />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => router.push(`/loops/${loop.id}`)}>
                            Open
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => run(loop.id)}>Run now</DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setPendingDelete(loop)}
                          >
                            <Trash2 />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No loops match “{query}”.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this loop?</AlertDialogTitle>
            <AlertDialogDescription>
              “{pendingDelete?.name}” will be removed permanently. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
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
