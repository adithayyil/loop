import Anthropic from '@anthropic-ai/sdk';
import type { Page } from 'playwright-core';
import type Steel from 'steel-sdk';
import { describeLocator } from './heal';
import {
  elementCorroborates,
  parseVisionDecision,
  pngSize,
  type ElementInfo,
} from './vision-core';
import type { CompiledStep } from './types';

const MODEL =
  process.env.LOOP_VISION_MODEL ?? process.env.LOOP_COMPILER_MODEL ?? 'claude-sonnet-4-5';

const SYSTEM = `A recorded browser step failed because the page changed and its DOM locator no
longer matches. The screenshot may show a control that is drawn visually (canvas) or
simply renamed. Find the single control the step should act on and return its center
in the screenshot's pixel coordinates.

Only report a control whose visible text matches the step. If no matching control is
visible, set found to false and return no coordinates. Never substitute a different
control just to return a location.`;

const TOOL = {
  name: 'locate_target',
  description: 'Return the center pixel coordinates of the control the step should click.',
  input_schema: {
    type: 'object' as const,
    properties: {
      found: { type: 'boolean' as const, description: 'true only if a matching control is visible' },
      coordinates: {
        type: 'array' as const,
        items: { type: 'number' as const },
        minItems: 2,
        maxItems: 2,
        description: '[x, y] center in screenshot pixels; omit when found is false',
      },
      reason: { type: 'string' as const },
    },
    required: ['found'],
  },
};

export interface VisionFix {
  x: number;
  y: number;
  reason?: string;
}

/**
 * Last-resort heal for canvas/visual-only targets: screenshot via Steel, ask Claude
 * for the target's center, corroborate against any DOM element at that point, then
 * click through Steel's Computer API. Runtime only: coordinates are not persisted
 * (they don't generalize), so a run reports the vision click but keeps the old step.
 */
export async function visionClickTarget(
  client: Steel,
  sessionId: string,
  page: Page,
  step: CompiledStep,
  error: unknown,
): Promise<VisionFix | null> {
  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey || step.action !== 'click') return null;

  let base64: string | undefined;
  try {
    const shot = await client.sessions.computer(sessionId, { action: 'take_screenshot' });
    base64 = shot.base64_image;
  } catch {
    return null;
  }
  if (!base64) return null;

  const prompt = [
    `Step ${step.n}: ${step.text}`,
    `Action: ${step.action}`,
    `Old locator: ${describeLocator(step)}`,
    `Failure: ${error instanceof Error ? error.message.split('\n')[0] : 'action failed'}`,
  ].join('\n');

  let decision: unknown;
  try {
    const anthropic = new Anthropic({ apiKey });
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: base64 },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
    });
    decision = message.content.find((block) => block.type === 'tool_use')?.input;
  } catch {
    return null;
  }

  const coords = parseVisionDecision(decision);
  if (!coords) return null;

  // The screenshot includes browser chrome, so points map to CSS pixels by subtracting
  // the difference from the page's own viewport before touching the DOM.
  let info: ElementInfo | null = null;
  try {
    const size = pngSize(base64);
    const offset = await page.evaluate(
      ([width, height]) => ({ x: width - window.innerWidth, y: height - window.innerHeight }),
      [size.width, size.height] as [number, number],
    );
    info = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return null;
        return {
          name: (el as HTMLElement).innerText?.trim().slice(0, 80) ?? null,
          aria: el.getAttribute('aria-label'),
          text: el.textContent?.trim().slice(0, 80) ?? null,
          role: el.getAttribute('role') ?? el.tagName.toLowerCase(),
        };
      },
      [coords.x - offset.x, coords.y - offset.y] as [number, number],
    );
  } catch {
    info = null;
  }
  if (!elementCorroborates(step.name ?? step.text, info)) return null;

  try {
    await client.sessions.computer(sessionId, {
      action: 'click_mouse',
      button: 'left',
      coordinates: [coords.x, coords.y],
    });
  } catch {
    return null;
  }
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(300);

  return {
    x: coords.x,
    y: coords.y,
    reason: (decision as { reason?: string })?.reason,
  };
}
