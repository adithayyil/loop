import Anthropic from '@anthropic-ai/sdk';
import {
  deterministicSteps,
  describeAction,
  hasRepeatIntent,
  type CompileContext,
  type StepInferer,
} from './compiler';
import type { Action, CompileResult, CompiledStep, ParamMode } from './types';

const MODEL = process.env.LOOP_COMPILER_MODEL ?? 'claude-sonnet-4-5';

const SYSTEM = `You turn a recording of a browser task into a short, plain-language step list a
non-technical person can review and edit.

Rules:
- Produce exactly one step per recorded action, in the recorded order, echoing that
  action's zero-based index as actionIndex. Do not merge or drop actions. A click
  that leads to a new page is already captured by the click, so never write a
  separate "navigate to" step for it.
- Write steps as imperatives in the user's own words, at most one sentence each.
  Collapse focus clicks, keep the intent. E.g. "Log in to the vendor portal",
  "Filter the list to Unpaid", "Download the first invoice PDF".
- For every literal value the action introduces (typed text, a username, a filter
  choice), add a "param" guess: mode "variable" if a normal person would plausibly
  change it each run (search terms, dates, filter values, form data that varies),
  otherwise "fixed". Name the param after what it means in snake_case (at most three
  words), for example repository_name or status. Never name it after a file name,
  URL, or the element text. Always set its current value.
- If a value looks like a credential or an obviously stable setting, prefer "fixed".
- Mark sign-in-only steps (entering credentials, clicking Sign in) that exist purely
  to authenticate (not the task itself) with skipIfAuthenticated: true, so a saved
  login can skip them on later runs.
- If the action is meant to run for every item on the page (the goal says "each",
  "every", or "all"), set repeatForEach: true on that step so replay iterates the
  list. Set it only on the repeated action itself, not on the filter/navigation
  steps around it.
- Keep title short (3-6 words). Keep summary to one sentence.`;

const TOOL = {
  name: 'emit_steps',
  description: 'Emit the reviewed step list for the recorded task.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string' as const },
      summary: { type: 'string' as const },
      steps: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            actionIndex: { type: 'number' as const },
            text: { type: 'string' as const },
            skipIfAuthenticated: { type: 'boolean' as const },
            repeatForEach: { type: 'boolean' as const },
            param: {
              type: 'object' as const,
              properties: {
                name: { type: 'string' as const },
                mode: { type: 'string' as const, enum: ['fixed', 'variable'] },
                value: { type: 'string' as const },
              },
              required: ['name', 'mode'],
            },
          },
          required: ['actionIndex', 'text'],
        },
      },
    },
    required: ['title', 'summary', 'steps'],
  },
};

function buildPrompt(actions: Action[], context: CompileContext): string {
  return [
    `Start URL: ${context.title ?? actions.find((a) => a.kind === 'goto')?.url ?? 'unknown'}`,
    context.narration ? `Narration: ${context.narration}` : null,
    '',
    'Recorded actions (JSON):',
    JSON.stringify(
      actions.map((a, i) => ({
        actionIndex: i,
        kind: a.kind,
        css: a.css,
        role: a.role,
        name: a.name,
        dataTest: a.dataTest,
        value: a.value,
        url: a.url,
      })),
      null,
      1,
    ),
  ]
    .filter((line) => line !== null)
    .join('\n');
}

interface RawStep {
  actionIndex?: number;
  text?: string;
  skipIfAuthenticated?: boolean;
  repeatForEach?: boolean;
  param?: { name?: string; mode?: string; value?: string };
}

/** Keep the LLM's language and parameter guesses, but bind locators to the actions. */
function coerce(raw: unknown, actions: Action[], context: CompileContext = {}): CompileResult {
  const data = raw as { title?: unknown; summary?: unknown; steps?: unknown };
  const rawSteps: RawStep[] = Array.isArray(data.steps) ? data.steps : [];

  const steps: CompiledStep[] = [];
  for (const rawStep of rawSteps) {
    const index = rawStep.actionIndex;
    if (typeof index !== 'number' || !actions[index]) continue;
    const action = actions[index];
    const mode = rawStep.param?.mode;
    const param =
      rawStep.param && typeof rawStep.param.name === 'string' && (mode === 'fixed' || mode === 'variable')
        ? {
            name: rawStep.param.name,
            mode: mode as ParamMode,
            value: rawStep.param.value ?? action.value,
          }
        : undefined;
    const repeat =
      rawStep.repeatForEach === true || (hasRepeatIntent(context) && action === actions[actions.length - 1]);
    steps.push({
      n: steps.length + 1,
      text: rawStep.text?.trim() || describeAction(action),
      action: action.kind,
      url: action.url,
      css: action.css,
      role: action.role ?? null,
      name: action.name ?? null,
      dataTest: action.dataTest ?? null,
      value: action.value,
      skipIfAuthenticated: rawStep.skipIfAuthenticated === true || undefined,
      param,
      loop: repeat && action.kind !== 'goto' ? { each: true } : undefined,
    });
  }

  if (steps.length === 0) return deterministicSteps(actions, context);
  return {
    title: typeof data.title === 'string' && data.title.trim() ? data.title : 'Recorded task',
    summary:
      typeof data.summary === 'string' && data.summary.trim()
        ? data.summary
        : `${steps.length} steps`,
    steps,
  };
}

/** LLM-backed inferer; silently degrades to deterministic steps without a key. */
export function anthropicInferer(): StepInferer {
  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) return async (actions, context) => deterministicSteps(actions, context);
  const client = new Anthropic({ apiKey });

  return async (actions, context) => {
    try {
      const message = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM,
        messages: [{ role: 'user', content: buildPrompt(actions, context) }],
        tools: [TOOL],
        tool_choice: { type: 'tool', name: TOOL.name },
      });
      const toolUse = message.content.find((block) => block.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') return deterministicSteps(actions, context);
      return coerce(toolUse.input, actions, context);
    } catch {
      return deterministicSteps(actions, context);
    }
  };
}
