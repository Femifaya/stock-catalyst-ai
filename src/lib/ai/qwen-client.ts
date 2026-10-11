/**
 * Qwen adapter (server-side only).
 *
 * - Reads the API key from validated config; the key is never logged, never
 *   returned to a caller, and never included in an error message.
 * - Uses the Qwen Responses API with concise JSON output.
 * - Bounded timeout, bounded retries with exponential backoff, and a closed set of
 *   error codes so the pipeline can render an explicit failure state.
 * - Response text is parsed defensively; a truncated or fenced payload is handled,
 *   and anything unparseable becomes `invalid_payload` rather than a crash.
 */

import { httpRequest, isAllowedHost, ALLOWED_AI_HOSTS, safeJsonParse } from '../market/http.ts';
import type { FetchLike } from '../market/http.ts';
import { Logger, redactSecrets } from '../utils/logger.ts';
import { isRecord } from '../market/validators.ts';

export type QwenErrorCode =
  | 'not_configured'
  | 'timeout'
  | 'network'
  | 'rate_limited'
  | 'unauthorized'
  | 'upstream_error'
  | 'empty_response'
  | 'invalid_payload'
  | 'blocked_host';

export interface QwenMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface QwenUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface QwenClientOptions {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  maxTokens: number;
  temperature: number;
  fetchImpl?: FetchLike | null;
  logger?: Logger;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  maxResponseBytes?: number;
}

export interface QwenSuccess {
  ok: true;
  content: string;
  finishReason: string | null;
  usage: QwenUsage | null;
  latencyMs: number;
  attempts: number;
  model: string;
}

export interface QwenFailure {
  ok: false;
  code: QwenErrorCode;
  message: string;
  latencyMs: number;
  attempts: number;
  retryAfterSeconds: number | null;
}

export type QwenResult = QwenSuccess | QwenFailure;

const RETRYABLE: QwenErrorCode[] = ['rate_limited', 'upstream_error', 'network'];
const QWEN_MODEL = 'qwen3.8-max';
const MAX_OUTPUT_TOKENS = 1_500;

export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = 500 * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(base, 8000);
  return Math.round(capped + random() * 250);
}

/** Tolerant JSON extraction: handles code fences and surrounding prose. */
export function extractJsonObject(text: string): unknown {
  if (typeof text !== 'string') return null;
  const cleaned = text
    .trim()
    .replace(/^```(?:json|javascript)?/i, '')
    .replace(/```$/, '')
    .trim();

  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    // fall through
  }

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

function mapFailure(code: QwenErrorCode, message: string, latencyMs: number, attempts: number, retryAfterSeconds: number | null): QwenFailure {
  return { ok: false, code, message, latencyMs, attempts, retryAfterSeconds };
}

