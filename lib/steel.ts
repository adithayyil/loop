import Steel from 'steel-sdk';

interface Stealth {
  autoCaptchaSolving?: boolean;
  humanizeInteractions?: boolean;
}

interface Geolocation {
  geolocation: { country: string };
}

interface CreateBody {
  persistProfile?: boolean;
  debugConfig?: { interactive?: boolean };
  solveCaptcha?: boolean;
  stealthConfig?: Stealth;
  useProxy?: boolean | Geolocation;
  proxyUrl?: string;
  timeout?: number;
  profileId?: string;
}

function flag(name: string): boolean {
  const value = process.env[name]?.toLowerCase();
  return value === '1' || value === 'true';
}

/** True when captcha auto-solving is enabled (Steel requires a paid balance). */
export function captchaSolvingEnabled(): boolean {
  return flag('LOOP_SOLVE_CAPTCHA');
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
 * Session options shared by record and replay. Captcha/stealth/proxy behavior is
 * opt-in via env (solving adds latency and cost, and Steel gates it behind a paid
 * balance):
 *   LOOP_SOLVE_CAPTCHA=1   -> auto-solve detected captchas
 *   LOOP_HUMANIZE=1        -> human-like mouse movement (helps with bot detection)
 *   LOOP_USE_PROXY=1       -> route through a Steel managed proxy
 *   LOOP_PROXY_COUNTRY=US  -> pin the managed proxy's geolocation
 *   LOOP_PROXY_URL=...     -> custom proxy URL; overrides LOOP_USE_PROXY
 */
export function sessionConfig(): CreateBody {
  const solveCaptcha = flag('LOOP_SOLVE_CAPTCHA');
  const humanize = flag('LOOP_HUMANIZE');
  const useProxy = flag('LOOP_USE_PROXY');
  const proxyUrl = process.env.LOOP_PROXY_URL?.trim();
  const proxyCountry = process.env.LOOP_PROXY_COUNTRY?.trim().toUpperCase();

  const stealthConfig: Stealth = {};
  if (solveCaptcha) stealthConfig.autoCaptchaSolving = true;
  if (humanize) stealthConfig.humanizeInteractions = true;

  const proxy: Pick<CreateBody, 'useProxy' | 'proxyUrl'> = {};
  if (proxyUrl) proxy.proxyUrl = proxyUrl;
  else if (useProxy) proxy.useProxy = proxyCountry ? { geolocation: { country: proxyCountry } } : true;

  return {
    persistProfile: true,
    debugConfig: { interactive: true },
    solveCaptcha: solveCaptcha || undefined,
    stealthConfig: Object.keys(stealthConfig).length > 0 ? stealthConfig : undefined,
    ...proxy,
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
