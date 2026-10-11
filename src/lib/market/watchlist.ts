import { normalizeSymbol } from './symbols.ts';

export const DEFAULT_WATCHLIST = ['NVDA', 'MSFT', 'AAPL', 'AMZN', 'TSLA'] as const;
export const MAX_WATCHLIST_SYMBOLS = 30;
export const WATCHLIST_STORAGE_KEY = 'stock-catalyst-ai.watchlist.v1';

export type AddSymbolResult =
  | { ok: true; symbols: string[] }
  | { ok: false; reason: 'invalid' | 'duplicate' | 'limit' };

export function sanitizeWatchlist(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_WATCHLIST];

  const symbols: string[] = [];
  for (const item of value) {
    const symbol = normalizeSymbol(item);
    if (symbol && !symbols.includes(symbol)) symbols.push(symbol);
    if (symbols.length === MAX_WATCHLIST_SYMBOLS) break;
  }
  return symbols;
}

export function parseSavedWatchlist(value: string | null): string[] {
  if (value === null) return [...DEFAULT_WATCHLIST];
  try {
    return sanitizeWatchlist(JSON.parse(value));
  } catch {
    return [...DEFAULT_WATCHLIST];
  }
}

export function addWatchlistSymbol(current: readonly string[], input: unknown): AddSymbolResult {
  const symbol = normalizeSymbol(input);
  if (!symbol) return { ok: false, reason: 'invalid' };
  if (current.includes(symbol)) return { ok: false, reason: 'duplicate' };
  if (current.length >= MAX_WATCHLIST_SYMBOLS) return { ok: false, reason: 'limit' };
  return { ok: true, symbols: [...current, symbol] };
}

export function removeWatchlistSymbol(current: readonly string[], symbol: string): string[] {
  return current.filter((item) => item !== symbol);
}