export async function requestJsonCompletion(messages: QwenMessage[], options: QwenClientOptions): Promise<QwenResult> {
  const started = options.now ? options.now() : Date.now();
  const logger = options.logger ?? new Logger({ scope: 'ai' });
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;

  if (options.apiKey === null || options.apiKey.trim() === '') {
    return mapFailure('not_configured', 'QWEN_API_KEY is not configured, so AI research is unavailable. Data and indicators are still shown.', 0, 0, null);
  }

  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/responses`;
  if (!isAllowedHost(endpoint, ALLOWED_AI_HOSTS)) {
    logger.warn('refusing to call a host outside the AI allowlist', { host: safeHost(endpoint) });
    return mapFailure('blocked_host', 'the configured Qwen base URL host is not in the allowlist', 0, 0, null);
  }

  const instructions = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
  const input = messages.filter((message) => message.role !== 'system').map(({ role, content }) => ({ role, content }));
  const body = JSON.stringify({
    model: QWEN_MODEL,
    ...(instructions.length > 0 ? { instructions } : {}),
    input,
    temperature: options.temperature,
    max_output_tokens: MAX_OUTPUT_TOKENS,
  });

  const maxAttempts = Math.max(1, options.maxRetries + 1);
  let attempt = 0;
  let lastFailure: QwenFailure | null = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    const response = await httpRequest(
      endpoint,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
        },
        body,
        timeoutMs: options.timeoutMs,
        maxBytes: options.maxResponseBytes ?? 4_000_000,
        allowedHosts: ALLOWED_AI_HOSTS,
      },
      options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike),
    );

    const latencyMs = (options.now ? options.now() : Date.now()) - started;

    if (!response.ok && response.status > 0) {
      logger.warn('Qwen provider returned a non-2xx response', {
        durationMs: response.elapsedMs,
        status: response.status,
        responseBody: sanitizeResponseBody(response.text),
      });
    } else if (response.failure === 'timeout') {
      logger.warn('Qwen provider request timed out', { durationMs: response.elapsedMs, status: null });
    }

    if (response.failure === 'timeout') {
      lastFailure = mapFailure('timeout', `the model did not respond within ${options.timeoutMs}ms`, latencyMs, attempt, null);
    } else if (response.failure === 'blocked_host') {
      return mapFailure('blocked_host', 'the AI endpoint host is not allowed', latencyMs, attempt, null);
    } else if (response.failure !== null) {
      lastFailure = mapFailure('network', 'the model endpoint could not be reached', latencyMs, attempt, null);
    } else if (response.status === 429) {
      lastFailure = mapFailure('rate_limited', 'the model provider rate limited this request', latencyMs, attempt, response.retryAfterSeconds ?? 30);
    } else if (response.status === 401 || response.status === 403) {
      return mapFailure('unauthorized', 'the model provider rejected the API key', latencyMs, attempt, null);
    } else if (!response.ok) {
      lastFailure = mapFailure('upstream_error', `the model provider returned HTTP ${response.status}`, latencyMs, attempt, response.retryAfterSeconds);
    } else {
      const parsed = response.json ?? extractJsonObject(response.text ?? '');
      if (!isCompletedResponse(parsed)) {
        return mapFailure('invalid_payload', 'the model response was incomplete or malformed', latencyMs, attempt, null);
      }
      const content = readContent(parsed);
      if (content === null) {
        return mapFailure('invalid_payload', 'the model response did not contain a usable completion', latencyMs, attempt, null);
      }
      if (content.trim() === '') {
        return mapFailure('empty_response', 'the model returned an empty completion', latencyMs, attempt, null);
      }
      return {
        ok: true,
        content,
        finishReason: readFinishReason(parsed),
        usage: readUsage(parsed),
        latencyMs,
        attempts: attempt,
        model: QWEN_MODEL,
      };
    }

    const retryable = lastFailure !== null && RETRYABLE.includes(lastFailure.code);
    if (!retryable || attempt >= maxAttempts) break;

    const delay = Math.max(backoffDelayMs(attempt, random), (lastFailure?.retryAfterSeconds ?? 0) * 1000);
    logger.warn('retrying model request', { attempt, code: lastFailure?.code, delayMs: delay });
    await sleep(delay);
  }

  return lastFailure ?? mapFailure('upstream_error', 'the model request failed', (options.now ? options.now() : Date.now()) - started, attempt, null);
}

function readContent(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (!Array.isArray(payload.output)) return null;
  const text: string[] = [];
  for (const item of payload.output) {
    if (!isRecord(item) || item.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (isRecord(part) && part.type === 'output_text' && typeof part.text === 'string') text.push(part.text);
    }
  }
  return text.length > 0 ? text.join('') : null;
}

function readFinishReason(payload: unknown): string | null {
  return isRecord(payload) && typeof payload.status === 'string' ? payload.status : null;
}

function isCompletedResponse(payload: unknown): boolean {
  return isRecord(payload) && payload.status === 'completed';
}

function readUsage(payload: unknown): QwenUsage | null {
  if (!isRecord(payload) || !isRecord(payload.usage)) return null;
  const usage = payload.usage;
  const read = (keys: string[]): number | null => {
    for (const key of keys) {
      const value = usage[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return null;
  };
  return {
    promptTokens: read(['prompt_tokens', 'input_tokens']),
    completionTokens: read(['completion_tokens', 'output_tokens']),
    totalTokens: read(['total_tokens']),
  };
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function sanitizeResponseBody(body: string | null): unknown {
  if (body === null) return null;
  const parsed = safeJsonParse(body);
  const sanitized = redactSecrets(parsed ?? body);
  const serialized = JSON.stringify(sanitized);
  return serialized.length <= 4_000 ? sanitized : `${serialized.slice(0, 4_000)}…`;
}
