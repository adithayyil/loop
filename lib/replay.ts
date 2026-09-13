import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Locator, type Page } from 'playwright-core';
import type Steel from 'steel-sdk';
import { healStep, describeLocator, type HealResult } from './heal';
import { createSession, steelApiKey, steelClient } from './steel';
import { visionClickTarget } from './vision';
import type { CompiledStep, Skill } from './types';

export interface RunFile {
  path: string;
  name: string;
  size: number;
}

export interface HealedStep {
  step: number;
  text: string;
  from: string;
  to: string;
  reason?: string;
  /** How the step was repaired: a persisted ARIA locator or a runtime-only vision click. */
  via?: 'aria' | 'vision';
}

export interface LoopReport {
  step: number;
  items: number;
}

export interface RunResult {
  status: 'done' | 'failed';
  stepsRun: number;
  totalSteps: number;
  skipped?: number;
  failedAt?: number;
  error?: string;
  sessionId: string;
  debugUrl: string;
  finalUrl?: string;
  files: RunFile[];
  /** Locators repaired by the self-healing pass, for the run view. */
  healed: HealedStep[];
  /** Steps that ran once per matching item. */
  loops: LoopReport[];
}

type Scope = Page | Locator;

/**
 * testId > role+name > css > visible text. Inside a loop row, `generic` puts
 * role+name and css first, since a per-item data-testid only exists in row 0.
 */
function buildLocator(scope: Scope, step: CompiledStep, generic = false): Locator {
  const nth = step.nth ?? 0;
  const testId = () => scope.getByTestId(step.dataTest!).nth(nth);
  const roleName = () =>
    scope
      .getByRole(step.role as Parameters<Page['getByRole']>[0], { name: step.name! })
      .nth(nth);
  const css = () => scope.locator(step.css!).nth(nth);
  const text = () => scope.getByText(step.name!).nth(nth);

  const ordered: Array<() => Locator> = generic
    ? [
        ...(step.role && step.name ? [roleName] : []),
        ...(step.css ? [css] : []),
        ...(step.dataTest ? [testId] : []),
        ...(step.name ? [text] : []),
      ]
    : [
        ...(step.dataTest ? [testId] : []),
        ...(step.role && step.name ? [roleName] : []),
        ...(step.css ? [css] : []),
        ...(step.name ? [text] : []),
      ];

  if (ordered.length === 0) throw new Error(`No locator available for step ${step.n}`);
  return ordered[0]();
}

function valueFor(step: CompiledStep, params: Record<string, string>): string {
  if (step.param && params[step.param.name] != null) return params[step.param.name];
  return step.param?.value ?? step.value ?? '';
}

async function performAction(
  scope: Scope,
  page: Page,
  step: CompiledStep,
  value: string,
  generic = false,
): Promise<void> {
  const target = buildLocator(scope, step, generic);
  switch (step.action) {
    case 'fill':
      await target.fill(value, { timeout: 10_000 });
      break;
    case 'type+enter':
      await target.fill(value, { timeout: 10_000 });
      await page.keyboard.press('Enter');
      break;
    case 'select':
      await target.selectOption(value, { timeout: 10_000 });
      break;
    case 'click':
      await target.click({ timeout: 10_000 });
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
      break;
    default:
      break;
  }
}

export interface RunSkillOptions {
  params?: Record<string, string>;
  onSession?: (sessionId: string, debugUrl: string) => void;
  /** Keep the session alive briefly after the run so a live viewer shows the end state. */
  releaseDelayMs?: number;
  /**
   * On failure, keep the Steel session alive this long (instead of releasing) so the
   * user can open the live view and take over. The result returns immediately; the
   * release happens on a detached timer.
   */
  retainOnFailureMs?: number;
  /** Cache downloads under recordings/downloads/<cacheKey>/ before the session is released. */
  cacheKey?: string;
  /** Attempt LLM locator healing on failure. Defaults on; no-ops without CLAUDE_KEY. */
  heal?: boolean;
  /** Called when a step's locator was repaired, so callers can persist the skill. */
  onHeal?: (step: CompiledStep, healed: HealResult) => void;
}

/**
 * Derive the repeating list around a step's recorded target. Walks up from the
 * target to the nearest ancestor that has structural siblings, then returns a
 * locator for those siblings (the "rows"). Best-effort: null when nothing repeats.
 */
