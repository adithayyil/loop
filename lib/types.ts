export type RecordedEventType = 'click' | 'change' | 'enter' | 'navigate';

export interface TargetInfo {
  tag?: string;
  css?: string;
  role?: string | null;
  name?: string | null;
  dataTest?: string | null;
  id?: string | null;
  inputType?: string | null;
  checked?: boolean | null;
  cls?: string | null;
}

export interface RecordedEvent extends TargetInfo {
  ts: number;
  type: RecordedEventType;
  url: string;
  title?: string;
  value?: string;
}

export type ActionKind = 'goto' | 'fill' | 'type+enter' | 'click' | 'select';

export interface Action extends TargetInfo {
  kind: ActionKind;
  ts?: number;
  url?: string;
  value?: string;
  note?: string;
}

export type ParamMode = 'fixed' | 'variable';

export interface StepParam {
  name: string;
  mode: ParamMode;
  value?: string;
}

/** Repeat a step once per matching item on the page ("download each invoice"). */
export interface LoopSpec {
  each: true;
  /** Safety cap on iterations. Defaults to 25 at replay time. */
  max?: number;
}

export interface CompiledStep {
  n: number;
  text: string;
  action: ActionKind;
  url?: string;
  css?: string;
  role?: string | null;
  name?: string | null;
  dataTest?: string | null;
  /** Zero-based match index, set by self-healing when several elements share a name. */
  nth?: number;
  value?: string;
  /** Sign-in-only step; safe to skip when a saved profile is already authenticated. */
  skipIfAuthenticated?: boolean;
  param?: StepParam;
  /** When set, replay runs this step for every matching item. */
  loop?: LoopSpec;
}

export interface CompileResult {
  title: string;
  summary: string;
  steps: CompiledStep[];
}

/** A transcribed span of voice narration, with times relative to recording start. */
export interface NarrationSegment {
  start: number;
  end: number;
  text: string;
}

export interface Skill {
  id: string;
  name: string;
  trigger:
    | { type: 'phrase'; value: string }
    | { type: 'schedule'; value: string };
  profileId: string | null;
  sourceRecordingId: string;
  steps: CompiledStep[];
  createdAt: number;
}

export interface Recording {
  id: string;
  sessionId: string;
  debugUrl: string;
  status: 'recording' | 'stopped';
  events: RecordedEvent[];
  profileId?: string | null;
  hlsUrl?: string | null;
  /** Full voice-narration transcript, when the user narrated the recording. */
  narration?: string;
  /** Timestamped narration spans (seconds from recording start). */
  narrationSegments?: NarrationSegment[];
  startedAt: number;
  stoppedAt?: number;
  result?: CompileResult;
}
