import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractJsonObject, requestJsonCompletion } from '../../src/lib/ai/qwen-client.ts';
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
    assert.equal(payload.max_output_tokens, 3_000);
    assert.deepEqual(payload.reasoning, { effort: 'low' });
    assert.ok(Array.isArray(payload.input));
    assert.equal(payload.instructions, undefined);
    assert.equal(payload.messages, undefined);
    assert.equal(payload.max_tokens, undefined);
    assert.ok(requestBody.length < 2_000, `request payload unexpectedly large (${requestBody.length} characters)`);
  });

  it('combines all Responses output_text blocks and ignores reasoning items', async () => {
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

  it('reports output token exhaustion distinctly and logs only safe response diagnostics', async () => {
    const logger = new CapturingLogger();
    const fetchImpl: FetchLike = async () => new Response(JSON.stringify({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"partial":' }] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });

    const result = await requestJsonCompletion([{ role: 'user', content: 'test' }], options(fetchImpl, { logger }));

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'token_limit_reached');
    assert.equal(logger.warnings.length, 1);
    const meta = logger.warnings[0]?.meta;
    assert.ok(meta);
    assert.equal(meta.status, 200);
    assert.equal(meta.incompleteReason, 'max_output_tokens');
    assert.deepEqual(meta.outputItemTypes, ['message']);
    assert.deepEqual(meta.contentTypes, ['output_text']);
    assert.equal(meta.outputTextLength, '{"partial":'.length);
  });

  it('logs only response status and permitted output diagnostics for non-2xx responses', async () => {
    const logger = new CapturingLogger();
    const fetchImpl: FetchLike = async () => new Response(JSON.stringify({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'sensitive response content' }] }],
    }), { status: 503, headers: { 'content-type': 'application/json' } });

    const result = await requestJsonCompletion([{ role: 'user', content: 'A test request.' }], options(fetchImpl, { logger, maxRetries: 0 }));

    assert.equal(result.ok, false);
    assert.equal(logger.warnings.length, 1);
    const entry = logger.warnings[0];
    assert.ok(entry);
    assert.equal(entry.message, 'Qwen provider returned a non-2xx response');
    assert.ok(entry.meta);
    assert.equal(entry.meta.status, 503);
    const serialized = JSON.stringify(entry.meta);
    assert.deepEqual(Object.keys(entry.meta).sort(), ['contentTypes', 'incompleteReason', 'outputItemTypes', 'outputTextLength', 'status'].sort());
    assert.equal(entry.meta.incompleteReason, 'max_output_tokens');
    assert.equal(entry.meta.outputTextLength, 'sensitive response content'.length);
    assert.doesNotMatch(serialized, /sensitive response content/);
    assert.doesNotMatch(serialized, /sk-test-key-that-must-never-be-logged-123456/);
  });

  it('accepts optional fenced JSON output before strict downstream schema validation', async () => {
    const fetchImpl: FetchLike = async () => new Response(responsesPayload('```json\n{"ok":true}\n```'), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const result = await requestJsonCompletion([{ role: 'user', content: 'test' }], options(fetchImpl));
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(extractJsonObject(result.content), { ok: true });
  });

  it('distinguishes completed output with no text from malformed JSON text', async () => {
    const noText: FetchLike = async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [] }] }), { status: 200 });
    const malformed: FetchLike = async () => new Response(responsesPayload('{"truncated":'), { status: 200 });
    const missing = await requestJsonCompletion([{ role: 'user', content: 'test' }], options(noText));
    const invalid = await requestJsonCompletion([{ role: 'user', content: 'test' }], options(malformed));
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, 'missing_output_text');
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.code, 'invalid_json');
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