async function deriveLoopItems(page: Page, step: CompiledStep): Promise<Locator | null> {
  let handle;
  try {
    handle = await buildLocator(page, step).elementHandle({ timeout: 3_000 });
  } catch {
    return null;
  }
  if (!handle) return null;

  const info = await handle
    .evaluate((node: Element) => {
      const classSig = (el: Element): string => {
        const raw = typeof el.className === 'string' ? el.className : '';
        return raw.trim().split(/\s+/).filter(Boolean).sort().join(' ');
      };
      const escape = (value: string): string =>
        typeof CSS !== 'undefined' && CSS.escape
          ? CSS.escape(value)
          : value.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
      const selectorFor = (element: Element): string => {
        const parts: string[] = [];
        let current: Element | null = element;
        while (current && current.nodeType === 1 && current !== document.body) {
          if (current.id) {
            parts.unshift(`#${escape(current.id)}`);
            break;
          }
          const testId = current.getAttribute('data-testid');
          if (testId) {
            parts.unshift(`[data-testid="${testId}"]`);
            break;
          }
          let part = current.tagName.toLowerCase();
          const classes = classSig(current).split(' ').filter(Boolean);
          if (classes.length > 0) part += `.${classes.map(escape).join('.')}`;
          const parentEl: HTMLElement | null = current.parentElement;
          if (parentEl) {
            let unique = false;
            try {
              unique = parentEl.querySelectorAll(`:scope > ${part}`).length === 1;
            } catch {
              unique = false;
            }
            if (unique) {
              parts.unshift(part);
              break;
            }
          }
          parts.unshift(part);
          current = parentEl;
        }
        return parts.join(' > ');
      };

      let element: Element | null = node;
      while (element && element !== document.body && element.parentElement) {
        const rowParent: HTMLElement = element.parentElement;
        const tag = element.tagName.toLowerCase();
        const sig = classSig(element);
        const siblings = Array.from(rowParent.children).filter(
          (child: Element) => child.tagName.toLowerCase() === tag && classSig(child) === sig,
        );
        if (siblings.length >= 2) {
          const selector = selectorFor(element);
          let count = 0;
          try {
            count = document.querySelectorAll(selector).length;
          } catch {
            count = 0;
          }
          if (count >= 2) return { selector, count };
        }
        element = rowParent;
      }
      return null;
    })
    .catch(() => null);

  if (!info || !info.selector) return null;
  return page.locator(info.selector);
}

