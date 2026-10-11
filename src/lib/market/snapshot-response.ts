import type { IndicatorSnapshot } from '@/lib/indicators/types.ts';
import type { MarketSnapshot } from './types.ts';

export type SnapshotResponse = MarketSnapshot & { indicators: IndicatorSnapshot | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDataSlot(value: unknown): boolean {
  return isRecord(value) && 'data' in value && (value.data === null || isRecord(value.data) || Array.isArray(value.data));
}

export function isSnapshotResponse(value: unknown, expectedSymbol?: string): value is SnapshotResponse {
  if (!isRecord(value) || typeof value.symbol !== 'string' || typeof value.generatedAt !== 'string') return false;
  if (expectedSymbol && value.symbol !== expectedSymbol) return false;
  const slots = ['quote', 'candles', 'profile', 'financials', 'estimates', 'earnings', 'news', 'macro'] as const;
  if (!slots.every((key) => key in value && isDataSlot(value[key]))) return false;
  if (!('indicators' in value) || (value.indicators !== null && !isRecord(value.indicators))) return false;
  return true;
}
