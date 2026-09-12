import type { RunResult } from './replay';

export interface RunRecord {
  id: string;
  skillId: string;
  status: 'running' | 'done' | 'failed';
  sessionId?: string;
  debugUrl?: string;
  error?: string;
  result?: RunResult;
  startedAt: number;
}

const globalRef = globalThis as unknown as { __loopRuns?: Map<string, RunRecord> };

/** globalThis-backed so the polling route sees runs started by the run route. */
export const runs: Map<string, RunRecord> =
  globalRef.__loopRuns ?? (globalRef.__loopRuns = new Map());