/** Run a step for every item; returns how many iterations actually ran. */
async function runLoop(
  page: Page,
  step: CompiledStep,
  value: string,
  result: RunResult,
  heal: boolean,
  onHeal?: RunSkillOptions['onHeal'],
): Promise<number> {
  let items = await deriveLoopItems(page, step);
  let count = items ? await items.count().catch(() => 0) : 0;

  // The list selector itself broke; ask the healer to re-resolve the step, then retry.
  if (count === 0 && heal) {
    const fixed = await healStep(page, step, new Error('No repeating items found'));
    if (fixed) {
      const from = describeLocator(step);
      Object.assign(step, fixed.patch);
      result.healed.push({
        step: step.n,
        text: step.text,
        from,
        to: describeLocator(step),
        reason: fixed.reason,
        via: 'aria',
      });
      onHeal?.(step, fixed);
      items = await deriveLoopItems(page, step);
      count = items ? await items.count().catch(() => 0) : 0;
    }
  }

  // Not actually a list (or already reduced to one item): act on the single match.
  if (!items || count <= 1) {
    await performAction(page, page, step, value);
    return 1;
  }

  const limit = Math.min(count, step.loop?.max ?? 25);
  const listUrl = page.url();
  let ran = 0;
  for (let i = 0; i < limit; i += 1) {
    if ((await items.count().catch(() => 0)) <= i) break;
    await performAction(items.nth(i), page, step, value, true);
    ran += 1;
    // If the action navigated away (e.g. opened a detail page), come back to the list.
    if (page.url() !== listUrl) {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
  }
  result.loops.push({ step: step.n, items: ran });
  return ran;
}

/** Run a single step, healing its locator once and retrying if it fails. */
async function runSingle(
  page: Page,
  step: CompiledStep,
  value: string,
  result: RunResult,
  heal: boolean,
  client: Steel,
  sessionId: string,
  onHeal?: RunSkillOptions['onHeal'],
): Promise<void> {
  if (step.action === 'goto') {
    await page.goto(step.url ?? value, { waitUntil: 'domcontentloaded' });
    return;
  }
  try {
    await performAction(page, page, step, value);
  } catch (error) {
    if (!heal) throw error;

    const fixed = await healStep(page, step, error);
    if (fixed) {
      const from = describeLocator(step);
      Object.assign(step, fixed.patch);
      result.healed.push({
        step: step.n,
        text: step.text,
        from,
        to: describeLocator(step),
        reason: fixed.reason,
        via: 'aria',
      });
      onHeal?.(step, fixed);
      await performAction(page, page, step, value);
      return;
    }

    // Canvas/visual-only fallback: locate by screenshot and click coordinates. This
    // completes the run but is not persisted, since pixel coordinates don't generalize.
    const vision = await visionClickTarget(client, sessionId, page, step, error);
    if (!vision) throw error;
    result.healed.push({
      step: step.n,
      text: step.text,
      from: describeLocator(step),
      to: `vision click (${vision.x}, ${vision.y})`,
      reason: vision.reason,
      via: 'vision',
    });
  }
}

export async function runSkill(skill: Skill, options: RunSkillOptions = {}): Promise<RunResult> {
  const params = options.params ?? {};
  const heal = options.heal ?? true;
  const apiKey = steelApiKey();

  const client = steelClient();
  const session = await createSession(client, {
    profileId: skill.profileId ?? undefined,
    persistProfile: false,
    timeout: 5 * 60 * 1000,
  });
  options.onSession?.(session.id, session.debugUrl);

  const browser = await chromium.connectOverCDP(
    `wss://connect.steel.dev?apiKey=${apiKey}&sessionId=${session.id}`,
  );
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.newPage());

  const result: RunResult = {
    status: 'done',
    stepsRun: 0,
    totalSteps: skill.steps.length,
    sessionId: session.id,
    debugUrl: session.debugUrl,
    files: [],
    healed: [],
    loops: [],
  };

  try {
    for (const step of skill.steps) {
      if (skill.profileId && step.skipIfAuthenticated) {
        result.skipped = (result.skipped ?? 0) + 1;
        continue;
      }
      const value = valueFor(step, params);
      if (step.loop?.each && step.action !== 'goto') {
        result.stepsRun += await runLoop(page, step, value, result, heal, options.onHeal);
      } else {
        await runSingle(page, step, value, result, heal, client, session.id, options.onHeal);
        result.stepsRun += 1;
      }
      await page.waitForTimeout(300);
    }

    result.finalUrl = page.url();
    const listed = await client.sessions.files.list(session.id).catch(() => null);
    result.files = (listed?.data ?? []).map((file) => ({
      path: file.path,
      name: file.path.split('/').pop() || 'download',
      size: file.size,
    }));

    // Steel drops files when the session is released; cache them now.
    const downloadDir = options.cacheKey
      ? path.join(process.cwd(), 'recordings', 'downloads', options.cacheKey)
      : null;
    if (downloadDir && result.files.length > 0) {
      fs.mkdirSync(downloadDir, { recursive: true });
      for (const file of result.files) {
        const response = await client.sessions.files.download(session.id, file.name).catch(() => null);
        if (!response) continue;
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(path.join(downloadDir, file.name), buffer);
      }
    }

    fs.mkdirSync(path.join(process.cwd(), 'recordings'), { recursive: true });
    await page.screenshot({ path: `recordings/run-${skill.id}.png` }).catch(() => {});
  } catch (error) {
    result.status = 'failed';
    result.failedAt = result.stepsRun + 1;
    result.error = error instanceof Error ? error.message.split('\n')[0] : 'Unknown error';
  } finally {
    await browser.close().catch(() => {});
    const retainMs = result.status === 'failed' ? (options.retainOnFailureMs ?? 0) : 0;
    if (retainMs > 0) {
      // A failed run leaves its session up so "Needs you" can be taken over in the live
      // view. Release on a timer so we never leak the session, without blocking the result.
      const timer = setTimeout(() => {
        void client.sessions.release(session.id).catch(() => {});
      }, retainMs);
      timer.unref?.();
    } else {
      if (options.releaseDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.releaseDelayMs));
      }
      await client.sessions.release(session.id).catch(() => {});
    }
  }

  return result;
}
