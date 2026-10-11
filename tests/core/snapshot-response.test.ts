import assert from 'node:assert/strict';
import test from 'node:test';

import { isSnapshotResponse } from '../../src/lib/market/snapshot-response.ts';

function emptySnapshot(symbol: string) {
  const slot = { data: null, provenance: null, error: null };
  return { symbol, generatedAt: '2026-10-11T00:00:00.000Z', quote: slot, candles: slot, profile: slot, financials: slot, estimates: slot, earnings: slot, news: slot, macro: slot, indicators: null };
}

test('snapshot response validation requires every independent market data slot and expected symbol', () => {
  assert.equal(isSnapshotResponse(emptySnapshot('NVDA'), 'NVDA'), true);
  assert.equal(isSnapshotResponse(emptySnapshot('MSFT'), 'NVDA'), false);
  const incomplete: unknown = { ...emptySnapshot('NVDA'), financials: undefined };
  assert.equal(isSnapshotResponse(incomplete, 'NVDA'), false);
  assert.equal(isSnapshotResponse(null), false);
});
