import type { NarrationSegment } from './types';

const OPENAI_BASE = 'https://api.openai.com/v1';
const GROQ_BASE = 'https://api.groq.com/openai/v1';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

interface WhisperConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

type Provider = 'groq' | 'openai' | 'openrouter' | 'custom';

function providerFor(base: string): Provider {
  if (/groq/i.test(base)) return 'groq';
  if (/openrouter/i.test(base)) return 'openrouter';
  if (/openai\.com/i.test(base)) return 'openai';
  return 'custom';
}

/**
 * Resolve the transcription provider. With no explicit base URL: OpenRouter if its
 * key is set (it load-balances across Whisper hosts, so one upstream being down
 * doesn't stop narration), then Groq, then OpenAI. `LOOP_WHISPER_BASE_URL` switches
 * to any OpenAI-compatible endpoint; key and base URL are always chosen together so
 * an override can't pair one provider's key with another's host.
 */
function whisperConfig(): WhisperConfig {
  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const explicitBase = process.env.LOOP_WHISPER_BASE_URL?.replace(/\/+$/, '');

  const provider: Provider = explicitBase
    ? providerFor(explicitBase)
    : openrouterKey
      ? 'openrouter'
      : groqKey
        ? 'groq'
        : 'openai';

  const baseUrl =
    explicitBase ??
    (provider === 'groq' ? GROQ_BASE : provider === 'openrouter' ? OPENROUTER_BASE : OPENAI_BASE);

  const providerKey =
    provider === 'groq'
      ? groqKey
      : provider === 'openrouter'
        ? openrouterKey
        : provider === 'openai'
          ? openaiKey
          : openrouterKey ?? groqKey ?? openaiKey;

  const defaultModel =
    provider === 'groq'
      ? 'whisper-large-v3-turbo'
      : provider === 'openrouter'
        ? 'openai/whisper-large-v3'
        : 'whisper-1';

  return {
    apiKey: process.env.LOOP_WHISPER_KEY ?? providerKey ?? '',
    baseUrl,
    model: process.env.LOOP_WHISPER_MODEL ?? defaultModel,
  };
}

/** Whether a transcription key is configured; recording works without one, just silently. */
export function whisperConfigured(): boolean {
  return Boolean(whisperConfig().apiKey);
}

/** Shape of a segment in Whisper's verbose_json response. */
interface RawSegment {
  start?: number;
  end?: number;
  text?: string;
  no_speech_prob?: number;
  avg_logprob?: number;
}

const MIN_CHARS = 2;
const MAX_NO_SPEECH = 0.6;
const MIN_LOGPROB = -1.5;

/**
 * Drop silent or low-confidence spans. Whisper hallucinates plausible text over
 * music and room tone; without this, narration would inject invented intent into
 * the compiler. Thresholds are deliberately loose so real speech always survives.
 */
export function guardSegments(raw: RawSegment[]): NarrationSegment[] {
  const kept: NarrationSegment[] = [];
  for (const segment of raw) {
    const text = (segment.text ?? '').trim();
    if (text.length < MIN_CHARS) continue;
    if ((segment.no_speech_prob ?? 0) > MAX_NO_SPEECH) continue;
    if ((segment.avg_logprob ?? 0) < MIN_LOGPROB) continue;
    const start = segment.start ?? 0;
    kept.push({ start, end: segment.end ?? start, text });
  }
  return kept;
}

export function joinNarration(segments: NarrationSegment[]): string {
  return segments
    .map((segment) => segment.text)
    .join(' ')
    .trim();
}

export interface Transcription {
  text: string;
  segments: NarrationSegment[];
}

/**
 * Transcribe a recorded audio blob with an OpenAI-compatible speech API (Groq, OpenAI,
 * OpenRouter, ...). Returns null when no key is configured so callers can treat
 * narration as optional.
 */
export async function transcribeAudio(
  audio: ArrayBuffer,
  filename = 'narration.webm',
  mimeType = 'audio/webm',
): Promise<Transcription | null> {
  const { apiKey, baseUrl, model } = whisperConfig();
  if (!apiKey) return null;

  const post = (responseFormat: 'verbose_json' | 'json') => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), filename);
    form.append('model', model);
    form.append('response_format', responseFormat);
    return fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
  };

  let response = await post('verbose_json');
  // Some providers/models reject verbose_json (400/422); fall back to a plain text
  // response, which still has `text` but no segment timestamps.
  if (!response.ok && (response.status === 400 || response.status === 422)) {
    response = await post('json');
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Transcription request failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  const data = (await response.json()) as { text?: string; segments?: RawSegment[] };
  const segments = guardSegments(data.segments ?? []);
  const text = (data.text ?? joinNarration(segments)).trim();
  return { text, segments };
}
