import Link from 'next/link';
import { History } from 'lucide-react';
import { store } from '@/lib/store';
import { runs } from '@/lib/runs';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const dynamic = 'force-dynamic';

function statusBadge(status: 'running' | 'done' | 'failed') {
  if (status === 'running') {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <span className="size-1.5 animate-pulse rounded-full bg-primary" />
        Running
      </Badge>
    );
  }
  if (status === 'done') return <Badge variant="outline">Done</Badge>;
  return <Badge variant="destructive">Needs you</Badge>;
}

export default function RunsPage() {
  const skillNames = new Map(store.skills.values().map((skill) => [skill.id, skill.name]));
  const all = [...runs.values()].sort((a, b) => b.startedAt - a.startedAt);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-6 md:p-10">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
        <p className="text-sm text-muted-foreground">
          {all.length === 0
            ? 'Runs started from a loop show up here.'
            : `${all.length} run${all.length === 1 ? '' : 's'} this session.`}
        </p>
      </header>

      {all.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-16 text-center">
          <span className="grid size-10 place-items-center rounded-full bg-secondary text-muted-foreground">
            <History className="size-5" />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium">No runs yet</p>
            <p className="text-sm text-muted-foreground">
              Open a loop and press Run to watch it work.
            </p>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Loop</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Started</TableHead>
                <TableHead className="hidden md:table-cell">Steps</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {all.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/loops/${run.skillId}?runId=${run.id}`}
                      className="hover:text-primary"
                    >
                      {skillNames.get(run.skillId) ?? 'Unknown loop'}
                    </Link>
                  </TableCell>
                  <TableCell>{statusBadge(run.status)}</TableCell>
                  <TableCell className="hidden text-muted-foreground tabular sm:table-cell">
                    {new Date(run.startedAt).toLocaleTimeString()}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground tabular md:table-cell">
                    {run.result ? `${run.result.stepsRun}/${run.result.totalSteps}` : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
