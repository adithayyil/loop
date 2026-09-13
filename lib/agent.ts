import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { chromium, type Page } from 'playwright-core';
import { RECORDER_SCRIPT } from './recorder';
import { captchaSolvingEnabled, createSession, steelApiKey, steelClient } from './steel';
import type { RecordedEvent } from './types';

const MODEL = process.env.LOOP_AGENT_MODEL ?? process.env.LOOP_COMPILER_MODEL ?? 'claude-sonnet-4-5';
const DEFAULT_MAX_STEPS = 15;

export interface AgentStep {
  n: number;
  action: string;
  detail: string;
  result?: string;
}

export interface AgentResult {
  status: 'done' | 'failed';
  steps: AgentStep[];
  events: RecordedEvent[];
  sessionId: string;
  debugUrl: string;
  summary?: string;
  error?: string;
}

export interface RunAgentOptions {
  goal: string;
  startUrl: string;
  maxSteps?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onSession?: (sessionId: string, debugUrl: string) => void;
  onStep?: (step: AgentStep) => void;
}

const SYSTEM = `You are loop's browser agent. You drive a real cloud browser to accomplish a
user's goal, one action at a time, so the actions can be recorded and replayed later.

Rules:
- Look at the current page snapshot (roles + accessible names) and choose exactly one action.
- Prefer acting on elements by their role and accessible name, copied verbatim from the snapshot.
- If several elements share a name, pass a zero-based "nth" to pick one.
- After typing into a field, you may pass submit:true to press Enter.
- Work step by step; do not skip ahead. If a page is loading, use wait.
- If the page already contains what the goal asks for, call "done" immediately with the
  answer in the summary — do not keep scrolling. Only scroll when the target is clearly
  below the fold, and at most once or twice.
- Never repeat the same action more than twice in a row; if it isn't working, try a
  different approach or call "fail".
- Never enter real credentials unless the goal provides them. Never pay, delete data, or
  change account settings unless the goal explicitly asks.
- When the goal is achieved, call "done" with a one-sentence summary (include the answer
  if the goal was a question). If you are truly stuck, call "fail" with the reason.
- Keep going until done; you have a limited number of steps.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'goto',
    description: 'Navigate the browser to a URL.',
    input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  },
  {
    name: 'click',
    description: 'Click an element by role/accessible name (or label/text).',
    input_schema: {
      type: 'object',
      properties: {
        role: { type: 'string' },
        name: { type: 'string' },
        label: { type: 'string' },
        text: { type: 'string' },
        nth: { type: 'number' },
      },
    },
  },
  {
    name: 'type',
    description: 'Type text into a field, optionally pressing Enter afterwards.',
    input_schema: {
      type: 'object',
      properties: {
        role: { type: 'string' },
        name: { type: 'string' },
        label: { type: 'string' },
        placeholder: { type: 'string' },
        text: { type: 'string' },
        value: { type: 'string' },
        submit: { type: 'boolean' },
        nth: { type: 'number' },
      },
      required: ['text', 'value'],
    },
  },
  {
    name: 'select',
    description: 'Choose an option in a dropdown by label/name.',
    input_schema: {
      type: 'object',
      properties: {
        role: { type: 'string' },
        name: { type: 'string' },
        label: { type: 'string' },
        value: { type: 'string' },
      },
      required: ['value'],
    },
  },
  {
    name: 'press',
    description: 'Press a keyboard key, e.g. Enter or Escape.',
    input_schema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  },
  {
    name: 'scroll',
    description: 'Scroll the page up or down.',
    input_schema: {
      type: 'object',
      properties: { direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'number' } },
      required: ['direction'],
    },
  },
  {
    name: 'wait',
    description: 'Wait briefly for the page to settle.',
    input_schema: { type: 'object', properties: { ms: { type: 'number' } } },
  },
  {
    name: 'done',
    description: 'Call when the goal is complete.',
    input_schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
  },
  {
    name: 'fail',
    description: 'Call when the goal cannot be completed.',
    input_schema: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
  },
];

async function observe(page: Page): Promise<string> {
  const url = page.url();
  const title = await page.title().catch(() => '');
  let snapshot = '';
  try {
    snapshot = await page.locator('body').ariaSnapshot({ mode: 'ai', timeout: 5000 });
  } catch {
    snapshot = '(no accessibility snapshot available)';
  }
  if (snapshot.length > 14_000) snapshot = `${snapshot.slice(0, 14_000)}\n… (truncated)`;
  return `URL: ${url}\nTitle: ${title}\nSnapshot:\n${snapshot}`;
}

const CHALLENGE_URL = /captcha|recaptcha|hcaptcha|turnstile|challenge|\/sorry\//i;
const CHALLENGE_DOM =
  '#recaptcha-verify-button, #rc-imageselect, iframe[src*="recaptcha/api2/bframe"], iframe[src*="hcaptcha.com"], iframe[src*="challenges.cloudflare.com"], iframe[title*="challenge" i]';

/** True when the page is a bot challenge (captcha). We stop and hand off rather than flail. */
async function detectChallenge(page: Page): Promise<boolean> {
  if (CHALLENGE_URL.test(page.url())) return true;
  try {
    return (await page.locator(CHALLENGE_DOM).count()) > 0;
  } catch {
    return false;
  }
}

const CHALLENGE_MESSAGE =
  'The page is behind a CAPTCHA / bot challenge. Solve it in the live view, or set LOOP_SOLVE_CAPTCHA=1 with a paid Steel balance to auto-solve.';

/**
 * Whether a challenge should block the run. With auto-solving enabled, Steel clears
 * the challenge inside the session, so we give it a bounded window to finish and only
 * give up if the page is still challenged afterwards.
 */
async function challengeBlocks(page: Page): Promise<boolean> {
  if (!(await detectChallenge(page))) return false;
  if (!captchaSolvingEnabled()) return true;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    if (!(await detectChallenge(page))) return false;
  }
  return true;
}

function locatorFor(page: Page, input: Record<string, unknown>) {
  const nth = typeof input.nth === 'number' ? input.nth : 0;
  if (typeof input.role === 'string' && typeof input.name === 'string') {
    return page.getByRole(input.role as Parameters<Page['getByRole']>[0], { name: input.name }).nth(nth);
  }
  if (typeof input.label === 'string') return page.getByLabel(input.label).nth(nth);
  if (typeof input.placeholder === 'string') return page.getByPlaceholder(input.placeholder).nth(nth);
  if (typeof input.text === 'string') return page.getByText(input.text).nth(nth);
  throw new Error('No locator provided (need role+name, label, placeholder, or text)');
}

async function execute(page: Page, name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'goto':
      await page.goto(String(input.url), { waitUntil: 'domcontentloaded', timeout: 20_000 });
      return `Navigated to ${page.url()}`;
    case 'click': {
      const locator = locatorFor(page, input);
      await locator.click({ timeout: 10_000 });
      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
      return `Clicked ${input.name ?? input.label ?? input.text ?? ''}`.trim();
    }
    case 'type': {
      const locator = locatorFor(page, input);
      await locator.fill(String(input.value), { timeout: 10_000 });
      if (input.submit) await page.keyboard.press('Enter');
      return `Typed into ${input.name ?? input.label ?? input.placeholder ?? ''}${input.submit ? ' + Enter' : ''}`.trim();
    }
    case 'select': {
      const locator = locatorFor(page, input);
      await locator.selectOption(String(input.value), { timeout: 10_000 });
      return `Selected ${input.value}`;
    }
    case 'press':
      await page.keyboard.press(String(input.key));
      return `Pressed ${input.key}`;
    case 'scroll':
      await page.mouse.wheel(0, (input.direction === 'up' ? -1 : 1) * Number(input.amount ?? 600));
      return `Scrolled ${input.direction}`;
    case 'wait':
      await page.waitForTimeout(Math.min(Number(input.ms ?? 800), 5000));
      return 'Waited';
    default:
      return `Unknown action ${name}`;
  }
}

/**
 * Goal-driven recorder: an LLM drives the browser to complete `goal`, while the
 * injected DOM recorder captures every action for later deterministic replay.
 */
export async function runAgent(options: RunAgentOptions): Promise<AgentResult> {
  const apiKey = steelApiKey();
  const client = steelClient();
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;

  const session = await createSession(client, { timeout: 5 * 60 * 1000 });
  options.onSession?.(session.id, session.debugUrl);

  const browser = await chromium.connectOverCDP(
    `wss://connect.steel.dev?apiKey=${apiKey}&sessionId=${session.id}`,
  );
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.newPage());

  const events: RecordedEvent[] = [];
  await context.exposeBinding('__loopEmit', (_source, event) => events.push({ ts: Date.now(), ...event }));
  await context.addInitScript(RECORDER_SCRIPT);
  try {
    await page.evaluate(RECORDER_SCRIPT);
  } catch {
    /* about:blank */
  }
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) events.push({ ts: Date.now(), type: 'navigate', url: frame.url() });
  });

  const steps: AgentStep[] = [];
  const emit = (step: AgentStep) => {
    steps.push(step);
    options.onStep?.(step);
  };

  const result: AgentResult = {
    status: 'failed',
    steps,
    events,
    sessionId: session.id,
    debugUrl: session.debugUrl,
  };

  try {
    await page.goto(options.startUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    if (await challengeBlocks(page)) {
      result.error = CHALLENGE_MESSAGE;
      emit({ n: 1, action: 'needs-you', detail: 'CAPTCHA challenge detected — stopping' });
      return result;
    }
    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_KEY ?? '' });
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: `Goal: ${options.goal}\nStart URL: ${options.startUrl}` },
    ];
    const deadline = Date.now() + (options.timeoutMs ?? 120_000);
    let lastSignature = '';
    let repeats = 0;

    for (let i = 0; i < maxSteps; i += 1) {
      if (options.signal?.aborted) {
        result.error = 'Stopped';
        emit({ n: steps.length + 1, action: 'stopped', detail: 'Stopped by you' });
        break;
      }
      if (Date.now() > deadline) {
        result.error = 'Timed out before finishing — try a more specific goal.';
        emit({ n: steps.length + 1, action: 'needs-you', detail: 'Time limit reached' });
        break;
      }

      const observation = await observe(page);
      messages.push({ role: 'user', content: observation });

      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1200,
        system: SYSTEM,
        messages,
        tools: TOOLS,
        tool_choice: { type: 'any' },
      });
      messages.push({ role: 'assistant', content: response.content });

      const toolUse = response.content.find((block) => block.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') {
        result.error = 'Agent produced no action';
        break;
      }

      const input = (toolUse.input ?? {}) as Record<string, unknown>;

      if (toolUse.name === 'done') {
        result.status = 'done';
        result.summary = typeof input.summary === 'string' ? input.summary : 'Task complete';
        emit({ n: steps.length + 1, action: 'done', detail: result.summary });
        break;
      }
      if (toolUse.name === 'fail') {
        result.error = typeof input.reason === 'string' ? input.reason : 'Agent reported failure';
        emit({ n: steps.length + 1, action: 'fail', detail: result.error });
        break;
      }

      // Bail out when the agent keeps doing the same unproductive thing.
      const signature = `${toolUse.name}:${JSON.stringify(input)}`;
      if (signature === lastSignature && toolUse.name !== 'wait') repeats += 1;
      else repeats = 0;
      lastSignature = signature;
      if (repeats >= 2) {
        result.error = `The agent got stuck repeating "${toolUse.name}" without progress on this page.`;
        emit({ n: steps.length + 1, action: 'needs-you', detail: 'Stuck repeating an action — stopping' });
        break;
      }

      let outcome: string;
      try {
        outcome = await execute(page, toolUse.name, input);
      } catch (error) {
        outcome = `Error: ${error instanceof Error ? error.message.split('\n')[0] : 'action failed'}`;
      }
      const detail = describeInput(toolUse.name, input);
      emit({ n: steps.length + 1, action: toolUse.name, detail, result: outcome });
      await page.waitForTimeout(300);

      if (await challengeBlocks(page)) {
        result.error = CHALLENGE_MESSAGE;
        emit({ n: steps.length + 1, action: 'needs-you', detail: 'CAPTCHA challenge detected — stopping' });
        break;
      }

      messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: outcome }],
      });
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Agent run failed';
  } finally {
    fs.mkdirSync(path.join(process.cwd(), 'recordings'), { recursive: true });
    await browser.close().catch(() => {});
    await client.sessions.release(session.id).catch(() => {});
  }

  return result;
}

function describeInput(name: string, input: Record<string, unknown>): string {
  const target =
    input.name ?? input.label ?? input.placeholder ?? input.text ?? input.url ?? input.direction ?? '';
  const value = input.value ?? input.key ?? input.summary ?? input.reason ?? '';
  return `${target}${value ? ` → ${value}` : ''}`.trim() || name;
}
