import Anthropic from '@anthropic-ai/sdk';
import type { Page } from 'playwright-core';
import type { CompiledStep } from './types';

const MODEL = process.env.LOOP_COMPILER_MODEL ?? 'claude-sonnet-4-5';

/** Locator fields a heal can replace; the others are cleared so the new one wins. */
export interface HealPatch {
  css?: string | null;
  role?: string | null;
  name?: string | null;
  dataTest?: string | null;
  nth?: number;
}

export interface HealDecision {
  found?: boolean;
  reason?: string;
  role?: string;
  name?: string;
  dataTest?: string;
  css?: string;
  nth?: number;
}

export interface HealResult {
  patch: HealPatch;
  reason?: string;
  description: string;
}

/**
 * Turn the model's decision into a locator patch. Pure so it can be tested without
 * a browser or an API key. Returns null when the model found nothing usable.
 */
export function patchFromHealDecision(decision: HealDecision): HealPatch | null {
  if (decision.found !== true) return null;
  const patch: HealPatch = { css: null, role: null, name: null, dataTest: null };
  const dataTest = decision.dataTest?.trim();
  if (dataTest) return { ...patch, dataTest };
  const role = decision.role?.trim();
  const name = decision.name?.trim();
  if (role && name) {
    const nth = typeof decision.nth === 'number' && decision.nth >= 0 ? decision.nth : undefined;
    return { ...patch, role, name, ...(nth != null ? { nth } : {}) };
  }
  const css = decision.css?.trim();
  if (css) return { ...patch, css };
  if (name) return { ...patch, name };
  return null;
}

/** Human-readable current locator, for the run log. */
export interface LocatorShape {
  dataTest?: string | null;
  role?: string | null;
  name?: string | null;
  css?: string | null;
}

export function describeLocator(step: LocatorShape): string {
  if (step.dataTest) return `data-testid=${step.dataTest}`;
  if (step.role && step.name) return `role=${step.role} name=${step.name}`;
  if (step.css) return `css=${step.css}`;
  if (step.name) return `text=${step.name}`;
  return '(none)';
}

const SYSTEM = `A recorded browser step failed because the page changed and its old locator no
longer matches. You are given the step and an accessibility snapshot of the live page.
Find the element the step should act on and return a robust locator for it.

Rules:
- Prefer data-testid if the snapshot or step shows one.
- Otherwise prefer role + accessible name copied verbatim from the snapshot.
- Otherwise a CSS selector, and only then visible text.
- If several elements share the name, set nth to the zero-based index that best matches
  the step (default 0).
- If no element could plausibly satisfy the step, set found: false and explain why.`;

const TOOL = {
  name: 'heal_locator',
  description: 'Return a replacement locator for the failed step.',
  input_schema: {
    type: 'object' as const,
    properties: {
      found: { type: 'boolean' as const },
      reason: { type: 'string' as const },
      dataTest: { type: 'string' as const },
      role: { type: 'string' as const },
      name: { type: 'string' as const },
      css: { type: 'string' as const },
      nth: { type: 'number' as const },
    },
    required: ['found'],
  },
};

/**
 * Ask Claude to re-resolve a step against the live page. Returns null when there is
 * no key, the model can't find the element, or the call fails, replay then rethrows
 * its original error, so healing is always best-effort.
 */
export async function healStep(
  page: Page,
  step: CompiledStep,
  error: unknown,
): Promise<HealResult | null> {
  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) return null;

  let snapshot = '';
  try {
    snapshot = await page.locator('body').ariaSnapshot({ mode: 'ai', timeout: 5000 });
  } catch {
    snapshot = '(no accessibility snapshot available)';
  }
  if (snapshot.length > 12_000) snapshot = `${snapshot.slice(0, 12_000)}\n… (truncated)`;

  const prompt = [
    `URL: ${page.url()}`,
    `Step ${step.n}: ${step.text}`,
    `Action: ${step.action}`,
    `Old locator: ${describeLocator(step)}`,
    `Failure: ${error instanceof Error ? error.message.split('\n')[0] : 'action failed'}`,
    '',
    'Accessibility snapshot:',
    snapshot,
  ].join('\n');

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
    });
    const toolUse = message.content.find((block) => block.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') return null;
    const decision = toolUse.input as HealDecision;
    const patch = patchFromHealDecision(decision);
    if (!patch) return null;
    return { patch, reason: decision.reason, description: describeLocator({ ...step, ...patch }) };
  } catch {
    return null;
  }
}
