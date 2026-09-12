import type {
  Action,
  CompileResult,
  CompiledStep,
  RecordedEvent,
  TargetInfo,
} from './types';

/** Clicking a text field is just focus; the fill/enter carries the intent. */
const FOCUS_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);

const CHALLENGE = /captcha|recaptcha|hcaptcha|turnstile|challenge|verify-button|\/sorry/i;

/**
 * Bot-challenge interactions can't be replayed (and aren't part of the user's task),
 * so they are dropped from the captured flow before compilation.
 */
export function isChallengeEvent(event: RecordedEvent): boolean {
  return CHALLENGE.test(
    [event.css, event.id, event.name, event.dataTest, event.url].filter(Boolean).join(' '),
  );
}

function keyOf(event: TargetInfo): string {
  return (
    event.dataTest ||
    event.id ||
    event.css ||
    `${event.role ?? '?'}:${event.name ?? '?'}`
  );
}

function targetOf(event: RecordedEvent): Omit<Action, 'kind'> {
  return {
    ts: event.ts,
    css: event.css,
    role: event.role,
    name: event.name,
    dataTest: event.dataTest,
    id: event.id,
    inputType: event.inputType,
    tag: event.tag,
  };
}

/**
 * Collapse raw DOM events into execution actions. Pure and deterministic so it
 * can be fixture-tested without a live session or an LLM.
 */
export function normalize(events: RecordedEvent[]): Action[] {
  const actions: Action[] = [];
  const pending = new Map<string, Action>();
  let lastNavUrl: string | null = null;
  let lastClickKey: string | null = null;

  const flushPending = () => {
    for (const action of pending.values()) actions.push(action);
    pending.clear();
  };

  const firstUrl = events.find(
    (e) => e.url && e.url !== 'about:blank' && !isChallengeEvent(e),
  )?.url;
  if (firstUrl) {
    actions.push({ kind: 'goto', url: firstUrl });
    lastNavUrl = firstUrl;
  }

  for (const event of events) {
    if (isChallengeEvent(event)) continue;

    if (event.type === 'navigate') {
      if (event.url && event.url !== 'about:blank' && event.url !== lastNavUrl) {
        flushPending();
        // A navigation right after a click or Enter is that action's outcome, not a
        // step of its own. Replaying the click/submit already goes there, so emitting
        // a separate `goto` would duplicate the step.
        const previous = actions[actions.length - 1];
        const impliedByPreviousAction =
          previous?.kind === 'click' || previous?.kind === 'type+enter';
        if (!impliedByPreviousAction) {
          actions.push({ kind: 'goto', url: event.url });
        }
        lastNavUrl = event.url;
      }
      continue;
    }

    const key = keyOf(event);

    if (event.type === 'change') {
      if (key === lastClickKey) continue;
      if (event.value != null && event.value !== '') {
        pending.set(key, { kind: 'fill', ...targetOf(event), value: event.value });
      }
      continue;
    }

    if (event.type === 'enter') {
      pending.delete(key);
      if (event.value && event.value.trim()) {
        actions.push({ kind: 'type+enter', ...targetOf(event), value: event.value });
      }
      continue;
    }

    if (event.type === 'click') {
      if (FOCUS_ROLES.has(event.role ?? '')) continue;
      flushPending();
      actions.push({
        kind: 'click',
        ...targetOf(event),
        note: event.role === 'checkbox' || event.role === 'radio' ? 'toggle' : undefined,
      });
      lastClickKey = key;
    }
  }

  flushPending();
  return actions;
}

export interface CompileContext {
  title?: string;
  narration?: string;
}

export type StepInferer = (actions: Action[], context: CompileContext) => Promise<CompileResult>;

/** Plain-language text for an action, used by the offline fallback. */
export function describeAction(action: Action): string {
  const label = action.name?.trim() || action.css || action.role || 'element';
  switch (action.kind) {
    case 'goto':
      return `Go to ${action.url}`;
    case 'fill':
      return `Enter "${action.value}" in the ${label}`;
    case 'type+enter':
      return `Type "${action.value}" and press Enter`;
    case 'select':
      return `Select "${action.value}" in the ${label}`;
    case 'click':
      return `Click ${label}${action.note === 'toggle' ? ' (toggle)' : ''}`;
  }
}

/** Deterministic step list for when no LLM key is configured or the call fails. */
export function deterministicSteps(actions: Action[]): CompileResult {
  const steps: CompiledStep[] = actions.map((action, index) => ({
    n: index + 1,
    text: describeAction(action),
    action: action.kind,
    url: action.url,
    css: action.css,
    role: action.role ?? null,
    name: action.name ?? null,
    dataTest: action.dataTest ?? null,
    value: action.value,
  }));
  return { title: 'Recorded task', summary: `${steps.length} steps`, steps };
}

/** Normalize events, then let the injected inferer turn them into steps. */
export async function compile(
  events: RecordedEvent[],
  infer: StepInferer,
  context: CompileContext = {},
): Promise<CompileResult> {
  return infer(normalize(events), context);
}
