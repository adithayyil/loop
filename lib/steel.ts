import Steel from 'steel-sdk';

interface Stealth {
  autoCaptchaSolving?: boolean;
  humanizeInteractions?: boolean;
}

interface CreateBody {
  persistProfile?: boolean;
  debugConfig?: { interactive?: boolean };
  solveCaptcha?: boolean;
  stealthConfig?: Stealth;
  timeout?: number;
  profileId?: string;
}

function flag(name: string): boolean {
  const value = process.env[name]?.toLowerCase();
  return value === '1' || value === 'true';
}

export function steelApiKey(): string {
  const apiKey = process.env.STEEL_KEY;
  if (!apiKey) throw new Error('STEEL_KEY is not set');
  return apiKey;
}

export function steelClient(): Steel {
  return new Steel({ steelAPIKey: steelApiKey() });
}

/**
 * Session options shared by record and replay. Captcha/stealth behavior is opt-in
 * via env (solving adds latency and cost, and Steel gates it behind a paid balance):
 *   LOOP_SOLVE_CAPTCHA=1  -> auto-solve detected captchas
 *   LOOP_HUMANIZE=1       -> human-like mouse movement (helps with bot detection)
 */
export function sessionConfig(): CreateBody {
  const solveCaptcha = flag('LOOP_SOLVE_CAPTCHA');
  const humanize = flag('LOOP_HUMANIZE');

  const stealthConfig: Stealth = {};
  if (solveCaptcha) stealthConfig.autoCaptchaSolving = true;
  if (humanize) stealthConfig.humanizeInteractions = true;

  return {
    persistProfile: true,
    debugConfig: { interactive: true },
    solveCaptcha: solveCaptcha || undefined,
    stealthConfig: Object.keys(stealthConfig).length > 0 ? stealthConfig : undefined,
  };
}

/**
 * Create a session, degrading gracefully if captcha solving is requested but the
 * account can't use it (Steel returns 403 below a paid-balance threshold).
 */
export async function createSession(client: Steel, extra: CreateBody = {}) {
  const base = sessionConfig();
  try {
    return await client.sessions.create({ ...base, ...extra });
  } catch (error) {
    if (!base.solveCaptcha) throw error;
    const { solveCaptcha: _dropped, stealthConfig, ...rest } = base;
    const fallbackStealth = stealthConfig
      ? { ...stealthConfig, autoCaptchaSolving: undefined }
      : undefined;
    console.warn(
      '[steel] captcha solving unavailable, retrying without it:',
      error instanceof Error ? error.message : error,
    );
    return await client.sessions.create({
      ...rest,
      ...(fallbackStealth ? { stealthConfig: fallbackStealth } : {}),
      ...extra,
    });
  }
}

/** Find the profile persisted by a session (used for auth reuse on replay). */
export async function profileForSession(
  client: Steel,
  sessionId: string,
): Promise<string | null> {
  const { profiles } = await client.profiles.list();
  const match = profiles.find((profile) => profile.sourceSessionId === sessionId);
  if (match) return match.id;
  const newest = [...profiles].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )[0];
  return newest?.id ?? null;
}
