import type { AgentStep } from './agent';

export interface AgentRecord {
  id: string;
  goal: string;
  startUrl: string;
  status: 'running' | 'done' | 'failed';
  sessionId?: string;
  debugUrl?: string;
  steps: AgentStep[];
  recordingId?: string;
  summary?: string;
  error?: string;
  startedAt: number;
}

const globalRef = globalThis as unknown as { __loopAgentRuns?: Map<string, AgentRecord> };

/** globalThis-backed so the polling route sees runs started by the agent route. */
export const agentRuns: Map<string, AgentRecord> =
  globalRef.__loopAgentRuns ?? (globalRef.__loopAgentRuns = new Map());
