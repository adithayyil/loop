/** Extract PNG width/height from the IHDR chunk. */
export function pngSize(base64: string): { width: number; height: number } {
  const buf = Buffer.from(base64, 'base64');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Coerce the model's locate decision into coordinates. Models drift: accept a
 * [x, y] array, numeric x/y, or a comma-joined string (seen in testing). Pure.
 */
export function parseVisionDecision(input: unknown): { x: number; y: number } | null {
  const decision = (input ?? {}) as {
    found?: unknown;
    coordinates?: unknown;
    x?: unknown;
    y?: unknown;
  };
  if (decision.found === false) return null;

  if (Array.isArray(decision.coordinates) && decision.coordinates.length >= 2) {
    const [x, y] = decision.coordinates.map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }

  const nums: number[] = [];
  for (const value of [decision.x, decision.y]) {
    if (typeof value === 'number') nums.push(value);
    else if (typeof value === 'string') {
      for (const match of value.matchAll(/-?\d+(?:\.\d+)?/g)) nums.push(Number(match[0]));
    }
  }
  if (nums.length >= 2 && Number.isFinite(nums[0]) && Number.isFinite(nums[1])) {
    return { x: nums[0], y: nums[1] };
  }
  return null;
}

export interface ElementInfo {
  name?: string | null;
  aria?: string | null;
  text?: string | null;
  role?: string | null;
}

/**
 * A vision click is only trusted when the element under the point is either
 * unlabeled (canvas/icon) or plausibly matches the step. The model does not reliably
 * abstain, so this is the real gate. Pure and deliberately permissive about unknowns.
 */
export function elementCorroborates(stepName: string | null | undefined, info: ElementInfo | null): boolean {
  if (!info) return true;
  const candidate = (info.aria || info.name || info.text || '').trim().toLowerCase();
  if (!candidate) return true;
  const tokens = (stepName ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
  if (tokens.length === 0) return true;
  return tokens.some((token) => candidate.includes(token));
}
