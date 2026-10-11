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

import { httpRequest, isAllowedHost, ALLOWED_AI_HOSTS } from '../market/http.ts';
import type { FetchLike } from '../market/http.ts';
import { Logger } from '../utils/logger.ts';
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
  | 'token_limit_reached'
  | 'missing_output_text'
  | 'invalid_json'
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
const MAX_OUTPUT_TOKENS = 3_000;

export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = 500 * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(base, 8000);
  return Math.round(capped + random() * 250);
}

/** Parse JSON after removing an optional Markdown code fence. */
export function extractJsonObject(text: string): unknown {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  const fence = /^```(?:json|javascript)?\s*\r?([\s\S]*?)\r?```$/i.exec(trimmed);
  const cleaned = (fence?.[1] ?? trimmed).trim();

  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    // fall through
  }

  return null;
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
    reasoning: { effort: 'low' },
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
      logger.warn('Qwen provider returned a non-2xx response', { ...responseDiagnostics(response.status, response.json ?? parseResponse(response.text)) });
    } else if (response.failure === 'timeout') {
      logger.warn('Qwen provider request timed out', { status: null, incompleteReason: null, outputItemTypes: [], contentTypes: [], outputTextLength: 0 });
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
      if (!isCompletedResponse(parsed)) logger.warn('Qwen response was not completed', responseDiagnostics(response.status, parsed));
      if (isRecord(parsed) && parsed.status === 'incomplete' && isTokenLimitReason(parsed.incomplete_details)) {
        return mapFailure('token_limit_reached', 'Qwen reached the output token limit before completing the report. Increase available output or shorten the research request.', latencyMs, attempt, null);
      }
      if (!isCompletedResponse(parsed)) return mapFailure('invalid_payload', 'Qwen did not return a completed response.', latencyMs, attempt, null);
      const content = readContent(parsed);
      if (content === null) {
        logger.warn('Qwen completed without output text', responseDiagnostics(response.status, parsed));
        return mapFailure('missing_output_text', 'Qwen completed the response without returning output text.', latencyMs, attempt, null);
      }
      if (content.trim() === '') {
        logger.warn('Qwen returned empty output text', responseDiagnostics(response.status, parsed));
        return mapFailure('empty_response', 'the model returned an empty completion', latencyMs, attempt, null);
      }
      if (extractJsonObject(content) === null) {
        logger.warn('Qwen output text was not valid JSON', responseDiagnostics(response.status, parsed));
        return mapFailure('invalid_json', 'Qwen returned output text that was not valid JSON.', latencyMs, attempt, null);
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
  if (typeof payload.output_text === 'string') return payload.output_text;
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

function parseResponse(text: string | null): unknown {
  if (text === null) return null;
  try { return JSON.parse(text) as unknown; } catch { return null; }
}

function responseDiagnostics(status: number, payload: unknown): Record<string, unknown> {
  const outputItemTypes: string[] = [];
  const contentTypes: string[] = [];
  let outputTextLength = 0;
  let incompleteReason: string | null = null;
  if (isRecord(payload)) {
    if (isRecord(payload.incomplete_details) && typeof payload.incomplete_details.reason === 'string') incompleteReason = payload.incomplete_details.reason;
    if (Array.isArray(payload.output)) for (const item of payload.output) {
      if (!isRecord(item)) continue;
      if (typeof item.type === 'string') outputItemTypes.push(item.type);
      if (!Array.isArray(item.content)) continue;
      for (const part of item.content) if (isRecord(part)) {
        if (typeof part.type === 'string') contentTypes.push(part.type);
        if (part.type === 'output_text' && typeof part.text === 'string') outputTextLength += part.text.length;
      }
    }
    if (typeof payload.output_text === 'string') outputTextLength = Math.max(outputTextLength, payload.output_text.length);
  }
  return { status, incompleteReason, outputItemTypes, contentTypes, outputTextLength };
}

function isTokenLimitReason(value: unknown): boolean {
  if (!isRecord(value) || typeof value.reason !== 'string') return false;
  return ['max_output_tokens', 'max_tokens', 'token_limit'].includes(value.reason);
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
