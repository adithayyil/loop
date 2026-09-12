import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { createSession, steelApiKey, steelClient } from './steel';
import type { CompiledStep, Skill } from './types';

export interface RunFile {
  path: string;
  name: string;
  size: number;
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
}

/** testId > role+name > css > visible text. Mirrors the spike's locator chain. */
function locator(page: Page, step: CompiledStep) {
  if (step.dataTest) return page.getByTestId(step.dataTest).first();
  if (step.role && step.name) {
    return page.getByRole(step.role as Parameters<Page['getByRole']>[0], { name: step.name }).first();
  }
  if (step.css) return page.locator(step.css).first();
  if (step.name) return page.getByText(step.name).first();
  throw new Error(`No locator available for step ${step.n}`);
}

function valueFor(step: CompiledStep, params: Record<string, string>): string {
  if (step.param && params[step.param.name] != null) return params[step.param.name];
  return step.param?.value ?? step.value ?? '';
}

export interface RunSkillOptions {
  params?: Record<string, string>;
  onSession?: (sessionId: string, debugUrl: string) => void;
  /** Keep the session alive briefly after the run so a live viewer shows the end state. */
  releaseDelayMs?: number;
  /** Cache downloads under recordings/downloads/<cacheKey>/ before the session is released. */
  cacheKey?: string;
}

export async function runSkill(skill: Skill, options: RunSkillOptions = {}): Promise<RunResult> {
  const params = options.params ?? {};
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
  };

  try {
    for (const step of skill.steps) {
      if (skill.profileId && step.skipIfAuthenticated) {
        result.skipped = (result.skipped ?? 0) + 1;
        continue;
      }
      const value = valueFor(step, params);
      if (step.action === 'goto') {
        await page.goto(step.url ?? value, { waitUntil: 'domcontentloaded' });
      } else if (step.action === 'fill') {
        await locator(page, step).fill(value, { timeout: 10_000 });
      } else if (step.action === 'type+enter') {
        await locator(page, step).fill(value, { timeout: 10_000 });
        await page.keyboard.press('Enter');
      } else if (step.action === 'select') {
        await locator(page, step).selectOption(value, { timeout: 10_000 });
      } else if (step.action === 'click') {
        await locator(page, step).click({ timeout: 10_000 });
        await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
      }
      result.stepsRun += 1;
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
    if (options.releaseDelayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.releaseDelayMs));
    }
    await client.sessions.release(session.id).catch(() => {});
  }

  return result;
}
