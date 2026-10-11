import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { requestJsonCompletion } from '../../src/lib/ai/qwen-client.ts';
import type { FetchLike } from '../../src/lib/market/http.ts';
import { isRecord } from '../../src/lib/market/validators.ts';
import { Logger } from '../../src/lib/utils/logger.ts';

const MODEL = 'qwen3.8-max';

function responsesPayload(text: string): string {
  return JSON.stringify({
    id: 'resp_test',
    status: 'completed',
    output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }],
    usage: { input_tokens: 21, output_tokens: 8, total_tokens: 29 },
  });
}

class CapturingLogger extends Logger {
  readonly warnings: Array<{ message: string; meta: Record<string, unknown> | undefined }> = [];

  override warn(message: string, meta?: Record<string, unknown>): void {
    this.warnings.push({ message, meta });
  }
}

function options(fetchImpl: FetchLike, overrides: Partial<Parameters<typeof requestJsonCompletion>[1]> = {}) {
  return {
    apiKey: 'sk-test-key-that-must-never-be-logged-123456',
    baseUrl: 'https://hackathon.bitgetops.com/v1/',
    model: MODEL,
    timeoutMs: 240_000,
    maxRetries: 2,
    maxTokens: 3_000,
    temperature: 0.2,
    fetchImpl,
    sleep: async () => undefined,
    random: () => 0,
    ...overrides,
  };
}

describe('Qwen Responses API client', () => {
  it('uses the Responses endpoint, fixed model and output limit, compact input, and parses the documented response shape', async () => {
    let requestedUrl = '';
    let requestBody = '';
    const fetchImpl: FetchLike = async (url, init) => {
      requestedUrl = url;
      requestBody = typeof init.body === 'string' ? init.body : '';
      return new Response(responsesPayload('{"ok":true}'), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const result = await requestJsonCompletion([{ role: 'user', content: 'Return a small JSON object.' }], options(fetchImpl));

    assert.equal(requestedUrl, 'https://hackathon.bitgetops.com/v1/responses');
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.model, MODEL);
    assert.equal(result.content, '{"ok":true}');
    assert.equal(result.finishReason, 'completed');
    assert.deepEqual(result.usage, { promptTokens: 21, completionTokens: 8, totalTokens: 29 });
    const payload: unknown = JSON.parse(requestBody);
    assert.ok(isRecord(payload));
    assert.equal(payload.model, 'qwen3.8-max');
    assert.equal(payload.max_output_tokens, 1_500);
    assert.ok(Array.isArray(payload.input));
    assert.equal(payload.instructions, undefined);
    assert.equal(payload.messages, undefined);
    assert.equal(payload.max_tokens, undefined);
    assert.ok(requestBody.length < 2_000, `request payload unexpectedly large (${requestBody.length} characters)`);
  });

  it('takes assistant output_text from message items and ignores reasoning items', async () => {
    const fetchImpl: FetchLike = async () => new Response(JSON.stringify({
      status: 'completed',
      output: [
        { type: 'reasoning', summary: [] },
        { type: 'message', role: 'assistant', content: [
          { type: 'refusal', refusal: 'not used' },
          { type: 'output_text', text: '{"first":' },
          { type: 'output_text', text: 'true}' },
        ] },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    const result = await requestJsonCompletion([{ role: 'user', content: 'test' }], options(fetchImpl));

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.content, '{"first":true}');
  });

  it('rejects incomplete Responses API output', async () => {
    const fetchImpl: FetchLike = async () => new Response(JSON.stringify({
      status: 'incomplete',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"partial":' }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    const result = await requestJsonCompletion([{ role: 'user', content: 'test' }], options(fetchImpl));

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'invalid_payload');
  });

  it('records sanitized duration, status, and non-2xx body without secrets or authorization', async () => {
    const logger = new CapturingLogger();
    const fetchImpl: FetchLike = async () => new Response(JSON.stringify({
      error: {
        message: 'upstream request rejected',
        api_key: 'sk-provider-echoed-secret-value-123456',
        authorization: 'Bearer provider-echoed-auth-secret',
      },
    }), { status: 503, headers: { 'content-type': 'application/json' } });

    const result = await requestJsonCompletion([{ role: 'user', content: 'A test request.' }], options(fetchImpl, { logger, maxRetries: 0 }));

    assert.equal(result.ok, false);
    assert.equal(logger.warnings.length, 1);
    const entry = logger.warnings[0];
    assert.ok(entry);
    assert.equal(entry.message, 'Qwen provider returned a non-2xx response');
    assert.ok(entry.meta);
    assert.equal(entry.meta.status, 503);
    assert.equal(typeof entry.meta.durationMs, 'number');
    const serialized = JSON.stringify(entry.meta);
    assert.match(serialized, /upstream request rejected/);
    assert.doesNotMatch(serialized, /sk-provider-echoed-secret-value-123456/);
    assert.doesNotMatch(serialized, /provider-echoed-auth-secret/);
    assert.doesNotMatch(serialized, /Bearer/);
    assert.doesNotMatch(serialized, /sk-test-key-that-must-never-be-logged-123456/);
  });

  it('does not retry a timed-out request and start another long attempt', async () => {
    let attempts = 0;
    let backoffs = 0;
    const fetchImpl: FetchLike = async (_url, init) => {
      attempts += 1;
      return new Promise((_resolve, reject) => {
        const signal = init.signal;
        if (!signal) {
          reject(new Error('missing request timeout signal'));
          return;
        }
        if (signal.aborted) {
          reject(new Error('timeout'));
          return;
        }
        signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
      });
    };

    const result = await requestJsonCompletion([{ role: 'user', content: 'A timeout test.' }], options(fetchImpl, {
      timeoutMs: 10,
      sleep: async () => { backoffs += 1; },
    }));

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, 'timeout');
    assert.equal(result.attempts, 1);
    assert.equal(attempts, 1);
    assert.equal(backoffs, 0);
  });
});
